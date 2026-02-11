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
import { tasksRouter } from './routes/tasks.js';
import { notificationQueueRouter } from './routes/mailbox.js';
import { channelsRouter } from './routes/channels.js';
import { telegramRouter, telegramApiRouter } from './routes/telegram.js';
import { decryptString } from './lib/crypto.js';
import {
  enqueueWorkflowApprovalNotificationIfMissing,
  getOAuthToken,
  markWorkflowApprovalNotificationsRead,
  updateSessionGitState,
} from './lib/db.js';
import {
  checkWorkflowConcurrency,
  createWorkflowSession,
  dispatchOrchestratorPrompt,
  enqueueWorkflowExecution,
  sha256Hex,
} from './lib/workflow-runtime.js';

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

// Telegram webhook (unauthenticated — Telegram sends updates here)
app.route('/telegram', telegramRouter);

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
app.route('/api/sessions', tasksRouter);
app.route('/api', notificationQueueRouter);
app.route('/api', channelsRouter);
app.route('/api/me/telegram', telegramApiRouter);
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

  try {
    await reconcileGitHubResources(env);
  } catch (error) {
    console.error('GitHub reconciliation error:', error);
  }

  // Nightly: archive terminated sessions older than 7 days
  if (event.cron === '0 3 * * *') {
    try {
      await archiveTerminatedSessions(env);
    } catch (error) {
      console.error('Session archive error:', error);
    }
  }
};

const MAX_GITHUB_RESOURCES_PER_RUN = 100;
const LIVE_NOTIFY_SESSION_STATUSES = new Set(['initializing', 'running', 'idle', 'restoring', 'hibernating']);

interface TrackedGitHubResourceRow {
  session_id: string;
  user_id: string;
  session_status: string;
  source_repo_full_name: string | null;
  source_repo_url: string | null;
  tracked_pr_number: number | string;
  pr_state: string | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_merged_at: string | null;
}

interface TrackedGitHubResource {
  owner: string;
  repo: string;
  prNumber: number;
  links: Array<{
    sessionId: string;
    userId: string;
    sessionStatus: string;
    prState: string | null;
    prTitle: string | null;
    prUrl: string | null;
    prMergedAt: string | null;
  }>;
}

