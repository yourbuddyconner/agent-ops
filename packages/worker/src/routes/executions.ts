import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, UnauthorizedError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

export const executionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const completionSchema = z.object({
  status: z.enum(['completed', 'failed']),
  outputs: z.record(z.unknown()).optional(),
  steps: z
    .array(
      z.object({
        stepId: z.string(),
        status: z.string(),
        output: z.unknown().optional(),
        error: z.string().optional(),
      })
    )
    .optional(),
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

/**
 * GET /api/executions
 * List recent workflow executions for the user
 */
executionsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { limit, offset, status, workflowId } = c.req.query();

  let query = `
    SELECT e.*, w.name as workflow_name
    FROM workflow_executions e
    LEFT JOIN workflows w ON e.workflow_id = w.id
    WHERE e.user_id = ?
  `;
  const params: unknown[] = [user.id];

  if (status) {
    query += ' AND e.status = ?';
    params.push(status);
  }

  if (workflowId) {
    query += ' AND e.workflow_id = ?';
    params.push(workflowId);
  }

  query += ' ORDER BY e.started_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit || '50'));
  params.push(parseInt(offset || '0'));

  const result = await c.env.DB.prepare(query).bind(...params).all();

  const executions = result.results.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
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

/**
 * GET /api/executions/:id
 * Get a single execution
 */
executionsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const row = await c.env.DB.prepare(`
    SELECT e.*, w.name as workflow_name, t.name as trigger_name
    FROM workflow_executions e
    LEFT JOIN workflows w ON e.workflow_id = w.id
    LEFT JOIN triggers t ON e.trigger_id = t.id
    WHERE e.id = ? AND e.user_id = ?
  `).bind(id, user.id).first();

  if (!row) {
    throw new NotFoundError('Execution', id);
  }

  return c.json({
    execution: {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      sessionId: row.session_id,
      triggerId: row.trigger_id,
      triggerName: row.trigger_name,
      status: row.status,
      triggerType: row.trigger_type,
      triggerMetadata: row.trigger_metadata ? JSON.parse(row.trigger_metadata as string) : null,
      variables: row.variables ? JSON.parse(row.variables as string) : null,
      outputs: row.outputs ? JSON.parse(row.outputs as string) : null,
      steps: row.steps ? JSON.parse(row.steps as string) : null,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    },
  });
});

/**
 * POST /api/executions/:id/complete
 * Called by the plugin to report execution completion
 * This endpoint is called from the container, so we verify using the API token
 */
executionsRouter.post('/:id/complete', zValidator('json', completionSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid('json');

  // This can be called either:
  // 1. By an authenticated user (via normal auth middleware)
  // 2. By the plugin using an API token
  const user = c.get('user');

  // Verify the execution exists and belongs to this user
  const execution = await c.env.DB.prepare(`
    SELECT user_id, status FROM workflow_executions WHERE id = ?
  `).bind(id).first();

  if (!execution) {
    throw new NotFoundError('Execution', id);
  }

  if (execution.user_id !== user.id) {
    throw new UnauthorizedError('Unauthorized to update this execution');
  }

  // Prevent updating already-completed executions
  if (execution.status === 'completed' || execution.status === 'failed') {
    throw new ValidationError('Execution already finalized');
  }

  const completedAt = body.completedAt || new Date().toISOString();

  // Update the execution record
  await c.env.DB.prepare(`
    UPDATE workflow_executions
    SET status = ?,
        outputs = ?,
        steps = ?,
        error = ?,
        completed_at = ?
    WHERE id = ?
  `).bind(
    body.status,
    body.outputs ? JSON.stringify(body.outputs) : null,
    body.steps ? JSON.stringify(body.steps) : null,
    body.error || null,
    completedAt,
    id
  ).run();

  return c.json({ success: true, status: body.status, completedAt });
});

/**
 * POST /api/executions/:id/status
 * Update execution status (e.g., pending -> running)
 */
executionsRouter.post('/:id/status', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json();

  const { status } = body;

  if (!['pending', 'running', 'waiting_approval'].includes(status)) {
    throw new ValidationError('Invalid status');
  }

  // Verify the execution exists and belongs to this user
  const execution = await c.env.DB.prepare(`
    SELECT user_id, status FROM workflow_executions WHERE id = ?
  `).bind(id).first();

  if (!execution) {
    throw new NotFoundError('Execution', id);
  }

  if (execution.user_id !== user.id) {
    throw new UnauthorizedError('Unauthorized to update this execution');
  }

  // Prevent updating already-completed executions
  if (execution.status === 'completed' || execution.status === 'failed') {
    throw new ValidationError('Execution already finalized');
  }

  await c.env.DB.prepare(`
    UPDATE workflow_executions SET status = ? WHERE id = ?
  `).bind(status, id).run();

  return c.json({ success: true, status });
});
