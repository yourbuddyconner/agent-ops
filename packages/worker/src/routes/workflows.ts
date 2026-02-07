import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

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
    variables: row.variables ? JSON.parse(row.variables as string) : null,
    outputs: row.outputs ? JSON.parse(row.outputs as string) : null,
    steps: row.steps ? JSON.parse(row.steps as string) : null,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));

  return c.json({ executions });
});