function extractOwnerRepoFromGitState(sourceRepoFullName: string | null, sourceRepoUrl: string | null): {
  owner: string;
  repo: string;
} | null {
  if (sourceRepoFullName) {
    const [owner, repo] = sourceRepoFullName.split('/');
    if (owner && repo) return { owner, repo };
  }
  if (sourceRepoUrl) {
    const match = sourceRepoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

function mapGitHubPullRequestState(
  state: string | undefined,
  draft: boolean,
  mergedAt: string | null | undefined,
): 'draft' | 'open' | 'closed' | 'merged' | null {
  if (mergedAt) return 'merged';
  if (state === 'open') return draft ? 'draft' : 'open';
  if (state === 'closed') return 'closed';
  return null;
}

async function reconcileGitHubResources(env: Env): Promise<void> {
  const rowsRes = await env.DB.prepare(
    `SELECT
       g.session_id,
       s.user_id,
       s.status as session_status,
       g.source_repo_full_name,
       g.source_repo_url,
       COALESCE(g.pr_number, g.source_pr_number) as tracked_pr_number,
       g.pr_state,
       g.pr_title,
       g.pr_url,
       g.pr_merged_at
     FROM session_git_state g
     JOIN sessions s ON s.id = g.session_id
     WHERE s.status != 'archived'
       AND COALESCE(g.pr_number, g.source_pr_number) IS NOT NULL
       AND (g.pr_state IS NULL OR g.pr_state IN ('open', 'draft'))
     ORDER BY g.updated_at DESC`
  ).all<TrackedGitHubResourceRow>();

  const rows = rowsRes.results || [];
  if (rows.length === 0) return;

  const resourceMap = new Map<string, TrackedGitHubResource>();
  for (const row of rows) {
    const ownerRepo = extractOwnerRepoFromGitState(row.source_repo_full_name, row.source_repo_url);
    if (!ownerRepo) continue;

    const prNumber = typeof row.tracked_pr_number === 'number'
      ? row.tracked_pr_number
      : Number.parseInt(String(row.tracked_pr_number), 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) continue;

    const key = `${ownerRepo.owner}/${ownerRepo.repo}#${prNumber}`;
    const existing = resourceMap.get(key);
    const link = {
      sessionId: row.session_id,
      userId: row.user_id,
      sessionStatus: row.session_status,
      prState: row.pr_state,
      prTitle: row.pr_title,
      prUrl: row.pr_url,
      prMergedAt: row.pr_merged_at,
    };

    if (existing) {
      existing.links.push(link);
    } else {
      resourceMap.set(key, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        prNumber,
        links: [link],
      });
    }
  }

  const resources = Array.from(resourceMap.values()).slice(0, MAX_GITHUB_RESOURCES_PER_RUN);
  if (resources.length === 0) return;

  const tokenCache = new Map<string, string | null>();
  const getTokenForUser = async (userId: string): Promise<string | null> => {
    if (tokenCache.has(userId)) return tokenCache.get(userId) ?? null;
    try {
      const tokenRow = await getOAuthToken(env.DB, userId, 'github');
      if (!tokenRow) {
        tokenCache.set(userId, null);
        return null;
      }
      const token = await decryptString(tokenRow.encryptedAccessToken, env.ENCRYPTION_KEY);
      tokenCache.set(userId, token);
      return token;
    } catch (error) {
      console.warn(`GitHub reconcile: failed to decrypt token for user ${userId}`, error);
      tokenCache.set(userId, null);
      return null;
    }
  };

  let checked = 0;
  let updated = 0;
  let notified = 0;
  let skippedNoToken = 0;
  let rateLimited = false;

  for (const resource of resources) {
    if (rateLimited) break;
    checked++;

    const url = `https://api.github.com/repos/${encodeURIComponent(resource.owner)}/${encodeURIComponent(resource.repo)}/pulls/${resource.prNumber}`;
    const candidateUserIds = Array.from(new Set(resource.links.map((link) => link.userId)));

    let prPayload: {
      state?: string;
      draft?: boolean;
      merged_at?: string | null;
      title?: string;
      html_url?: string;
    } | null = null;

    let hadTokenCandidate = false;
    for (const userId of candidateUserIds) {
      const token = await getTokenForUser(userId);
      if (!token) continue;
      hadTokenCandidate = true;

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Agent-Ops-Reconciler',
          },
        });
      } catch (error) {
        console.warn(`GitHub reconcile: request failed for ${resource.owner}/${resource.repo}#${resource.prNumber}`, error);
        continue;
      }

      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        rateLimited = true;
        const resetAt = response.headers.get('x-ratelimit-reset');
        console.warn(
          `GitHub reconcile: rate limit reached while checking ${resource.owner}/${resource.repo}#${resource.prNumber}`
          + (resetAt ? ` (reset at ${resetAt})` : ''),
        );
        break;
      }

      if (!response.ok) {
        // Permission errors are token-specific; try another linked user's token.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          continue;
        }
        const body = await response.text();
        console.warn(
          `GitHub reconcile: unexpected ${response.status} for ${resource.owner}/${resource.repo}#${resource.prNumber}: ${body.slice(0, 200)}`,
        );
        continue;
      }

      prPayload = await response.json() as {
        state?: string;
        draft?: boolean;
        merged_at?: string | null;
        title?: string;
        html_url?: string;
      };
      break;
    }

    if (!prPayload) {
      if (!hadTokenCandidate) skippedNoToken++;
      continue;
    }

    const nextState = mapGitHubPullRequestState(prPayload.state, Boolean(prPayload.draft), prPayload.merged_at ?? null);
    if (!nextState || typeof prPayload.title !== 'string' || typeof prPayload.html_url !== 'string') {
      continue;
    }

    const nextMergedAt = prPayload.merged_at ?? null;
    for (const link of resource.links) {
      const changed =
        link.prState !== nextState
        || link.prTitle !== prPayload.title
        || link.prUrl !== prPayload.html_url
        || link.prMergedAt !== nextMergedAt;

      if (!changed) continue;

      try {
        await updateSessionGitState(env.DB, link.sessionId, {
          prState: nextState as any,
          prTitle: prPayload.title,
          prUrl: prPayload.html_url,
          prMergedAt: nextMergedAt as any,
        });
        updated++;
      } catch (error) {
        console.error(`GitHub reconcile: failed to update git state for session ${link.sessionId}`, error);
        continue;
      }

      if (!LIVE_NOTIFY_SESSION_STATUSES.has(link.sessionStatus)) {
        continue;
      }

      try {
        const doId = env.SESSIONS.idFromName(link.sessionId);
        const stub = env.SESSIONS.get(doId);
        await stub.fetch(new Request('http://do/webhook-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'git-state-update',
            prState: nextState,
            prTitle: prPayload.title,
            prUrl: prPayload.html_url,
            prMergedAt: nextMergedAt,
          }),
        }));
        notified++;
      } catch (error) {
        console.warn(`GitHub reconcile: failed to notify session DO ${link.sessionId}`, error);
      }
    }
  }

  if (resourceMap.size > MAX_GITHUB_RESOURCES_PER_RUN) {
    console.log(
      `GitHub reconcile processed ${MAX_GITHUB_RESOURCES_PER_RUN}/${resourceMap.size} tracked resources (truncated this run)`,
    );
  }

  console.log(
    `GitHub reconcile summary: checked=${checked}, updated=${updated}, notified=${notified}, missingTokenResources=${skippedNoToken}, rateLimited=${rateLimited}`,
  );
}

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

