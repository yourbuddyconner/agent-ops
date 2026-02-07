import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import type { Env, Variables } from './env.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';

import { sessionsRouter } from './routes/sessions.js';
import { integrationsRouter } from './routes/integrations.js';
import { filesRouter } from './routes/files.js';
import { webhooksRouter } from './routes/webhooks.js';
import { agentRouter } from './routes/agent.js';
import { authRouter } from './routes/auth.js';
import { oauthRouter } from './routes/oauth.js';
import { ogRouter } from './routes/og.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { workflowsRouter } from './routes/workflows.js';
import { triggersRouter } from './routes/triggers.js';
import { executionsRouter } from './routes/executions.js';
import { eventsRouter } from './routes/events.js';
import { reposRouter } from './routes/repos.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';
import { invitesRouter, invitesApiRouter } from './routes/invites.js';
import { orgReposAdminRouter, orgReposReadRouter } from './routes/org-repos.js';
import { personasRouter } from './routes/personas.js';
import { orchestratorRouter } from './routes/orchestrator.js';
import { checkWorkflowConcurrency, createWorkflowSession, enqueueWorkflowExecution, sha256Hex } from './lib/workflow-runtime.js';

// Durable Object exports
export { APIKeysDurableObject } from './durable-objects/api-keys.js';
export { SessionAgentDO } from './durable-objects/session-agent.js';
export { EventBusDO } from './durable-objects/event-bus.js';
export { WorkflowExecutorDO } from './durable-objects/workflow-executor.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', requestId());
app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const frontendUrl = (c.env as Env).FRONTEND_URL;
      const allowed = [frontendUrl, 'http://localhost:5173', 'http://localhost:4173'].filter(Boolean);
      if (allowed.includes(origin)) return origin;
      // Allow Cloudflare Pages preview deployments (e.g. abc123.my-agent-ops.pages.dev)
      if (frontendUrl) {
        const pagesHost = new URL(frontendUrl).hostname; // my-agent-ops.pages.dev
        if (origin.endsWith(`.${pagesHost}`) && origin.startsWith('https://')) return origin;
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id'],
    credentials: true,
  })
);

// Error handling
app.onError(errorHandler);

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook routes (authenticated via webhook signatures)
app.route('/webhooks', webhooksRouter);

// OAuth routes (no auth required — handles login flow)
app.route('/auth', oauthRouter);

// OG meta/image routes (public, no auth required)
app.route('/og', ogRouter);

// Public invite validation (no auth required)
app.route('/invites', invitesRouter);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/auth', authRouter);
app.route('/api/api-keys', apiKeysRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/integrations', integrationsRouter);
app.route('/api/files', filesRouter);
app.route('/api/workflows', workflowsRouter);
app.route('/api/triggers', triggersRouter);
app.route('/api/executions', executionsRouter);
app.route('/api/events', eventsRouter);
app.route('/api/repos', reposRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/admin', adminRouter);
app.route('/api/admin/repos', orgReposAdminRouter);
app.route('/api/repos/org', orgReposReadRouter);
app.route('/api/personas', personasRouter);
app.route('/api/me', orchestratorRouter);
app.route('/api/invites', invitesApiRouter);

// Agent container proxy (protected)
app.use('/agent/*', authMiddleware);
app.route('/agent', agentRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
});

// Scheduled handler for cron triggers
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  console.log('Running scheduled sync check:', event.cron);

  // Query for integrations that need syncing
  const integrations = await env.DB.prepare(`
    SELECT id, user_id, service, config
    FROM integrations
    WHERE status = 'active'
      AND (
        (json_extract(config, '$.syncFrequency') = 'hourly')
        OR (json_extract(config, '$.syncFrequency') = 'daily' AND strftime('%H', 'now') = '00')
      )
      AND (last_synced_at IS NULL OR datetime(last_synced_at, '+1 hour') < datetime('now'))
  `).all();

  console.log(`Found ${integrations.results?.length || 0} integrations to sync`);

  // Trigger syncs by calling back into this worker's own fetch handler
  for (const integration of integrations.results || []) {
    ctx.waitUntil(
      Promise.resolve(
        app.fetch(
          new Request(`https://localhost/api/integrations/${integration.id}/sync`, {
            method: 'POST',
            headers: { 'X-Internal-Cron': 'true' },
          }),
          env
        )
      ).catch((err: unknown) => console.error(`Failed to trigger sync for ${integration.id}:`, err))
    );
  }

  try {
    await reconcileWorkflowExecutions(env);
  } catch (error) {
    console.error('Workflow execution reconcile error:', error);
  }

  try {
    await dispatchScheduledWorkflows(event, env);
  } catch (error) {
    console.error('Scheduled workflow dispatch error:', error);
  }
};

