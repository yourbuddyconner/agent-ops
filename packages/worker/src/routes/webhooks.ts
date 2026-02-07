import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { integrationRegistry } from '../integrations/base.js';
import * as db from '../lib/db.js';
import { checkWorkflowConcurrency, createWorkflowSession, enqueueWorkflowExecution, sha256Hex } from '../lib/workflow-runtime.js';

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Catch-all webhook handler for workflow triggers
 * Matches /webhooks/:path where :path is configured in a trigger
 */
webhooksRouter.all('/*', async (c, next) => {
  // Extract the path after /webhooks/
  const url = new URL(c.req.url);
  const workerOrigin = url.origin;
  const webhookPath = url.pathname.replace(/^\/webhooks\//, '');

  // Skip if it's one of the hardcoded integration webhooks
  const integrationPaths = ['github', 'notion', 'hubspot', 'discord', 'xero'];
  if (integrationPaths.includes(webhookPath.split('/')[0])) {
    return next();
  }

  // Look up trigger by webhook path
  const trigger = await c.env.DB.prepare(`
    SELECT t.*, w.id as workflow_id, w.name as workflow_name, w.user_id, w.version, w.data
    FROM triggers t
    JOIN workflows w ON t.workflow_id = w.id
    WHERE t.type = 'webhook'
      AND t.enabled = 1
      AND json_extract(t.config, '$.path') = ?
  `).bind(webhookPath).first<{
    id: string;
    workflow_id: string;
    workflow_name: string;
    user_id: string;
    version: string | null;
    data: string;
    config: string;
    variable_mapping: string | null;
  }>();

  if (!trigger) {
    return c.json({ error: 'Webhook not found', path: webhookPath }, 404);
  }

  const config = JSON.parse(trigger.config as string);

  // Verify HTTP method if specified
  if (config.method && config.method !== c.req.method) {
    return c.json({ error: `Method ${c.req.method} not allowed`, allowed: config.method }, 405);
  }

  // Verify secret/signature if configured
  if (config.secret) {
    const signature = c.req.header('X-Webhook-Signature') || c.req.header('X-Hub-Signature-256');
    if (!signature) {
      return c.json({ error: 'Missing webhook signature' }, 401);
    }
    // In production, verify HMAC signature
    // const isValid = await verifyWebhookSignature(signature, body, config.secret);
  }

  const rawBody = c.req.method === 'GET' ? '' : await c.req.raw.clone().text().catch(() => '');

  // Parse request body
  let payload: Record<string, unknown> = {};
  try {
    if (rawBody) {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    }
  } catch {
    // Body might be empty or not JSON
  }

  // Add query params to payload
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  if (Object.keys(query).length > 0) {
    payload.query = query;
  }

  // Extract variables using the trigger's variable mapping
  const variableMapping = trigger.variable_mapping
    ? JSON.parse(trigger.variable_mapping as string)
    : {};

  const extractedVariables: Record<string, unknown> = {};
  for (const [varName, pathExpr] of Object.entries(variableMapping)) {
    const pathStr = pathExpr as string;
    // Simple JSONPath-like extraction ($.body.field)
    if (pathStr.startsWith('$.')) {
      const parts = pathStr.slice(2).split('.');
      let value: unknown = payload;
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          value = undefined;
          break;
        }
      }
      if (value !== undefined) {
        extractedVariables[varName] = value;
      }
    }
  }

  // Build variables for workflow execution
  const variables = {
    ...extractedVariables,
    _trigger: {
      type: 'webhook',
      triggerId: trigger.id,
      path: webhookPath,
      method: c.req.method,
      timestamp: new Date().toISOString(),
    },
    _payload: payload,
  };

  const deliveryId = c.req.header('X-GitHub-Delivery')
    || c.req.header('X-Request-Id')
    || c.req.header('X-Webhook-Id')
    || null;
  const signature = c.req.header('X-Webhook-Signature')
    || c.req.header('X-Hub-Signature-256')
    || '';
  const fallbackBodyHash = await sha256Hex(`${signature}:${rawBody}`);
  const idempotencyKey = `webhook:${trigger.id}:${deliveryId || fallbackBodyHash}`;

  const existing = await c.env.DB.prepare(`
    SELECT id, status, session_id
    FROM workflow_executions
    WHERE workflow_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(trigger.workflow_id, idempotencyKey).first();

  if (existing) {
    return c.json({
      received: true,
      deduplicated: true,
      executionId: existing.id,
      workflowId: trigger.workflow_id,
      workflowName: trigger.workflow_name,
      status: existing.status,
      sessionId: existing.session_id,
      message: 'Webhook received. Existing workflow execution reused.',
    }, 200);
  }

  const concurrency = await checkWorkflowConcurrency(c.env.DB, trigger.user_id);
  if (!concurrency.allowed) {
    return c.json({
      received: true,
      queued: false,
      error: 'Too many concurrent workflow executions',
      reason: concurrency.reason,
      activeUser: concurrency.activeUser,
      activeGlobal: concurrency.activeGlobal,
    }, 429);
  }

  const executionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const workflowHash = await sha256Hex(String(trigger.data ?? '{}'));
  const sessionId = await createWorkflowSession(c.env.DB, {
    userId: trigger.user_id,
    workflowId: trigger.workflow_id,
    executionId,
  });

  // Create execution record
  await c.env.DB.prepare(`
    INSERT INTO workflow_executions
      (id, workflow_id, user_id, trigger_id, status, trigger_type, trigger_metadata, variables, started_at,
       workflow_version, workflow_hash, idempotency_key, session_id, initiator_type, initiator_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    executionId,
    trigger.workflow_id,
    trigger.user_id,
    trigger.id,
    'pending',
    'webhook',
    JSON.stringify({ path: webhookPath, method: c.req.method }),
    JSON.stringify(variables),
    now,
    trigger.version || null,
    workflowHash,
    idempotencyKey,
    sessionId,
    'webhook',
    trigger.user_id
  ).run();

  const dispatched = await enqueueWorkflowExecution(c.env, {
    executionId,
    workflowId: trigger.workflow_id,
    userId: trigger.user_id,
    sessionId,
    triggerType: 'webhook',
    workerOrigin,
  });

  // Update trigger last run time
  await c.env.DB.prepare(`
    UPDATE triggers SET last_run_at = ? WHERE id = ?
  `).bind(now, trigger.id).run();

  // Return immediately - workflow execution would happen asynchronously via OpenCode
  return c.json({
    received: true,
    executionId,
    workflowId: trigger.workflow_id,
    workflowName: trigger.workflow_name,
    status: 'pending',
    sessionId,
    dispatched,
    message: dispatched
      ? 'Webhook received. Workflow execution queued and dispatched.'
      : 'Webhook received. Workflow execution queued but dispatch failed.',
  }, 202);
});

