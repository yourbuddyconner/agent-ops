import type { D1Database } from '@cloudflare/workers-types';
import { ValidationError } from '@agent-ops/shared';
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { workflows, triggers, workflowMutationProposals, workflowVersionHistory } from '../schema/index.js';
import { sha256Hex } from '../workflow-runtime.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Pure Helpers ────────────────────────────────────────────────────────────

export function normalizeHash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'sha256:';
  return trimmed.startsWith('sha256:') ? trimmed : `sha256:${trimmed}`;
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function extractProposedWorkflow(proposal: Record<string, unknown>): Record<string, unknown> | null {
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

export function bumpPatchVersion(version: string | null): string {
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

export function workflowAllowsSelfModification(rawWorkflowData: string): boolean {
  const workflowData = parseJsonObject(rawWorkflowData);
  const constraints = workflowData.constraints;
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
    return false;
  }

  return (constraints as Record<string, unknown>).allowSelfModification === true;
}

export function resolveProposalExpiry(expiresAt?: string): string {
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

// ─── Row Types ───────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  version: string | null;
  data: string;
  enabled: number;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalRow {
  id: string;
  workflow_id: string;
  execution_id: string | null;
  proposed_by_session_id: string | null;
  base_workflow_hash: string;
  proposal_json: string;
  diff_text: string | null;
  status: string;
  review_notes: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Data Access ─────────────────────────────────────────────────────────────

export async function listWorkflows(db: D1Database, userId: string) {
  const drizzle = getDb(db);
  return { results: await drizzle
    .select({
      id: workflows.id,
      slug: workflows.slug,
      name: workflows.name,
      description: workflows.description,
      version: workflows.version,
      data: workflows.data,
      enabled: workflows.enabled,
      tags: workflows.tags,
      created_at: workflows.createdAt,
      updated_at: workflows.updatedAt,
    })
    .from(workflows)
    .where(eq(workflows.userId, userId))
    .orderBy(desc(workflows.updatedAt)),
  };
}

export async function getWorkflowByIdOrSlug(db: D1Database, userId: string, idOrSlug: string) {
  // OR condition — keep as raw SQL
  return db.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first();
}

export async function getWorkflowByIdOrSlugTyped<T>(db: D1Database, userId: string, idOrSlug: string) {
  return db.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first<T>();
}

export async function upsertWorkflow(
  db: D1Database,
  params: {
    id: string;
    userId: string;
    slug: string | null;
    name: string;
    description: string | null;
    version: string;
    data: string;
    now: string;
  }
) {
  // ON CONFLICT(id) with excluded refs — use raw SQL since Drizzle data column isn't JSON mode here
  await db.prepare(`
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
    params.id,
    params.userId,
    params.slug,
    params.name,
    params.description,
    params.version,
    params.data,
    params.now,
    params.now
  ).run();
}

export async function getExistingWorkflowIds(db: D1Database, userId: string) {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.userId, userId));
  return new Set(rows.map((r) => r.id));
}

export async function deleteWorkflowById(db: D1Database, workflowId: string, userId: string) {
  return db.prepare(`
    DELETE FROM workflows WHERE id = ? AND user_id = ?
  `).bind(workflowId, userId).run();
}

export async function updateWorkflow(db: D1Database, workflowId: string, setClauses: string[], values: unknown[]) {
  await db.prepare(`
    UPDATE workflows SET ${setClauses.join(', ')} WHERE id = ?
  `).bind(...values).run();
}

export async function getWorkflowById(db: D1Database, workflowId: string) {
  const drizzle = getDb(db);
  return drizzle
    .select({
      id: workflows.id,
      slug: workflows.slug,
      name: workflows.name,
      description: workflows.description,
      version: workflows.version,
      data: workflows.data,
      enabled: workflows.enabled,
      tags: workflows.tags,
      created_at: workflows.createdAt,
      updated_at: workflows.updatedAt,
    })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .get();
}

export async function deleteWorkflowTriggers(db: D1Database, workflowId: string, userId: string) {
  const drizzle = getDb(db);
  await drizzle
    .delete(triggers)
    .where(and(eq(triggers.workflowId, workflowId), eq(triggers.userId, userId)));
}

export async function deleteWorkflowByIdOrSlug(db: D1Database, idOrSlug: string, userId: string) {
  return db.prepare(`
    DELETE FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).run();
}

export async function getWorkflowOwnerCheck(db: D1Database, userId: string, idOrSlug: string) {
  return db.prepare(`
    SELECT id FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first<{ id: string }>();
}

// ─── Execution History ───────────────────────────────────────────────────────

export async function listWorkflowExecutions(
  db: D1Database,
  workflowId: string,
  userId: string,
  opts: { limit?: number; offset?: number } = {}
) {
  return db.prepare(`
    SELECT id, workflow_id, session_id, trigger_id, status, trigger_type, trigger_metadata,
           resume_token,
           variables, outputs, steps, error, started_at, completed_at
    FROM workflow_executions
    WHERE workflow_id = ? AND user_id = ?
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).bind(workflowId, userId, opts.limit ?? 50, opts.offset ?? 0).all();
}

// ─── Version History ─────────────────────────────────────────────────────────

export async function saveWorkflowHistorySnapshot(
  db: D1Database,
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

  // ON CONFLICT DO NOTHING — use raw SQL
  await db.prepare(`
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

export async function getWorkflowForHistory(db: D1Database, userId: string, idOrSlug: string) {
  return db.prepare(`
    SELECT id, version, data, updated_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first<{
    id: string;
    version: string | null;
    data: string;
    updated_at: string;
  }>();
}

export async function listWorkflowHistory(
  db: D1Database,
  workflowId: string,
  opts: { limit?: number; offset?: number } = {}
) {
  return db.prepare(`
    SELECT id, workflow_id, workflow_version, workflow_hash, workflow_data, source, source_proposal_id, notes, created_by, created_at
    FROM workflow_version_history
    WHERE workflow_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(workflowId, opts.limit ?? 50, opts.offset ?? 0).all();
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export async function getWorkflowForProposalCheck(db: D1Database, userId: string, idOrSlug: string) {
  return db.prepare(`
    SELECT id, data
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first<{ id: string; data: string }>();
}

export async function listWorkflowProposals(
  db: D1Database,
  workflowId: string,
  opts: { limit?: number; offset?: number; status?: string } = {}
) {
  const params: unknown[] = [workflowId];
  let query = `
    SELECT id, workflow_id, execution_id, proposed_by_session_id, base_workflow_hash, proposal_json,
           diff_text, status, review_notes, expires_at, created_at, updated_at
    FROM workflow_mutation_proposals
    WHERE workflow_id = ?
  `;

  if (opts.status) {
    query += ' AND status = ?';
    params.push(opts.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(opts.limit ?? 50, opts.offset ?? 0);

  return db.prepare(query).bind(...params).all();
}

export async function insertProposal(
  db: D1Database,
  params: {
    id: string;
    workflowId: string;
    executionId: string | null;
    proposedBySessionId: string | null;
    baseWorkflowHash: string;
    proposalJson: string;
    diffText: string | null;
    expiresAt: string;
    now: string;
  }
) {
  const drizzle = getDb(db);
  await drizzle.insert(workflowMutationProposals).values({
    id: params.id,
    workflowId: params.workflowId,
    executionId: params.executionId,
    proposedBySessionId: params.proposedBySessionId,
    baseWorkflowHash: params.baseWorkflowHash,
    proposalJson: params.proposalJson,
    diffText: params.diffText,
    status: 'pending',
    expiresAt: params.expiresAt,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

export async function getProposalForReview(db: D1Database, proposalId: string, workflowId: string) {
  const drizzle = getDb(db);
  return drizzle
    .select({ id: workflowMutationProposals.id, status: workflowMutationProposals.status })
    .from(workflowMutationProposals)
    .where(and(eq(workflowMutationProposals.id, proposalId), eq(workflowMutationProposals.workflowId, workflowId)))
    .get();
}

export async function updateProposalStatus(
  db: D1Database,
  proposalId: string,
  status: string,
  reviewNotes: string | null,
  now: string
) {
  const drizzle = getDb(db);
  await drizzle
    .update(workflowMutationProposals)
    .set({ status, reviewNotes, updatedAt: now })
    .where(eq(workflowMutationProposals.id, proposalId));
}

export async function getProposalForApply(db: D1Database, proposalId: string, workflowId: string) {
  return db.prepare(`
    SELECT id, workflow_id, base_workflow_hash, proposal_json, status, expires_at, review_notes
    FROM workflow_mutation_proposals
    WHERE id = ? AND workflow_id = ?
  `).bind(proposalId, workflowId).first<{
    id: string;
    workflow_id: string;
    base_workflow_hash: string;
    proposal_json: string;
    status: string;
    expires_at: string | null;
    review_notes: string | null;
  }>();
}

export async function applyWorkflowUpdate(
  db: D1Database,
  workflowId: string,
  data: string,
  version: string,
  now: string
) {
  const drizzle = getDb(db);
  await drizzle
    .update(workflows)
    .set({ data, version, updatedAt: now })
    .where(eq(workflows.id, workflowId));
}

export async function markProposalApplied(
  db: D1Database,
  proposalId: string,
  reviewNotes: string | null,
  now: string
) {
  const drizzle = getDb(db);
  await drizzle
    .update(workflowMutationProposals)
    .set({ status: 'applied', reviewNotes, updatedAt: now })
    .where(eq(workflowMutationProposals.id, proposalId));
}

// ─── Rollback ────────────────────────────────────────────────────────────────

export async function getWorkflowForRollback(db: D1Database, userId: string, idOrSlug: string) {
  return db.prepare(`
    SELECT id, slug, name, description, version, data, enabled, tags, created_at
    FROM workflows
    WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(idOrSlug, idOrSlug, userId).first<{
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
}

export async function getHistoryByHash(db: D1Database, workflowId: string, hash: string) {
  const drizzle = getDb(db);
  return drizzle
    .select({
      workflow_version: workflowVersionHistory.workflowVersion,
      workflow_hash: workflowVersionHistory.workflowHash,
      workflow_data: workflowVersionHistory.workflowData,
    })
    .from(workflowVersionHistory)
    .where(and(eq(workflowVersionHistory.workflowId, workflowId), eq(workflowVersionHistory.workflowHash, hash)))
    .limit(1)
    .get();
}
