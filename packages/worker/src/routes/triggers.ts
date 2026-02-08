import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import {
  checkWorkflowConcurrency,
  createWorkflowSession,
  dispatchOrchestratorPrompt,
  enqueueWorkflowExecution,
  sha256Hex,
} from '../lib/workflow-runtime.js';

export const triggersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const webhookConfigSchema = z.object({
  type: z.literal('webhook'),
  path: z.string().min(1),
  method: z.enum(['GET', 'POST']).optional().default('POST'),
  secret: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

const scheduleConfigSchema = z.object({
  type: z.literal('schedule'),
  cron: z.string().min(1),
  timezone: z.string().optional(),
  target: z.enum(['workflow', 'orchestrator']).optional().default('workflow'),
  prompt: z.string().min(1).max(100000).optional(),
});

const manualConfigSchema = z.object({
  type: z.literal('manual'),
});

const triggerConfigSchema = z.discriminatedUnion('type', [
  webhookConfigSchema,
  scheduleConfigSchema,
  manualConfigSchema,
]);

function scheduleTarget(config: z.infer<typeof triggerConfigSchema>): 'workflow' | 'orchestrator' {
  if (config.type !== 'schedule') return 'workflow';
  return config.target === 'orchestrator' ? 'orchestrator' : 'workflow';
}

function requiresWorkflow(config: z.infer<typeof triggerConfigSchema>): boolean {
  return config.type !== 'schedule' || scheduleTarget(config) === 'workflow';
}

const createTriggerSchema = z.object({
  workflowId: z.string().min(1).optional(),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  config: triggerConfigSchema,
  variableMapping: z.record(z.string()).optional(),
}).superRefine((value, ctx) => {
  if (value.config.type === 'schedule' && scheduleTarget(value.config) === 'orchestrator' && !value.config.prompt?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Schedule triggers targeting orchestrator require a prompt',
      path: ['config', 'prompt'],
    });
  }
  if (requiresWorkflow(value.config) && !value.workflowId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'workflowId is required for this trigger type',
      path: ['workflowId'],
    });
  }
});

const updateTriggerSchema = z.object({
  workflowId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: triggerConfigSchema.optional(),
  variableMapping: z.record(z.string()).optional(),
});

const manualRunSchema = z.object({
  workflowId: z.string().min(1),
  clientRequestId: z.string().min(8).optional(),
  variables: z.record(z.unknown()).optional(),
});

const triggerRunSchema = z.object({
  clientRequestId: z.string().min(8).optional(),
  variables: z.record(z.unknown()).optional(),
}).passthrough();

/**
 * POST /api/triggers/manual/run
 * Run a workflow directly without a trigger
 * NOTE: This route MUST be defined before /:id routes to avoid being matched as an ID
 */