/**
 * POST /webhooks/github
 * Handle GitHub webhook events
 */
webhooksRouter.post('/github', async (c) => {
  const signature = c.req.header('X-Hub-Signature-256');
  const event = c.req.header('X-GitHub-Event');
  const deliveryId = c.req.header('X-GitHub-Delivery');

  if (!event) {
    return c.json({ error: 'Missing event header' }, 400);
  }

  const payload = await c.req.json();

  // Verify webhook signature if secret is configured
  const webhookSecret = c.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret) {
    const isValid = await verifyGitHubSignature(signature, payload, webhookSecret);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  console.log(`GitHub webhook: ${event} (${deliveryId})`);

  // Process PR lifecycle events for session git state tracking
  if (event === 'pull_request') {
    try {
      await handlePullRequestWebhook(c.env, payload);
    } catch (error) {
      console.error('PR webhook handler error:', error);
    }
  }

  // Process push events for commit tracking
  if (event === 'push') {
    try {
      await handlePushWebhook(c.env, payload);
    } catch (error) {
      console.error('Push webhook handler error:', error);
    }
  }

  // Forward to integration handler for general sync
  const handler = integrationRegistry.get('github');
  if (handler) {
    try {
      await handler.handleWebhook(event, payload);
    } catch (error) {
      console.error('Webhook handler error:', error);
    }
  }

  return c.json({ received: true, event, deliveryId });
});

/**
 * Handle pull_request webhook events — updates session_git_state and notifies DOs.
 */
