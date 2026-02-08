import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, UnauthorizedError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

export const executionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const executionStepSchema = z.object({
  stepId: z.string(),
  status: z.enum(['pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'skipped']),
  attempt: z.number().int().positive().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const completionSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  outputs: z.record(z.unknown()).optional(),
  steps: z.array(executionStepSchema).optional(),
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

const approvalSchema = z.object({
  approve: z.boolean(),
  resumeToken: z.string().min(1),
  reason: z.string().optional(),
});

const cancelSchema = z.object({
  reason: z.string().optional(),
});

function parseNullableJson(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildWorkflowStepOrderMap(workflowSnapshotRaw: string | null): Map<string, number> {
  if (!workflowSnapshotRaw) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowSnapshotRaw);
  } catch {
    return new Map();
  }

  const order = new Map<string, number>();
  let index = 0;

  const visitStepList = (rawSteps: unknown): void => {
    if (!Array.isArray(rawSteps)) return;

    for (const entry of rawSteps) {
      if (!isRecord(entry)) continue;

      const stepId = typeof entry.id === 'string' ? entry.id : '';
      if (stepId && !order.has(stepId)) {
        order.set(stepId, index);
        index += 1;
      }

      visitStepList(entry.then);
      visitStepList(entry.else);
      visitStepList(entry.steps);
    }
  };

  if (isRecord(parsed)) {
    visitStepList(parsed.steps);
  } else if (Array.isArray(parsed)) {
    visitStepList(parsed);
  }

  return order;
}

function rankStepOrderIndex(value: number | null): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

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
    resumeToken: row.resume_token || null,
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
      resumeToken: row.resume_token || null,
      outputs: row.outputs ? JSON.parse(row.outputs as string) : null,
      steps: row.steps ? JSON.parse(row.steps as string) : null,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    },
  });
});

/**
 * GET /api/executions/:id/steps
 * Get normalized step-level trace for an execution.
 */
executionsRouter.get('/:id/steps', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const execution = await c.env.DB.prepare(`
    SELECT id, user_id, workflow_snapshot
    FROM workflow_executions
    WHERE id = ?
  `).bind(id).first<{ id: string; user_id: string; workflow_snapshot: string | null }>();

  if (!execution) {
    throw new NotFoundError('Execution', id);
  }
  if (execution.user_id !== user.id) {
    throw new UnauthorizedError('Unauthorized to access this execution');
  }

  const workflowStepOrder = buildWorkflowStepOrderMap(execution.workflow_snapshot);

  const result = await c.env.DB.prepare(`
    SELECT rowid AS insertion_order,
           id, execution_id, step_id, attempt, status, input_json, output_json, error, started_at, completed_at, created_at
    FROM workflow_execution_steps
    WHERE execution_id = ?
    ORDER BY
      attempt ASC,
      insertion_order ASC
  `).bind(id).all();

  const steps = result.results
    .map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      stepId: String(row.step_id),
      attempt: Number(row.attempt || 1),
      status: String(row.status),
      input: parseNullableJson((row.input_json as string | null) || null),
      output: parseNullableJson((row.output_json as string | null) || null),
      error: (row.error as string | null) || null,
      startedAt: (row.started_at as string | null) || null,
      completedAt: (row.completed_at as string | null) || null,
      createdAt: String(row.created_at),
      workflowStepIndex: workflowStepOrder.get(String(row.step_id)) ?? null,
      insertionOrder: Number(row.insertion_order || 0),
    }))
    .sort((left, right) => {
      if (left.attempt !== right.attempt) {
        return left.attempt - right.attempt;
      }

      const leftIndex = rankStepOrderIndex(left.workflowStepIndex);
      const rightIndex = rankStepOrderIndex(right.workflowStepIndex);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      if (left.insertionOrder !== right.insertionOrder) {
        return left.insertionOrder - right.insertionOrder;
      }

      return left.stepId.localeCompare(right.stepId);
    })
    .map((step, sequence) => ({
      id: step.id,
      executionId: step.executionId,
      stepId: step.stepId,
      attempt: step.attempt,
      status: step.status,
      input: step.input,
      output: step.output,
      error: step.error,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      createdAt: step.createdAt,
      workflowStepIndex: step.workflowStepIndex,
      sequence,
    }));

  return c.json({ steps });
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
  if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
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

  if (body.steps?.length) {
    for (const step of body.steps) {
      const attempt = step.attempt ?? 1;
      await c.env.DB.prepare(`
        INSERT INTO workflow_execution_steps
          (id, execution_id, step_id, attempt, status, input_json, output_json, error, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(execution_id, step_id, attempt) DO UPDATE SET
          status = excluded.status,
          input_json = COALESCE(excluded.input_json, workflow_execution_steps.input_json),
          output_json = COALESCE(excluded.output_json, workflow_execution_steps.output_json),
          error = excluded.error,
          started_at = COALESCE(excluded.started_at, workflow_execution_steps.started_at),
          completed_at = COALESCE(excluded.completed_at, workflow_execution_steps.completed_at)
      `).bind(
        crypto.randomUUID(),
        id,
        step.stepId,
        attempt,
        step.status,
        step.input !== undefined ? JSON.stringify(step.input) : null,
        step.output !== undefined ? JSON.stringify(step.output) : null,
        step.error || null,
        step.startedAt || null,
        step.completedAt || null,
      ).run();
    }
  }

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
  if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
    throw new ValidationError('Execution already finalized');
  }

  await c.env.DB.prepare(`
    UPDATE workflow_executions SET status = ? WHERE id = ?
  `).bind(status, id).run();

  return c.json({ success: true, status });
});

