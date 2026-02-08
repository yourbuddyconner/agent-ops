import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import { sha256Hex } from '../lib/workflow-runtime.js';
import { validateWorkflowDefinition } from '../lib/workflow-definition.js';

export const workflowsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const syncWorkflowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  data: z.record(z.unknown()),
});

const syncAllWorkflowsSchema = z.object({
  workflows: z.array(syncWorkflowSchema),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  version: z.string().optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  data: z.record(z.unknown()).optional(),
});

const createProposalSchema = z.object({
  executionId: z.string().optional(),
  proposedBySessionId: z.string().optional(),
  baseWorkflowHash: z.string().min(1),
  proposal: z.record(z.unknown()),
  diffText: z.string().optional(),
  expiresAt: z.string().optional(),
});

const reviewProposalSchema = z.object({
  approve: z.boolean(),
  notes: z.string().optional(),
});

const applyProposalSchema = z.object({
  reviewNotes: z.string().optional(),
  version: z.string().optional(),
});

const rollbackWorkflowSchema = z.object({
  targetWorkflowHash: z.string().min(1),
  version: z.string().optional(),
  notes: z.string().optional(),
});

const DEFAULT_PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeHash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'sha256:';
  return trimmed.startsWith('sha256:') ? trimmed : `sha256:${trimmed}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function extractProposedWorkflow(proposal: Record<string, unknown>): Record<string, unknown> | null {
  const candidates: unknown[] = [
    proposal.proposedWorkflow,
    (proposal.proposal as Record<string, unknown> | undefined)?.proposedWorkflow,
    proposal.workflow,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }

  if (Array.isArray((proposal as Record<string, unknown>).steps)) {
    return proposal;
  }

  return null;
}

function bumpPatchVersion(version: string | null): string {
  const fallback = '1.0.0';
  const source = (version || fallback).trim();
  const parts = source.split('.');
  if (parts.length !== 3) return `${source}.1`;

  const major = Number.parseInt(parts[0], 10);
  const minor = Number.parseInt(parts[1], 10);
  const patch = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return `${source}.1`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function workflowAllowsSelfModification(rawWorkflowData: string): boolean {
  const workflowData = parseJsonObject(rawWorkflowData);
  const constraints = workflowData.constraints;
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
    return false;
  }

  return (constraints as Record<string, unknown>).allowSelfModification === true;
}

function resolveProposalExpiry(expiresAt?: string): string {
  if (!expiresAt) {
    return new Date(Date.now() + DEFAULT_PROPOSAL_TTL_MS).toISOString();
  }

  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('Invalid expiresAt timestamp');
  }
  if (parsed.getTime() <= Date.now()) {
    throw new ValidationError('Proposal expiry must be in the future');
  }
  return parsed.toISOString();
}

async function saveWorkflowHistorySnapshot(
  env: Env,
  params: {
    workflowId: string;
    workflowVersion: string | null;
    workflowData: string;
    source: 'sync' | 'update' | 'proposal_apply' | 'rollback' | 'system';
    sourceProposalId?: string | null;
    notes?: string | null;
    createdBy?: string | null;
    createdAt?: string;
  }
): Promise<string> {
  const workflowHash = normalizeHash(await sha256Hex(params.workflowData));
  const createdAt = params.createdAt || new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO workflow_version_history
      (id, workflow_id, workflow_version, workflow_hash, workflow_data, source, source_proposal_id, notes, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workflow_id, workflow_hash) DO NOTHING
  `).bind(
    crypto.randomUUID(),
    params.workflowId,
    params.workflowVersion,
    workflowHash,
    params.workflowData,
    params.source,
    params.sourceProposalId || null,
    params.notes || null,
    params.createdBy || null,
    createdAt,
  ).run();

  return workflowHash;
}

/**
 * GET /api/workflows
 * List user's workflows
 */
workflowsRouter.get('/', async (c) => {
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).bind(user.id).all();

  const workflows = result.results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    data: JSON.parse(row.data as string),
    enabled: Boolean(row.enabled),
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({ workflows });
});

/**
 * GET /api/workflows/:id
 * Get a single workflow by ID or slug
 */
workflowsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  // Try to find by ID first, then by slug
  const row = await c.env.DB.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first();

  if (!row) {
    throw new NotFoundError('Workflow', id);
  }

  return c.json({
    workflow: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      version: row.version,
      data: JSON.parse(row.data as string),
      enabled: Boolean(row.enabled),
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

/**
 * POST /api/workflows/sync
 * Sync a single workflow from the plugin to cloud storage
 */
workflowsRouter.post('/sync', zValidator('json', syncWorkflowSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const now = new Date().toISOString();
  const validation = validateWorkflowDefinition(body.data);
  if (!validation.valid) {
    throw new ValidationError(`Invalid workflow definition: ${validation.errors[0]}`);
  }

  await c.env.DB.prepare(`
    INSERT INTO workflows (id, user_id, slug, name, description, version, data, enabled, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      name = excluded.name,
      description = excluded.description,
      version = excluded.version,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).bind(
    body.id,
    user.id,
    body.slug || null,
    body.name,
    body.description || null,
    body.version,
    JSON.stringify(body.data),
    now,
    now
  ).run();

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: body.id,
    workflowVersion: body.version,
    workflowData: JSON.stringify(body.data),
    source: 'sync',
    createdBy: user.id,
    createdAt: now,
  });

  return c.json({ success: true, id: body.id });
});

/**
 * POST /api/workflows/sync-all
 * Sync all workflows from the plugin (called on plugin startup)
 */
workflowsRouter.post('/sync-all', zValidator('json', syncAllWorkflowsSchema), async (c) => {
  const user = c.get('user');
  const { workflows } = c.req.valid('json');
  const now = new Date().toISOString();

  // Get existing workflow IDs for this user
  const existing = await c.env.DB.prepare(`
    SELECT id FROM workflows WHERE user_id = ?
  `).bind(user.id).all();
  const existingIds = new Set(existing.results.map((r) => r.id));

  // Sync each workflow
  const incomingIds = new Set<string>();
  for (const wf of workflows) {
    const validation = validateWorkflowDefinition(wf.data);
    if (!validation.valid) {
      throw new ValidationError(`Invalid workflow definition for "${wf.name}": ${validation.errors[0]}`);
    }

    incomingIds.add(wf.id);
    await c.env.DB.prepare(`
      INSERT INTO workflows (id, user_id, slug, name, description, version, data, enabled, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        data = excluded.data,
        updated_at = excluded.updated_at
    `).bind(
      wf.id,
      user.id,
      wf.slug || null,
      wf.name,
      wf.description || null,
      wf.version,
      JSON.stringify(wf.data),
      now,
      now
    ).run();

    await saveWorkflowHistorySnapshot(c.env, {
      workflowId: wf.id,
      workflowVersion: wf.version,
      workflowData: JSON.stringify(wf.data),
      source: 'sync',
      createdBy: user.id,
      createdAt: now,
    });
  }

  // Remove workflows that no longer exist in the plugin
  for (const existingId of existingIds) {
    if (!incomingIds.has(existingId as string)) {
      await c.env.DB.prepare(`
        DELETE FROM workflows WHERE id = ? AND user_id = ?
      `).bind(existingId, user.id).run();
    }
  }

  return c.json({ success: true, synced: workflows.length });
});

/**
 * PUT /api/workflows/:id
 * Update a workflow
 */
workflowsRouter.put('/:id', zValidator('json', updateWorkflowSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  // Verify workflow exists and user owns it
  const existing = await c.env.DB.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first();

  if (!existing) {
    throw new NotFoundError('Workflow', id);
  }

  // Build update fields
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }
  if (body.slug !== undefined) {
    updates.push('slug = ?');
    values.push(body.slug);
  }
  if (body.version !== undefined) {
    updates.push('version = ?');
    values.push(body.version);
  }
  if (body.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(body.enabled ? 1 : 0);
  }
  if (body.tags !== undefined) {
    updates.push('tags = ?');
    values.push(JSON.stringify(body.tags));
  }
  if (body.data !== undefined) {
    updates.push('data = ?');
    values.push(JSON.stringify(body.data));
  }

  if (updates.length === 0) {
    // Nothing to update, return existing
    return c.json({
      workflow: {
        id: existing.id,
        slug: existing.slug,
        name: existing.name,
        description: existing.description,
        version: existing.version,
        data: JSON.parse(existing.data as string),
        enabled: Boolean(existing.enabled),
        tags: existing.tags ? JSON.parse(existing.tags as string) : [],
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      },
    });
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(existing.id); // For WHERE clause

  await c.env.DB.prepare(`
    UPDATE workflows SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  // Fetch updated workflow
  const updated = await c.env.DB.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows WHERE id = ?
  `).bind(existing.id).first();

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: updated!.id as string,
    workflowVersion: (updated!.version as string | null) || null,
    workflowData: String(updated!.data || '{}'),
    source: 'update',
    createdBy: user.id,
    createdAt: String(updated!.updated_at || new Date().toISOString()),
  });

  return c.json({
    workflow: {
      id: updated!.id,
      slug: updated!.slug,
      name: updated!.name,
      description: updated!.description,
      version: updated!.version,
      data: JSON.parse(updated!.data as string),
      enabled: Boolean(updated!.enabled),
      tags: updated!.tags ? JSON.parse(updated!.tags as string) : [],
      createdAt: updated!.created_at,
      updatedAt: updated!.updated_at,
    },
  });
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow (called when plugin deletes a workflow)
 */
workflowsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  // First delete associated triggers
  await c.env.DB.prepare(`
    DELETE FROM triggers WHERE workflow_id = ? AND user_id = ?
  `).bind(id, user.id).run();

  // Then delete the workflow
  const result = await c.env.DB.prepare(`
    DELETE FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('Workflow', id);
  }

  return c.json({ success: true });
});

/**
 * GET /api/workflows/:id/executions
 * Get execution history for a workflow
 */
workflowsRouter.get('/:id/executions', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const { limit, offset } = c.req.query();

  // Verify user owns the workflow
  const workflow = await c.env.DB.prepare(`
    SELECT id FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  const result = await c.env.DB.prepare(`
    SELECT id, workflow_id, session_id, trigger_id, status, trigger_type, trigger_metadata,
           resume_token,
           variables, outputs, steps, error, started_at, completed_at
    FROM workflow_executions
    WHERE workflow_id = ? AND user_id = ?
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).bind(workflow.id, user.id, parseInt(limit || '50'), parseInt(offset || '0')).all();

  const executions = result.results.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    sessionId: row.session_id,
    triggerId: row.trigger_id,
    status: row.status,
    triggerType: row.trigger_type,
    triggerMetadata: row.trigger_metadata ? JSON.parse(row.trigger_metadata as string) : null,
    resumeToken: row.resume_token || null,
    variables: row.variables ? JSON.parse(row.variables as string) : null,
    outputs: row.outputs ? JSON.parse(row.outputs as string) : null,
    steps: row.steps ? JSON.parse(row.steps as string) : null,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));

  return c.json({ executions });
});