async function expireWaitingApprovalExecutions(env: Env): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
  const nowIso = now.toISOString();

  const result = await env.DB.prepare(`
    SELECT id, user_id
    FROM workflow_executions
    WHERE status = 'waiting_approval'
      AND started_at <= ?
  `).bind(cutoff).all<{ id: string; user_id: string }>();

  let expired = 0;
  for (const row of result.results || []) {
    await env.DB.prepare(`
      UPDATE workflow_executions
      SET status = 'cancelled',
          error = 'approval_timeout',
          resume_token = NULL,
          completed_at = ?
      WHERE id = ?
    `).bind(nowIso, row.id).run();
    await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
    expired++;
  }

  return expired;
}

async function reconcileWorkflowExecutions(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const approvalsExpired = await expireWaitingApprovalExecutions(env);
  const result = await env.DB.prepare(`
    SELECT
      e.id,
      e.user_id,
      e.status,
      e.runtime_state,
      e.session_id,
      e.workflow_id,
      w.name AS workflow_name,
      s.status AS session_status
    FROM workflow_executions e
    LEFT JOIN workflows w ON w.id = e.workflow_id
    JOIN sessions s ON s.id = e.session_id
    WHERE e.status IN ('pending', 'running', 'waiting_approval')
      AND COALESCE(s.purpose, 'interactive') = 'workflow'
      AND s.status IN ('terminated', 'error', 'hibernated')
  `).all<{
    id: string;
    user_id: string;
    status: string;
    runtime_state: string | null;
    session_id: string | null;
    workflow_id: string | null;
    workflow_name: string | null;
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
        await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
      await enqueueWorkflowApprovalNotificationIfMissing(env.DB, {
        toUserId: row.user_id,
        executionId: row.id,
        fromSessionId: row.session_id || undefined,
        contextSessionId: row.session_id || undefined,
        workflowName: row.workflow_name,
        approvalPrompt: envelope.requiresApproval?.prompt,
      });
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
      await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
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
    await markWorkflowApprovalNotificationsRead(env.DB, row.user_id, row.id);
    completed++;
  }

  if (completed > 0 || waitingApproval > 0 || cancelled > 0 || failed > 0) {
    console.log(
      `Workflow reconcile finalized executions: completed=${completed} waiting_approval=${waitingApproval} cancelled=${cancelled} failed=${failed}`,
    );
  }
  if (approvalsExpired > 0) {
    console.log(`Workflow approval timeout sweep cancelled ${approvalsExpired} execution(s)`);
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
      w.enabled as workflow_enabled,
      w.name as workflow_name,
      w.version as workflow_version,
      w.data as workflow_data
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.type = 'schedule'
      AND t.enabled = 1
  `).all<{
    trigger_id: string;
    user_id: string;
    workflow_id: string | null;
    config: string;
    workflow_enabled: number | null;
    workflow_name: string | null;
    workflow_version: string | null;
    workflow_data: string | null;
  }>();

  let dispatched = 0;

  for (const row of result.results || []) {
    let config: {
      cron?: string;
      timezone?: string;
      target?: 'workflow' | 'orchestrator';
      prompt?: string;
    };
    try {
      config = JSON.parse(row.config);
    } catch {
      continue;
    }

    const timezone = config.timezone || 'UTC';
    if (!config.cron || !cronMatchesNow(config.cron, now, timezone)) {
      continue;
    }

    const target = config.target === 'orchestrator' ? 'orchestrator' : 'workflow';

    if (target === 'workflow') {
      if (!row.workflow_id || !row.workflow_data || !row.workflow_enabled) {
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
           workflow_version, workflow_hash, workflow_snapshot, idempotency_key, session_id, initiator_type, initiator_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        row.workflow_data,
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
      continue;
    }

    const prompt = config.prompt?.trim();
    if (!prompt) {
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

    const dispatch = await dispatchOrchestratorPrompt(env, {
      userId: row.user_id,
      content: prompt,
      authorName: 'Scheduled Task',
      authorEmail: 'scheduled-task@agent-ops.local',
    });

    if (!dispatch.dispatched) {
      console.warn(
        `Skipping scheduled orchestrator prompt for trigger ${row.trigger_id}: ${dispatch.reason || 'unknown_reason'}`,
      );
      continue;
    }

    await env.DB.prepare(`
      UPDATE triggers SET last_run_at = ? WHERE id = ?
    `).bind(now.toISOString(), row.trigger_id).run();
    dispatched++;
  }

  console.log(`Scheduled dispatch complete: ${dispatched} trigger(s) processed`);
}

/**
 * Archive terminated sessions older than 7 days.
 * GCs the Durable Object storage, deletes the persisted workspace volume,
 * then marks the session as 'archived' in D1.
 */
async function archiveTerminatedSessions(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const rows = await env.DB.prepare(
    `SELECT id FROM sessions
     WHERE status IN ('terminated', 'error')
       AND last_active_at < ?
     LIMIT 50`
  )
    .bind(cutoff)
    .all<{ id: string }>();

  const sessionIds = rows.results?.map((r) => r.id) ?? [];
  if (sessionIds.length === 0) return;

  console.log(`Archiving ${sessionIds.length} terminated sessions older than 7 days`);

  // Fan-out: GC each SessionAgent DO's storage
  const gcResults = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      const doId = env.SESSIONS.idFromName(sessionId);
      const sessionDO = env.SESSIONS.get(doId);
      await sessionDO.fetch(new Request('http://do/gc', { method: 'POST' }));
      return sessionId;
    })
  );

  // Collect IDs where DO GC succeeded
  const gcSucceededIds: string[] = [];
  for (const result of gcResults) {
    if (result.status === 'fulfilled') {
      gcSucceededIds.push(result.value);
    } else {
      console.error('Failed to GC session DO:', result.reason);
    }
  }

  if (gcSucceededIds.length === 0) return;

  // Fan-out: delete each session's persisted workspace volume
  const deleteWorkspaceUrl = env.MODAL_BACKEND_URL.replace('{label}', 'delete-workspace');
  const workspaceDeleteResults = await Promise.allSettled(
    gcSucceededIds.map(async (sessionId) => {
      const response = await fetch(deleteWorkspaceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const payload = await response.json() as { success?: boolean; deleted?: boolean };
      if (!payload.success) {
        throw new Error('Modal backend returned success=false');
      }

      return { sessionId, deleted: payload.deleted === true };
    })
  );

  const archivedIds: string[] = [];
  let deletedCount = 0;
  for (const result of workspaceDeleteResults) {
    if (result.status === 'fulfilled') {
      archivedIds.push(result.value.sessionId);
      if (result.value.deleted) deletedCount += 1;
    } else {
      console.error('Failed to delete workspace volume during archive:', result.reason);
    }
  }

  if (archivedIds.length === 0) return;

  // Batch-update status to 'archived' (re-check status to avoid race conditions)
  const placeholders = archivedIds.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE sessions SET status = 'archived' WHERE id IN (${placeholders}) AND status IN ('terminated', 'error')`
  )
    .bind(...archivedIds)
    .run();

  console.log(`Archived ${archivedIds.length} sessions (workspace volumes deleted: ${deletedCount})`);
}

export default {
  fetch: app.fetch,
  scheduled,
};