async function handlePullRequestWebhook(env: Env, payload: any): Promise<void> {
  const action = payload.action; // opened, closed, merged, reopened, edited, synchronize
  const pr = payload.pull_request;
  if (!pr) return;

  const repoFullName = payload.repository?.full_name;
  const prNumber = pr.number;

  if (!repoFullName || !prNumber) return;

  // Find sessions linked to this PR (by source_repo_full_name + pr_number)
  const rows = await env.DB.prepare(
    `SELECT session_id FROM session_git_state
     WHERE source_repo_full_name = ? AND pr_number = ?`
  ).bind(repoFullName, prNumber).all<{ session_id: string }>();

  if (!rows.results || rows.results.length === 0) return;

  // Determine the new PR state
  let prState: string;
  if (pr.merged_at || action === 'closed' && pr.merged) {
    prState = 'merged';
  } else if (action === 'closed') {
    prState = 'closed';
  } else if (action === 'reopened' || action === 'opened') {
    prState = pr.draft ? 'draft' : 'open';
  } else {
    prState = pr.draft ? 'draft' : (pr.state === 'open' ? 'open' : pr.state);
  }

  // Update all matching sessions
  for (const row of rows.results) {
    const sessionId = row.session_id;

    await db.updateSessionGitState(env.DB, sessionId, {
      prState: prState as any,
      prTitle: pr.title,
      prMergedAt: pr.merged_at || undefined,
    });

    // Notify the SessionAgent DO so it can broadcast to connected clients
    try {
      const doId = env.SESSIONS.idFromName(sessionId);
      const stub = env.SESSIONS.get(doId);
      await stub.fetch(new Request('https://session/webhook-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'git-state-update',
          prState,
          prTitle: pr.title,
          prMergedAt: pr.merged_at || null,
        }),
      }));
    } catch (err) {
      console.error(`Failed to notify DO for session ${sessionId}:`, err);
    }
  }
}

/**
 * Handle push webhook events — updates commit count for matching sessions.
 */
async function handlePushWebhook(env: Env, payload: any): Promise<void> {
  const ref = payload.ref; // e.g., "refs/heads/feature/my-branch"
  const repoFullName = payload.repository?.full_name;
  const commitCount = payload.commits?.length ?? 0;

  if (!ref || !repoFullName || commitCount === 0) return;

  // Extract branch name from ref
  const branch = ref.replace('refs/heads/', '');

  // Find sessions matching this repo + branch
  const rows = await env.DB.prepare(
    `SELECT session_id, commit_count FROM session_git_state
     WHERE source_repo_full_name = ? AND branch = ?`
  ).bind(repoFullName, branch).all<{ session_id: string; commit_count: number }>();

  if (!rows.results || rows.results.length === 0) return;

  for (const row of rows.results) {
    await db.updateSessionGitState(env.DB, row.session_id, {
      commitCount: row.commit_count + commitCount,
    });

    // Notify the DO
    try {
      const doId = env.SESSIONS.idFromName(row.session_id);
      const stub = env.SESSIONS.get(doId);
      await stub.fetch(new Request('https://session/webhook-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'git-state-update',
          commitCount: row.commit_count + commitCount,
          branch,
        }),
      }));
    } catch (err) {
      console.error(`Failed to notify DO for session ${row.session_id}:`, err);
    }
  }
}

/**
 * POST /webhooks/notion
 * Handle Notion webhook events (if available)
 */
webhooksRouter.post('/notion', async (c) => {
  const payload = await c.req.json();
  console.log('Notion webhook:', payload);
  return c.json({ received: true });
});

/**
 * POST /webhooks/hubspot
 * Handle HubSpot webhook events
 */
webhooksRouter.post('/hubspot', async (c) => {
  const signature = c.req.header('X-HubSpot-Signature');
  const payload = await c.req.json();

  console.log('HubSpot webhook:', payload);

  // Process HubSpot events
  if (Array.isArray(payload)) {
    for (const event of payload) {
      console.log(`HubSpot event: ${event.subscriptionType}`);
    }
  }

  return c.json({ received: true });
});

/**
 * POST /webhooks/discord
 * Handle Discord webhook/interaction events
 */
webhooksRouter.post('/discord', async (c) => {
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const payload = await c.req.json();

  // Discord requires immediate response for verification
  if (payload.type === 1) {
    // PING
    return c.json({ type: 1 }); // PONG
  }

  console.log('Discord webhook:', payload);
  return c.json({ received: true });
});

/**
 * POST /webhooks/xero
 * Handle Xero webhook events
 */
webhooksRouter.post('/xero', async (c) => {
  const signature = c.req.header('x-xero-signature');
  const payload = await c.req.json();

  console.log('Xero webhook:', payload);

  // Xero webhooks send an array of events
  if (payload.events && Array.isArray(payload.events)) {
    for (const event of payload.events) {
      console.log(`Xero event: ${event.eventType} for ${event.resourceId}`);
    }
  }

  return c.json({ received: true });
});

/**
 * Webhook signature verification helpers
 */
async function verifyGitHubSignature(
  signature: string | undefined,
  payload: unknown,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload)));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return signature === expected;
}

async function verifyDiscordSignature(
  signature: string | undefined,
  timestamp: string | undefined,
  body: string,
  publicKey: string
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );

    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );

    return isValid;
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