/**
 * GET /api/workflows/:id/history
 * List immutable workflow definition snapshots for rollback and auditing.
 */
workflowsRouter.get('/:id/history', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const { limit, offset } = c.req.query();

  const workflow = await c.env.DB.prepare(`
    SELECT id, version, data, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{
    id: string;
    version: string | null;
    data: string;
    updated_at: string;
  }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  const currentWorkflowHash = await saveWorkflowHistorySnapshot(c.env, {
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowData: workflow.data,
    source: 'system',
    createdBy: user.id,
    createdAt: workflow.updated_at || new Date().toISOString(),
  });

  const list = await c.env.DB.prepare(`
    SELECT id, workflow_id, workflow_version, workflow_hash, workflow_data, source, source_proposal_id, notes, created_by, created_at
    FROM workflow_version_history
    WHERE workflow_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(workflow.id, parseInt(limit || '50', 10), parseInt(offset || '0', 10)).all();

  const history = list.results.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    version: row.workflow_version,
    workflowHash: row.workflow_hash,
    workflowData: parseJsonObject(String(row.workflow_data || '{}')),
    source: row.source,
    sourceProposalId: row.source_proposal_id,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));

  return c.json({ currentWorkflowHash, history });
});

/**
 * GET /api/workflows/:id/proposals
 * List self-modification proposals for a workflow.
 */