function hasPromptDispatch(runtimeStateRaw: string | null): boolean {
  if (!runtimeStateRaw) return false;
  try {
    const parsed = JSON.parse(runtimeStateRaw) as {
      executor?: { promptDispatchedAt?: string };
    };
    return !!parsed?.executor?.promptDispatchedAt;
  } catch {
    return false;
  }
}

interface WorkflowResultEnvelope {
  executionId?: string;
  status?: 'ok' | 'needs_approval' | 'cancelled' | 'failed';
  output?: Record<string, unknown>;
  steps?: Array<{
    stepId: string;
    status: string;
    attempt?: number;
    startedAt?: string;
    completedAt?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
  }>;
  requiresApproval?: {
    stepId?: string;
    prompt?: string;
    resumeToken?: string;
    items?: unknown[];
  } | null;
  error?: string | null;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    candidates.push(trimmed);
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = fenceRegex.exec(text);
  while (match) {
    const block = match[1]?.trim();
    if (block && block.startsWith('{') && block.endsWith('}')) {
      candidates.push(block);
    }
    match = fenceRegex.exec(text);
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const block = text.slice(firstBrace, lastBrace + 1).trim();
    if (block.startsWith('{') && block.endsWith('}')) {
      candidates.push(block);
    }
  }

  return candidates;
}