triggersRouter.post('/manual/run', zValidator('json', manualRunSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const { workflowId, variables = {} } = body;
  const workerOrigin = new URL(c.req.url).origin;

  // Verify user owns the workflow
  const workflow = await c.env.DB.prepare(`
    SELECT id, name, version, data FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(workflowId, workflowId, user.id).first<{
    id: string;
    name: string;
    version: string | null;
    data: string;
  }>();

  if (!workflow) {
    throw new NotFoundError('Workflow', workflowId);
  }

  const concurrency = await checkWorkflowConcurrency(c.env.DB, user.id);
  if (!concurrency.allowed) {
    return c.json({
      error: 'Too many concurrent workflow executions',
      reason: concurrency.reason,
      activeUser: concurrency.activeUser,
      activeGlobal: concurrency.activeGlobal,
    }, 429);
  }

  const clientRequestId = body.clientRequestId || crypto.randomUUID();
  const idempotencyKey = `manual:${workflow.id}:${user.id}:${clientRequestId}`;
  const existing = await c.env.DB.prepare(`
    SELECT id, status, session_id
    FROM workflow_executions
    WHERE workflow_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(workflow.id, idempotencyKey).first();

  if (existing) {
    return c.json(
      {
        executionId: existing.id,
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: existing.status,
        variables,
        sessionId: existing.session_id,
        message: 'Workflow execution already exists for this request.',
      },
      200
    );
  }

  const executionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const workflowHash = await sha256Hex(String(workflow.data ?? '{}'));
  const sessionId = await createWorkflowSession(c.env.DB, {
    userId: user.id,
    workflowId: workflow.id,
    executionId,
  });

  // Log execution
  await c.env.DB.prepare(`
    INSERT INTO workflow_executions
      (id, workflow_id, user_id, trigger_id, status, trigger_type, trigger_metadata, variables, started_at,
       workflow_version, workflow_hash, workflow_snapshot, idempotency_key, session_id, initiator_type, initiator_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    executionId,
    workflow.id,
    user.id,
    null,
    'pending',
    'manual',
    JSON.stringify({ triggeredBy: 'api', direct: true }),
    JSON.stringify(variables),
    now,
    workflow.version || null,
    workflowHash,
    workflow.data,
    idempotencyKey,
    sessionId,
    'manual',
    user.id
  ).run();

  const dispatched = await enqueueWorkflowExecution(c.env, {
    executionId,
    workflowId: workflow.id,
    userId: user.id,
    sessionId,
    triggerType: 'manual',
    workerOrigin,
  });

  return c.json(
    {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'pending',
      variables,
      sessionId,
      dispatched,
      message: dispatched
        ? 'Workflow execution queued and dispatched to workflow executor.'
        : 'Workflow execution queued. Dispatch to workflow executor failed and will need retry.',
    },
    202
  );
});

/**
 * GET /api/triggers
 * List all triggers for the user
 */
triggersRouter.get('/', async (c) => {
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    SELECT t.*, w.name as workflow_name
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `).bind(user.id).all();

  const triggers = result.results.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    name: row.name,
    enabled: Boolean(row.enabled),
    type: row.type,
    config: JSON.parse(row.config as string),
    variableMapping: row.variable_mapping ? JSON.parse(row.variable_mapping as string) : null,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({ triggers });
});

/**
 * GET /api/triggers/:id
 * Get a single trigger
 */
triggersRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const row = await c.env.DB.prepare(`
    SELECT t.*, w.name as workflow_name
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.id = ? AND t.user_id = ?
  `).bind(id, user.id).first();

  if (!row) {
    throw new NotFoundError('Trigger', id);
  }

  const config = JSON.parse(row.config as string);
  const host = c.req.header('host') || 'localhost:8787';
  const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
  let webhookUrl: string | undefined;
  if (row.type === 'webhook') {
    webhookUrl = `${protocol}://${host}/webhooks/${config.path}`;
  }

  return c.json({
    trigger: {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      name: row.name,
      enabled: Boolean(row.enabled),
      type: row.type,
      config,
      variableMapping: row.variable_mapping ? JSON.parse(row.variable_mapping as string) : null,
      webhookUrl,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

/**
 * POST /api/triggers
 * Create a new trigger
 */
triggersRouter.post('/', zValidator('json', createTriggerSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const requiresLinkedWorkflow = requiresWorkflow(body.config);
  let workflowId: string | null = null;
  if (requiresLinkedWorkflow || body.workflowId) {
    const workflow = await c.env.DB.prepare(`
      SELECT id FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
    `).bind(body.workflowId, body.workflowId, user.id).first<{ id: string }>();

    if (!workflow) {
      if (requiresLinkedWorkflow) {
        throw new NotFoundError('Workflow', body.workflowId || '<missing>');
      }
      throw new NotFoundError('Workflow', body.workflowId || '<invalid>');
    }
    workflowId = workflow.id;
  }

  // For webhook triggers, verify path uniqueness
  if (body.config.type === 'webhook') {
    const existing = await c.env.DB.prepare(`
      SELECT id FROM triggers
      WHERE user_id = ?
      AND type = 'webhook'
      AND json_extract(config, '$.path') = ?
    `).bind(user.id, body.config.path).first();

    if (existing) {
      throw new ValidationError('Webhook path already in use');
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO triggers (id, user_id, workflow_id, name, enabled, type, config, variable_mapping, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    user.id,
    workflowId,
    body.name,
    body.enabled ? 1 : 0,
    body.config.type,
    JSON.stringify(body.config),
    body.variableMapping ? JSON.stringify(body.variableMapping) : null,
    now,
    now
  ).run();

  // Generate webhook URL if applicable
  const host = c.req.header('host') || 'localhost:8787';
  const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
  let webhookUrl: string | undefined;
  if (body.config.type === 'webhook') {
    webhookUrl = `${protocol}://${host}/webhooks/${body.config.path}`;
  }

  return c.json(
    {
      id,
      workflowId,
      name: body.name,
      enabled: body.enabled,
      type: body.config.type,
      config: body.config,
      variableMapping: body.variableMapping,
      webhookUrl,
      createdAt: now,
      updatedAt: now,
    },
    201
  );
});

/**
 * PATCH /api/triggers/:id
 * Update a trigger
 */
triggersRouter.patch('/:id', zValidator('json', updateTriggerSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');

  // Verify trigger exists and user owns it
  const existing = await c.env.DB.prepare(`
    SELECT * FROM triggers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first<{ config: string; workflow_id: string | null }>();

  if (!existing) {
    throw new NotFoundError('Trigger', id);
  }

  const currentConfig = JSON.parse(existing.config) as z.infer<typeof triggerConfigSchema>;
  const nextConfig = body.config ?? currentConfig;
  let nextWorkflowId = body.workflowId !== undefined ? body.workflowId : existing.workflow_id;

  if (nextConfig.type === 'schedule' && scheduleTarget(nextConfig) === 'orchestrator' && !nextConfig.prompt?.trim()) {
    throw new ValidationError('Schedule triggers targeting orchestrator require a prompt');
  }

  if (requiresWorkflow(nextConfig) && !nextWorkflowId) {
    throw new ValidationError('workflowId is required for this trigger type');
  }

  if (nextWorkflowId) {
    const workflow = await c.env.DB.prepare(`
      SELECT id FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
    `).bind(nextWorkflowId, nextWorkflowId, user.id).first<{ id: string }>();

    if (!workflow) {
      throw new NotFoundError('Workflow', nextWorkflowId);
    }

    nextWorkflowId = workflow.id;
  }

  // For webhook path changes, verify uniqueness
  if (nextConfig.type === 'webhook') {
    const conflict = await c.env.DB.prepare(`
      SELECT id FROM triggers
      WHERE user_id = ?
      AND type = 'webhook'
      AND json_extract(config, '$.path') = ?
      AND id != ?
    `).bind(user.id, nextConfig.path, id).first();

    if (conflict) {
      throw new ValidationError('Webhook path already in use');
    }
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(body.enabled ? 1 : 0);
  }
  if (body.workflowId !== undefined || (body.config && !requiresWorkflow(body.config))) {
    updates.push('workflow_id = ?');
    values.push(nextWorkflowId);
  }
  if (body.config !== undefined) {
    updates.push('type = ?');
    updates.push('config = ?');
    values.push(body.config.type);
    values.push(JSON.stringify(body.config));
  }
  if (body.variableMapping !== undefined) {
    updates.push('variable_mapping = ?');
    values.push(JSON.stringify(body.variableMapping));
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await c.env.DB.prepare(`
    UPDATE triggers SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  return c.json({ success: true, updatedAt: now });
});

/**
 * DELETE /api/triggers/:id
 * Delete a trigger
 */
triggersRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    DELETE FROM triggers WHERE id = ? AND user_id = ?
  `).bind(id, user.id).run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('Trigger', id);
  }

  return c.json({ success: true });
});

/**
 * POST /api/triggers/:id/enable
 * Enable a trigger
 */
triggersRouter.post('/:id/enable', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    UPDATE triggers SET enabled = 1, updated_at = ? WHERE id = ? AND user_id = ?
  `).bind(new Date().toISOString(), id, user.id).run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('Trigger', id);
  }

  return c.json({ success: true });
});

/**
 * POST /api/triggers/:id/disable
 * Disable a trigger
 */
triggersRouter.post('/:id/disable', async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');

  const result = await c.env.DB.prepare(`
    UPDATE triggers SET enabled = 0, updated_at = ? WHERE id = ? AND user_id = ?
  `).bind(new Date().toISOString(), id, user.id).run();

  if (result.meta.changes === 0) {
    throw new NotFoundError('Trigger', id);
  }

  return c.json({ success: true });
});

/**
 * POST /api/triggers/:id/run
 * Manually run a trigger (creates session and runs workflow)
 */
triggersRouter.post('/:id/run', zValidator('json', triggerRunSchema), async (c) => {
  const { id } = c.req.param();
  const user = c.get('user');
  const body = c.req.valid('json');
  const workerOrigin = new URL(c.req.url).origin;

  const row = await c.env.DB.prepare(`
    SELECT t.*, w.id as wf_id, w.name as workflow_name, w.version as workflow_version, w.data as workflow_data
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.id = ? AND t.user_id = ?
  `).bind(id, user.id).first<{
    id: string;
    type: 'webhook' | 'schedule' | 'manual';
    config: string;
    wf_id: string | null;
    workflow_name: string | null;
    workflow_version: string | null;
    workflow_data: string | null;
    variable_mapping: string | null;
  }>();

  if (!row) {
    throw new NotFoundError('Trigger', id);
  }

  const config = JSON.parse(row.config) as z.infer<typeof triggerConfigSchema>;
  const isOrchestratorSchedule = config.type === 'schedule' && scheduleTarget(config) === 'orchestrator';
  if (isOrchestratorSchedule) {
    const prompt = config.prompt?.trim();
    if (!prompt) {
      throw new ValidationError('Schedule triggers targeting orchestrator require a prompt');
    }

    const dispatch = await dispatchOrchestratorPrompt(c.env, {
      userId: user.id,
      content: prompt,
    });

    const now = new Date().toISOString();
    if (dispatch.dispatched) {
      await c.env.DB.prepare(`
        UPDATE triggers SET last_run_at = ? WHERE id = ?
      `).bind(now, id).run();
    }

    if (!dispatch.dispatched) {
      return c.json(
        {
          error: `Failed to dispatch orchestrator prompt: ${dispatch.reason || 'unknown_error'}`,
          status: 'failed',
          workflowId: row.wf_id,
          workflowName: row.workflow_name,
          sessionId: dispatch.sessionId,
          reason: dispatch.reason || 'unknown_error',
        },
        409,
      );
    }

    return c.json(
      {
        status: 'queued',
        workflowId: row.wf_id,
        workflowName: row.workflow_name,
        sessionId: dispatch.sessionId,
        message: 'Orchestrator prompt dispatched.',
      },
      202,
    );
  }

  if (!row.wf_id || !row.workflow_data) {
    throw new ValidationError('Trigger is not linked to a workflow');
  }

  const concurrency = await checkWorkflowConcurrency(c.env.DB, user.id);
  if (!concurrency.allowed) {
    return c.json({
      error: 'Too many concurrent workflow executions',
      reason: concurrency.reason,
      activeUser: concurrency.activeUser,
      activeGlobal: concurrency.activeGlobal,
    }, 429);
  }

  // Extract variables from body using the trigger's variable mapping
  const variableMapping = row.variable_mapping
    ? JSON.parse(row.variable_mapping as string)
    : {};

  // Simple variable extraction (JSONPath would be more robust)
  const extractedVariables: Record<string, unknown> = {};
  for (const [varName, path] of Object.entries(variableMapping)) {
    const pathStr = path as string;
    if (pathStr.startsWith('$.')) {
      const key = pathStr.slice(2).split('.')[0];
      if (body[key] !== undefined) {
        extractedVariables[varName] = body[key];
      }
    }
  }

  // Merge: extracted variables + explicitly provided variables + trigger metadata
  const variables = {
    ...extractedVariables,
    ...(body.variables || {}),
    _trigger: { type: 'manual', triggerId: id },
  };

  const clientRequestId = body.clientRequestId || crypto.randomUUID();
  const idempotencyKey = `manual-trigger:${id}:${user.id}:${clientRequestId}`;
  const existing = await c.env.DB.prepare(`
    SELECT id, status, session_id
    FROM workflow_executions
    WHERE workflow_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(row.wf_id, idempotencyKey).first();

  if (existing) {
    return c.json(
      {
        executionId: existing.id,
        workflowId: row.wf_id,
        workflowName: row.workflow_name,
        status: existing.status,
        variables,
        sessionId: existing.session_id,
        message: 'Workflow execution already exists for this request.',
      },
      200
    );
  }

  const executionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const workflowHash = await sha256Hex(String(row.workflow_data ?? '{}'));
  const sessionId = await createWorkflowSession(c.env.DB, {
    userId: user.id,
    workflowId: row.wf_id,
    executionId,
  });

  // Log execution as pending first
  await c.env.DB.prepare(`
    INSERT INTO workflow_executions
      (id, workflow_id, user_id, trigger_id, status, trigger_type, trigger_metadata, variables, started_at,
       workflow_version, workflow_hash, workflow_snapshot, idempotency_key, session_id, initiator_type, initiator_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    executionId,
    row.wf_id,
    user.id,
    id,
    'pending',
    'manual',
    JSON.stringify({ triggeredBy: 'api' }),
    JSON.stringify(variables),
    now,
    row.workflow_version || null,
    workflowHash,
    row.workflow_data,
    idempotencyKey,
    sessionId,
    'manual',
    user.id
  ).run();

  const dispatched = await enqueueWorkflowExecution(c.env, {
    executionId,
    workflowId: row.wf_id,
    userId: user.id,
    sessionId,
    triggerType: 'manual',
    workerOrigin,
  });

  // Update trigger last run time
  await c.env.DB.prepare(`
    UPDATE triggers SET last_run_at = ? WHERE id = ?
  `).bind(now, id).run();

  // For now, return immediately - in production this would create an OpenCode session
  // and send the workflow.run prompt
  return c.json(
    {
      executionId,
      workflowId: row.wf_id,
      workflowName: row.workflow_name,
      status: 'pending',
      variables,
      sessionId,
      dispatched,
      message: dispatched
        ? 'Workflow execution queued and dispatched to workflow executor.'
        : 'Workflow execution queued. Dispatch to workflow executor failed and will need retry.',
    },
    202
  );
});
