import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { integrationRegistry } from '../integrations/base.js';
import * as webhookService from '../services/webhooks.js';

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Catch-all webhook handler for workflow triggers
 * Matches /webhooks/:path where :path is configured in a trigger
 */
webhooksRouter.all('/*', async (c, next) => {
  const url = new URL(c.req.url);
  const workerOrigin = url.origin;
  const webhookPath = url.pathname.replace(/^\/webhooks\//, '');

  // Skip if it's one of the hardcoded integration webhooks
  const integrationPaths = ['github', 'notion', 'hubspot', 'discord', 'xero'];
  if (integrationPaths.includes(webhookPath.split('/')[0])) {
    return next();
  }

  const rawBody = c.req.method === 'GET' ? '' : await c.req.raw.clone().text().catch(() => '');

  // Collect relevant headers (lowercase keys)
  const headers: Record<string, string | undefined> = {
    'x-webhook-signature': c.req.header('X-Webhook-Signature'),
    'x-hub-signature-256': c.req.header('X-Hub-Signature-256'),
    'x-github-delivery': c.req.header('X-GitHub-Delivery'),
    'x-request-id': c.req.header('X-Request-Id'),
    'x-webhook-id': c.req.header('X-Webhook-Id'),
  };

  // Collect query params
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const result = await webhookService.handleGenericWebhook(
    c.env,
    webhookPath,
    c.req.method,
    rawBody,
    headers,
    query,
    workerOrigin,
  );

  if (!result) {
    return next();
  }

  return c.json(result.result, result.statusCode as any);
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

  if (event === 'pull_request') {
    try {
      await webhookService.handlePullRequestWebhook(c.env, payload);
    } catch (error) {
      console.error('PR webhook handler error:', error);
    }
  }

  if (event === 'push') {
    try {
      await webhookService.handlePushWebhook(c.env, payload);
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
 * POST /webhooks/notion
 */
webhooksRouter.post('/notion', async (c) => {
  const payload = await c.req.json();
  console.log('Notion webhook:', payload);
  return c.json({ received: true });
});

/**
 * POST /webhooks/hubspot
 */
webhooksRouter.post('/hubspot', async (c) => {
  const signature = c.req.header('X-HubSpot-Signature');
  const payload = await c.req.json();

  console.log('HubSpot webhook:', payload);

  if (Array.isArray(payload)) {
    for (const event of payload) {
      console.log(`HubSpot event: ${event.subscriptionType}`);
    }
  }

  return c.json({ received: true });
});

/**
 * POST /webhooks/discord
 */
webhooksRouter.post('/discord', async (c) => {
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const payload = await c.req.json();

  if (payload.type === 1) {
    return c.json({ type: 1 });
  }

  console.log('Discord webhook:', payload);
  return c.json({ received: true });
});

/**
 * POST /webhooks/xero
 */
webhooksRouter.post('/xero', async (c) => {
  const signature = c.req.header('x-xero-signature');
  const payload = await c.req.json();

  console.log('Xero webhook:', payload);

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