workflowsRouter.get('/:id/proposals', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const { limit, offset, status } = c.req.query();

  const workflow = await c.env.DB.prepare(`
    SELECT id
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{ id: string }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  const params: unknown[] = [workflow.id];
  let query = `
    SELECT id, workflow_id, execution_id, proposed_by_session_id, base_workflow_hash, proposal_json,
           diff_text, status, review_notes, expires_at, created_at, updated_at
    FROM workflow_mutation_proposals
    WHERE workflow_id = ?
  `;

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit || '50', 10), parseInt(offset || '0', 10));

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const proposals = result.results.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    executionId: row.execution_id,
    proposedBySessionId: row.proposed_by_session_id,
    baseWorkflowHash: row.base_workflow_hash,
    proposal: parseJsonObject(row.proposal_json as string),
    diffText: row.diff_text,
    status: row.status,
    reviewNotes: row.review_notes,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({ proposals });
});

/**
 * POST /api/workflows/:id/proposals
 * Create a self-modification proposal.
 */
workflowsRouter.post('/:id/proposals', zValidator('json', createProposalSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const workflow = await c.env.DB.prepare(`
    SELECT id, data
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{ id: string; data: string }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }
  if (!workflowAllowsSelfModification(workflow.data)) {
    throw new ValidationError('Self-modification is disabled for this workflow');
  }

  const currentHash = normalizeHash(await sha256Hex(String(workflow.data ?? '{}')));
  const baseHash = normalizeHash(body.baseWorkflowHash);
  if (currentHash !== baseHash) {
    throw new ValidationError('Base workflow hash mismatch; proposal is stale');
  }

  const proposalId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = resolveProposalExpiry(body.expiresAt);

  await c.env.DB.prepare(`
    INSERT INTO workflow_mutation_proposals
      (id, workflow_id, execution_id, proposed_by_session_id, base_workflow_hash, proposal_json, diff_text, status, review_notes, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    proposalId,
    workflow.id,
    body.executionId || null,
    body.proposedBySessionId || null,
    baseHash,
    JSON.stringify(body.proposal),
    body.diffText || null,
    'pending',
    null,
    expiresAt,
    now,
    now,
  ).run();

  return c.json({
    proposal: {
      id: proposalId,
      workflowId: workflow.id,
      executionId: body.executionId || null,
      proposedBySessionId: body.proposedBySessionId || null,
      baseWorkflowHash: baseHash,
      proposal: body.proposal,
      diffText: body.diffText || null,
      status: 'pending',
      reviewNotes: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  }, 201);
});

/**
 * POST /api/workflows/:id/proposals/:proposalId/review
 * Approve or reject a proposal before apply.
 */
workflowsRouter.post('/:id/proposals/:proposalId/review', zValidator('json', reviewProposalSchema), async (c) => {
  const { id, proposalId } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const workflow = await c.env.DB.prepare(`
    SELECT id
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{ id: string }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  const proposal = await c.env.DB.prepare(`
    SELECT id, status
    FROM workflow_mutation_proposals
    WHERE id = ? AND workflow_id = ?
  `).bind(proposalId, workflow.id).first<{ id: string; status: string }>();

  if (!proposal) {
    throw new NotFoundError('Workflow proposal', proposalId);
  }

  if (proposal.status !== 'pending') {
    throw new ValidationError(`Proposal is already ${proposal.status}`);
  }

  const nextStatus = body.approve ? 'approved' : 'rejected';
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    UPDATE workflow_mutation_proposals
    SET status = ?, review_notes = ?, updated_at = ?
    WHERE id = ?
  `).bind(nextStatus, body.notes || null, now, proposalId).run();

  return c.json({ success: true, status: nextStatus, reviewedAt: now });
});

/**
 * POST /api/workflows/:id/proposals/:proposalId/apply
 * Apply an approved proposal to the workflow definition.
 */
workflowsRouter.post('/:id/proposals/:proposalId/apply', zValidator('json', applyProposalSchema), async (c) => {
  const { id, proposalId } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const workflow = await c.env.DB.prepare(`
    SELECT id, version, data, slug, name, description, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{
    id: string;
    version: string | null;
    data: string;
    slug: string | null;
    name: string;
    description: string | null;
    enabled: number;
    tags: string | null;
    created_at: string;
    updated_at: string;
  }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }
  if (!workflowAllowsSelfModification(workflow.data)) {
    throw new ValidationError('Self-modification is disabled for this workflow');
  }

  const proposal = await c.env.DB.prepare(`
    SELECT id, workflow_id, base_workflow_hash, proposal_json, status, expires_at, review_notes
    FROM workflow_mutation_proposals
    WHERE id = ? AND workflow_id = ?
  `).bind(proposalId, workflow.id).first<{
    id: string;
    workflow_id: string;
    base_workflow_hash: string;
    proposal_json: string;
    status: string;
    expires_at: string | null;
    review_notes: string | null;
  }>();

  if (!proposal) {
    throw new NotFoundError('Workflow proposal', proposalId);
  }

  if (proposal.status === 'applied') {
    return c.json({ success: true, status: 'applied', message: 'Proposal already applied' });
  }
  if (proposal.status !== 'approved') {
    throw new ValidationError(`Proposal must be approved before apply (current: ${proposal.status})`);
  }
  if (proposal.expires_at && new Date(proposal.expires_at).getTime() < Date.now()) {
    throw new ValidationError('Proposal has expired');
  }

  const currentHash = normalizeHash(await sha256Hex(String(workflow.data ?? '{}')));
  const baseHash = normalizeHash(proposal.base_workflow_hash);
  if (currentHash !== baseHash) {
    throw new ValidationError('Base workflow hash mismatch; proposal is stale');
  }

  const proposalJson = parseJsonObject(proposal.proposal_json);
  const proposedWorkflow = extractProposedWorkflow(proposalJson);
  if (!proposedWorkflow) {
    throw new ValidationError('Proposal missing proposed workflow payload');
  }
  if (!Array.isArray(proposedWorkflow.steps)) {
    throw new ValidationError('Proposed workflow is invalid: steps must be an array');
  }

  const now = new Date().toISOString();
  const nextVersion = body.version || bumpPatchVersion(workflow.version);

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowData: workflow.data,
    source: 'proposal_apply',
    sourceProposalId: proposal.id,
    notes: 'Pre-apply snapshot',
    createdBy: user.id,
    createdAt: now,
  });

  await c.env.DB.prepare(`
    UPDATE workflows
    SET data = ?, version = ?, updated_at = ?
    WHERE id = ?
  `).bind(JSON.stringify(proposedWorkflow), nextVersion, now, workflow.id).run();

  await c.env.DB.prepare(`
    UPDATE workflow_mutation_proposals
    SET status = 'applied',
        review_notes = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(body.reviewNotes || proposal.review_notes || null, now, proposal.id).run();

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: workflow.id,
    workflowVersion: nextVersion,
    workflowData: JSON.stringify(proposedWorkflow),
    source: 'proposal_apply',
    sourceProposalId: proposal.id,
    notes: body.reviewNotes || proposal.review_notes || null,
    createdBy: user.id,
    createdAt: now,
  });

  return c.json({
    success: true,
    proposalId: proposal.id,
    workflow: {
      id: workflow.id,
      slug: workflow.slug,
      name: workflow.name,
      description: workflow.description,
      version: nextVersion,
      data: proposedWorkflow,
      enabled: Boolean(workflow.enabled),
      tags: workflow.tags ? JSON.parse(workflow.tags) : [],
      createdAt: workflow.created_at,
      updatedAt: now,
    },
  });
});

/**
 * POST /api/workflows/:id/rollback
 * Roll back workflow definition to a historical snapshot hash.
 */
workflowsRouter.post('/:id/rollback', zValidator('json', rollbackWorkflowSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const workflow = await c.env.DB.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(id, id, user.id).first<{
    id: string;
    slug: string | null;
    name: string;
    description: string | null;
    version: string | null;
    data: string;
    enabled: number;
    tags: string | null;
    created_at: string;
  }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', id);
  }

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowData: workflow.data,
    source: 'system',
    createdBy: user.id,
  });

  const targetHash = normalizeHash(body.targetWorkflowHash);
  const target = await c.env.DB.prepare(`
    SELECT workflow_version, workflow_hash, workflow_data
    FROM workflow_version_history
    WHERE workflow_id = ? AND workflow_hash = ?
    LIMIT 1
  `).bind(workflow.id, targetHash).first<{
    workflow_version: string | null;
    workflow_hash: string;
    workflow_data: string;
  }>();

  if (!target) {
    throw new NotFoundError('Workflow history entry', targetHash);
  }

  const parsedTarget = parseJsonObject(target.workflow_data);
  if (!Array.isArray(parsedTarget.steps)) {
    throw new ValidationError('Historical workflow snapshot is invalid');
  }

  const currentHash = normalizeHash(await sha256Hex(String(workflow.data ?? '{}')));
  if (currentHash === targetHash) {
    return c.json({
      success: true,
      message: 'Workflow already at requested version',
      workflow: {
        id: workflow.id,
        slug: workflow.slug,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        data: parseJsonObject(workflow.data),
        enabled: Boolean(workflow.enabled),
        tags: workflow.tags ? JSON.parse(workflow.tags) : [],
        createdAt: workflow.created_at,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  const now = new Date().toISOString();
  const nextVersion = body.version || bumpPatchVersion(workflow.version);

  await c.env.DB.prepare(`
    UPDATE workflows
    SET data = ?, version = ?, updated_at = ?
    WHERE id = ?
  `).bind(target.workflow_data, nextVersion, now, workflow.id).run();

  await saveWorkflowHistorySnapshot(c.env, {
    workflowId: workflow.id,
    workflowVersion: nextVersion,
    workflowData: target.workflow_data,
    source: 'rollback',
    notes: body.notes || `Rollback to ${target.workflow_hash}`,
    createdBy: user.id,
    createdAt: now,
  });

  return c.json({
    success: true,
    workflow: {
      id: workflow.id,
      slug: workflow.slug,
      name: workflow.name,
      description: workflow.description,
      version: nextVersion,
      data: parsedTarget,
      enabled: Boolean(workflow.enabled),
      tags: workflow.tags ? JSON.parse(workflow.tags) : [],
      createdAt: workflow.created_at,
      updatedAt: now,
    },
  });
});
