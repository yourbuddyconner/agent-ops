import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { integrationRegistry } from '../integrations/base.js';
import * as db from '../lib/db.js';

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Catch-all webhook handler for workflow triggers
 * Matches /webhooks/:path where :path is configured in a trigger
 */
webhooksRouter.all('/*', async (c, next) => {
  // Extract the path after /webhooks/
  const url = new URL(c.req.url);
  const webhookPath = url.pathname.replace(/^\/webhooks\//, '');

  // Skip if it's one of the hardcoded integration webhooks
  const integrationPaths = ['github', 'notion', 'hubspot', 'discord', 'xero'];
  if (integrationPaths.includes(webhookPath.split('/')[0])) {
    return next();
  }

  // Look up trigger by webhook path
  const trigger = await c.env.DB.prepare(`
    SELECT t.*, w.id as workflow_id, w.name as workflow_name, w.user_id
    FROM triggers t
    JOIN workflows w ON t.workflow_id = w.id
    WHERE t.type = 'webhook'
      AND t.enabled = 1
      AND json_extract(t.config, '$.path') = ?
  `).bind(webhookPath).first();

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

  // Parse request body
  let payload: Record<string, unknown> = {};
  try {
    if (c.req.method !== 'GET') {
      payload = await c.req.json();
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

  const executionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Create execution record
  await c.env.DB.prepare(`
    INSERT INTO workflow_executions
      (id, workflow_id, user_id, trigger_id, status, trigger_type, trigger_metadata, variables, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    executionId,
    trigger.workflow_id,
    trigger.user_id,
    trigger.id,
    'pending',
    'webhook',
    JSON.stringify({ path: webhookPath, method: c.req.method }),
    JSON.stringify(variables),
    now
  ).run();

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
    message: 'Webhook received. Workflow execution queued.',
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

  // In production, verify the webhook signature
  // const isValid = await verifyGitHubSignature(signature, payload, secret);

  console.log(`GitHub webhook: ${event} (${deliveryId})`);

  // Find integrations that should receive this webhook
  // For now, log and acknowledge
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