/**
 * POST /api/executions/:id/approve
 * Approve or deny a waiting approval checkpoint.
 */
executionsRouter.post('/:id/approve', zValidator('json', approvalSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const execution = await c.env.DB.prepare(`
    SELECT user_id, status FROM workflow_executions WHERE id = ?
  `).bind(id).first<{ user_id: string; status: string }>();

  if (!execution) {
    throw new NotFoundError('Execution', id);
  }
  if (execution.user_id !== user.id) {
    throw new UnauthorizedError('Unauthorized to update this execution');
  }

  const doId = c.env.WORKFLOW_EXECUTOR.idFromName(id);
  const stub = c.env.WORKFLOW_EXECUTOR.get(doId);
  const response = await stub.fetch(new Request('https://workflow-executor/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      executionId: id,
      resumeToken: body.resumeToken,
      approve: body.approve,
      reason: body.reason,
    }),
  }));

  if (!response.ok) {
    const errorBody = await response
      .json<{ error?: string }>()
      .catch((): { error?: string } => ({ error: undefined }));
    throw new ValidationError(errorBody.error || 'Failed to apply approval decision');
  }

  const result = await response.json<{ ok: boolean; status: string }>();
  return c.json({ success: true, status: result.status });
});

/**
 * POST /api/executions/:id/cancel
 * Cancel an execution (best-effort for running executions).
 */
executionsRouter.post('/:id/cancel', zValidator('json', cancelSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  const execution = await c.env.DB.prepare(`
    SELECT user_id, status FROM workflow_executions WHERE id = ?
  `).bind(id).first<{ user_id: string; status: string }>();

  if (!execution) {
    throw new NotFoundError('Execution', id);
  }
  if (execution.user_id !== user.id) {
    throw new UnauthorizedError('Unauthorized to update this execution');
  }

  const doId = c.env.WORKFLOW_EXECUTOR.idFromName(id);
  const stub = c.env.WORKFLOW_EXECUTOR.get(doId);
  const response = await stub.fetch(new Request('https://workflow-executor/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      executionId: id,
      reason: body.reason,
    }),
  }));

  if (!response.ok) {
    const errorBody = await response
      .json<{ error?: string }>()
      .catch((): { error?: string } => ({ error: undefined }));
    throw new ValidationError(errorBody.error || 'Failed to cancel execution');
  }

  const result = await response.json<{ ok: boolean; status: string }>();
  return c.json({ success: true, status: result.status });
});