function parseWorkflowResultEnvelope(text: string, executionId: string): WorkflowResultEnvelope | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as WorkflowResultEnvelope;
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.executionId && parsed.executionId !== executionId) continue;
      if (!parsed.status) continue;
      if (!['ok', 'needs_approval', 'cancelled', 'failed'].includes(parsed.status)) continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchWorkflowResultEnvelope(
  env: Env,
  sessionId: string,
  executionId: string,
): Promise<WorkflowResultEnvelope | null> {
  try {
    const doId = env.SESSIONS.idFromName(sessionId);
    const sessionDO = env.SESSIONS.get(doId);
    const response = await sessionDO.fetch(new Request('http://do/messages?limit=200'));
    if (!response.ok) return null;

    const payload = await response.json<{
      messages?: Array<{ role?: string; content?: string }>;
    }>();

    const messages = payload.messages || [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const msg = messages[index];
      if (!msg?.content || (msg.role !== 'assistant' && msg.role !== 'system')) continue;
      const envelope = parseWorkflowResultEnvelope(msg.content, executionId);
      if (envelope) return envelope;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to fetch workflow result envelope for session ${sessionId}`, error);
    return null;
  }
}

async function persistStepTrace(
  env: Env,
  executionId: string,
  steps: NonNullable<WorkflowResultEnvelope['steps']>,
): Promise<void> {
  for (const step of steps) {
    const attempt = step.attempt && step.attempt > 0 ? step.attempt : 1;
    await env.DB.prepare(`
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
      executionId,
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

async function reconcileWorkflowExecutions(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    SELECT
      e.id,
      e.status,
      e.runtime_state,
      e.session_id,
      s.status AS session_status
    FROM workflow_executions e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.status IN ('pending', 'running', 'waiting_approval')
      AND COALESCE(s.purpose, 'interactive') = 'workflow'
      AND s.status IN ('terminated', 'error', 'hibernated')
  `).all<{
    id: string;
    status: string;
    runtime_state: string | null;
    session_id: string | null;
    session_status: string;
  }>();

  let completed = 0;
  let waitingApproval = 0;
  let cancelled = 0;
  let failed = 0;

  for (const row of result.results || []) {
    if (row.session_status === 'error') {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'failed',
            error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind('workflow_session_error', now, row.id).run();
      failed++;
      continue;
    }

    if (row.session_status === 'hibernated') {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'failed',
            error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind('workflow_session_hibernated', now, row.id).run();
      failed++;
      continue;
    }

    const promptDispatched = hasPromptDispatch(row.runtime_state);
    if (!promptDispatched) {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'failed',
            error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind('workflow_session_terminated_before_dispatch', now, row.id).run();
      failed++;
      continue;
    }

    const envelope = row.session_id
      ? await fetchWorkflowResultEnvelope(env, row.session_id, row.id)
      : null;

    if (!envelope) {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'completed',
            error = NULL,
            completed_at = ?
        WHERE id = ?
      `).bind(now, row.id).run();
      completed++;
      continue;
    }

    if (envelope.steps?.length) {
      await persistStepTrace(env, row.id, envelope.steps);
    }

    const outputsJson = envelope.output ? JSON.stringify(envelope.output) : null;
    const stepsJson = envelope.steps ? JSON.stringify(envelope.steps) : null;

    if (envelope.status === 'needs_approval') {
      const resumeToken = envelope.requiresApproval?.resumeToken;
      if (!resumeToken) {
        await env.DB.prepare(`
          UPDATE workflow_executions
          SET status = 'failed',
              outputs = ?,
              steps = ?,
              error = ?,
              completed_at = ?
          WHERE id = ?
        `).bind(outputsJson, stepsJson, 'approval_resume_token_missing', now, row.id).run();
        failed++;
        continue;
      }

      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'waiting_approval',
            outputs = ?,
            steps = ?,
            resume_token = ?,
            error = NULL,
            completed_at = NULL
        WHERE id = ?
      `).bind(outputsJson, stepsJson, resumeToken, row.id).run();
      waitingApproval++;
      continue;
    }

    if (envelope.status === 'cancelled') {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'cancelled',
            outputs = ?,
            steps = ?,
            error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind(outputsJson, stepsJson, envelope.error || 'workflow_cancelled', now, row.id).run();
      cancelled++;
      continue;
    }

    if (envelope.status === 'failed') {
      await env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'failed',
            outputs = ?,
            steps = ?,
            error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind(outputsJson, stepsJson, envelope.error || 'workflow_failed', now, row.id).run();
      failed++;
      continue;
    }

    await env.DB.prepare(`
      UPDATE workflow_executions
      SET status = 'completed',
          outputs = ?,
          steps = ?,
          error = NULL,
          completed_at = ?
      WHERE id = ?
    `).bind(outputsJson, stepsJson, now, row.id).run();
    completed++;
  }

  if (completed > 0 || waitingApproval > 0 || cancelled > 0 || failed > 0) {
    console.log(
      `Workflow reconcile finalized executions: completed=${completed} waiting_approval=${waitingApproval} cancelled=${cancelled} failed=${failed}`,
    );
  }
}

function matchesCronField(field: string, value: number, min: number, max: number, sundayAlias = false): boolean {
  const normalizedValue = sundayAlias && value === 0 ? 7 : value;
  const parts = field.split(',');

  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (!part) continue;

    if (part === '*') return true;

    if (part.startsWith('*/')) {
      const step = Number.parseInt(part.slice(2), 10);
      if (Number.isInteger(step) && step > 0 && value % step === 0) return true;
      continue;
    }

    const [base, stepPart] = part.split('/');
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) continue;

    if (base.includes('-')) {
      const [startRaw, endRaw] = base.split('-');
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      if (start < min || end > max || start > end) continue;
      const target = sundayAlias ? normalizedValue : value;
      if (target >= start && target <= end && (target - start) % step === 0) return true;
      continue;
    }

    const exact = Number.parseInt(base, 10);
    if (!Number.isInteger(exact)) continue;
    if (exact < min || exact > max) continue;
    const target = sundayAlias ? normalizedValue : value;
    if (target === exact) return true;
  }

  return false;
}

function getZonedDateParts(now: Date, timeZone: string): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  dayOfWeek: number;
} | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const valueFor = (type: string): string | null =>
      parts.find((part) => part.type === type)?.value ?? null;

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const minute = Number.parseInt(valueFor('minute') || '', 10);
    const hour = Number.parseInt(valueFor('hour') || '', 10);
    const day = Number.parseInt(valueFor('day') || '', 10);
    const month = Number.parseInt(valueFor('month') || '', 10);
    const dayOfWeek = weekdayMap[valueFor('weekday') || ''];

    if (!Number.isInteger(minute) || !Number.isInteger(hour) || !Number.isInteger(day) || !Number.isInteger(month) || dayOfWeek === undefined) {
      return null;
    }

    return { minute, hour, day, month, dayOfWeek };
  } catch {
    return null;
  }
}

function cronMatchesNow(cron: string, now: Date, timeZone: string = 'UTC'): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const zoned = getZonedDateParts(now, timeZone);
  if (!zoned) return false;

  return (
    matchesCronField(minute, zoned.minute, 0, 59) &&
    matchesCronField(hour, zoned.hour, 0, 23) &&
    matchesCronField(dayOfMonth, zoned.day, 1, 31) &&
    matchesCronField(month, zoned.month, 1, 12) &&
    (matchesCronField(dayOfWeek, zoned.dayOfWeek, 0, 7) || matchesCronField(dayOfWeek, zoned.dayOfWeek, 0, 7, true))
  );
}

async function dispatchScheduledWorkflows(event: ScheduledController, env: Env): Promise<void> {
  const now = new Date();
  const tickBucket = now.toISOString().slice(0, 16); // UTC minute precision

  const result = await env.DB.prepare(`
    SELECT
      t.id as trigger_id,
      t.user_id,
      t.workflow_id,
      t.config,
      w.name as workflow_name,
      w.version as workflow_version,
      w.data as workflow_data
    FROM triggers t
    JOIN workflows w ON t.workflow_id = w.id
    WHERE t.type = 'schedule'
      AND t.enabled = 1
      AND w.enabled = 1
  `).all<{
    trigger_id: string;
    user_id: string;
    workflow_id: string;
    config: string;
    workflow_name: string;
    workflow_version: string | null;
    workflow_data: string;
  }>();

  let dispatched = 0;

  for (const row of result.results || []) {
    let config: { cron?: string; timezone?: string };
    try {
      config = JSON.parse(row.config);
    } catch {
      continue;
    }

    const timezone = config.timezone || 'UTC';
    if (!config.cron || !cronMatchesNow(config.cron, now, timezone)) {
      continue;
    }

    const concurrency = await checkWorkflowConcurrency(env.DB, row.user_id);
    if (!concurrency.allowed) {
      console.warn(
        `Skipping scheduled workflow dispatch for trigger ${row.trigger_id}: ${concurrency.reason} (activeUser=${concurrency.activeUser}, activeGlobal=${concurrency.activeGlobal})`,
      );
      continue;
    }

    const tickInsert = await env.DB.prepare(`
      INSERT INTO workflow_schedule_ticks (id, trigger_id, tick_bucket)
      VALUES (?, ?, ?)
      ON CONFLICT(trigger_id, tick_bucket) DO NOTHING
    `).bind(crypto.randomUUID(), row.trigger_id, tickBucket).run();

    if ((tickInsert.meta.changes ?? 0) === 0) {
      continue;
    }

    const executionId = crypto.randomUUID();
    const workflowHash = await sha256Hex(String(row.workflow_data ?? '{}'));
    const sessionId = await createWorkflowSession(env.DB, {
      userId: row.user_id,
      workflowId: row.workflow_id,
      executionId,
    });

    const variables = {
      _trigger: {
        type: 'schedule',
        triggerId: row.trigger_id,
        cron: config.cron,
        timezone,
        eventCron: event.cron,
        tickBucket,
        timestamp: now.toISOString(),
      },
    };

    const idempotencyKey = `schedule:${row.trigger_id}:${tickBucket}`;
    await env.DB.prepare(`
      INSERT INTO workflow_executions
        (id, workflow_id, user_id, trigger_id, status, trigger_type, trigger_metadata, variables, started_at,
         workflow_version, workflow_hash, idempotency_key, session_id, initiator_type, initiator_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      executionId,
      row.workflow_id,
      row.user_id,
      row.trigger_id,
      'pending',
      'schedule',
      JSON.stringify({ cron: config.cron, timezone, tickBucket }),
      JSON.stringify(variables),
      now.toISOString(),
      row.workflow_version || null,
      workflowHash,
      idempotencyKey,
      sessionId,
      'schedule',
      row.user_id
    ).run();

    await env.DB.prepare(`
      UPDATE triggers SET last_run_at = ? WHERE id = ?
    `).bind(now.toISOString(), row.trigger_id).run();

    await enqueueWorkflowExecution(env, {
      executionId,
      workflowId: row.workflow_id,
      userId: row.user_id,
      sessionId,
      triggerType: 'schedule',
    });

    dispatched++;
  }

  console.log(`Scheduled workflow dispatch complete: ${dispatched} execution(s) enqueued`);
}

export default {
  fetch: app.fetch,
  scheduled,
};
