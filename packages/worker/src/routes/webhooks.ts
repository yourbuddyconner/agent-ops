import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { integrationRegistry } from '../integrations/base.js';
import * as db from '../lib/db.js';

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

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
