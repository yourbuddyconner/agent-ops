import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { channelScopeKey } from '@agent-ops/shared';
import type { ChannelTarget, ChannelContext } from '@agent-ops/sdk';
import { verifySlackSignature } from '@agent-ops/channel-slack';
import { channelRegistry } from '../channels/registry.js';
import * as db from '../lib/db.js';
import { decryptString } from '../lib/crypto.js';
import { dispatchOrchestratorPrompt } from '../lib/workflow-runtime.js';
import { handleChannelCommand } from './channel-webhooks.js';

export const slackEventsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /channels/slack/events — Slack Events API handler
 *
 * Org-level flow:
 * 1. Parse JSON → handle url_verification
 * 2. Verify signature (SLACK_SIGNING_SECRET)
 * 3. team_id → getOrgSlackInstall(teamId) → { encryptedBotToken, botUserId }
 * 4. decryptString(encryptedBotToken) → botToken
 * 5. event.user → resolveUserByExternalId('slack', slackUserId) → userId
 * 6. If no user found → 200 OK (ignore gracefully)
 * 7. transport.parseInbound() → InboundMessage
 * 8. scopeKey → channel binding lookup → route to session or orchestrator
 */
slackEventsRouter.post('/slack/events', async (c) => {
  const rawBody = await c.req.text();

  // Parse JSON body (needed for url_verification before signature check)
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Handle Slack URL verification challenge (no signature check needed)
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  // Extract team_id from payload
  const teamId = payload.team_id as string | undefined;
  if (!teamId) {
    return c.json({ error: 'Missing team_id' }, 400);
  }

  // Look up org-level Slack install (needed for signing secret + bot token)
  const install = await db.getOrgSlackInstall(c.get('db'), teamId);
  if (!install) {
    console.log(`[Slack] No org install found for team_id=${teamId}`);
    return c.json({ ok: true });
  }

  // Verify signature using signing secret from DB (fall back to env var)
  const rawHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    rawHeaders[key] = value;
  });

  const signingSecret = install.encryptedSigningSecret
    ? await decryptString(install.encryptedSigningSecret, c.env.ENCRYPTION_KEY)
    : c.env.SLACK_SIGNING_SECRET;

  if (signingSecret) {
    const valid = await verifySlackSignature(rawHeaders, rawBody, signingSecret);
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  // Decrypt bot token
  const botToken = await decryptString(install.encryptedBotToken, c.env.ENCRYPTION_KEY);

  // Resolve Agent-Ops user from Slack user ID via identity links
  const event = payload.event as Record<string, unknown> | undefined;
  const slackUserId = (event?.user as string) || null;

  if (!slackUserId) {
    console.log(`[Slack] No user in event for team_id=${teamId}`);
    return c.json({ ok: true });
  }

  const userId = await db.resolveUserByExternalId(c.get('db'), 'slack', slackUserId);
  if (!userId) {
    console.log(`[Slack] No identity link for slack user=${slackUserId}`);
    return c.json({ ok: true });
  }

  // Get transport and parse inbound
  const transport = channelRegistry.getTransport('slack');
  if (!transport) {
    return c.json({ error: 'Slack transport not registered' }, 500);
  }

  const message = await transport.parseInbound(rawHeaders, rawBody, {
    userId,
    botToken,
  });

  if (!message) {
    return c.json({ ok: true });
  }

  // Handle slash commands
  if (message.command) {
    const ctx: ChannelContext = { token: botToken, userId };
    const target: ChannelTarget = {
      channelType: 'slack',
      channelId: message.channelId,
      threadId: (message.metadata?.threadTs as string) || undefined,
    };
    await handleChannelCommand(c.env, transport, target, ctx, message, userId);
    return c.json({ ok: true });
  }

  // Build scope key and look up channel binding
  const parts = transport.scopeKeyParts(message, userId);
  const scopeKey = channelScopeKey(userId, parts.channelType, parts.channelId);
  const binding = await db.getChannelBindingByScopeKey(c.get('db'), scopeKey);

  if (binding) {
    console.log(`[Slack] Bound session dispatch: session=${binding.sessionId} channelId=${message.channelId}`);
    const doId = c.env.SESSIONS.idFromName(binding.sessionId);
    const sessionDO = c.env.SESSIONS.get(doId);
    try {
      const attachments = message.attachments.map((a) => ({
        type: 'file' as const,
        mime: a.mimeType,
        url: a.url,
        filename: a.fileName,
      }));

      const resp = await sessionDO.fetch(
        new Request('http://do/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message.text,
            attachments: attachments.length > 0 ? attachments : undefined,
            queueMode: binding.queueMode,
            channelType: 'slack',
            channelId: message.channelId,
            authorName: message.senderName,
          }),
        }),
      );
      console.log(`[Slack] Bound session response: status=${resp.status}`);
      if (resp.ok) return c.json({ ok: true });
    } catch (err) {
      console.error(`[Slack] Failed to route to session ${binding.sessionId}:`, err);
    }
  } else {
    console.log(`[Slack] No binding for scopeKey=${scopeKey}, falling through to orchestrator`);
  }

  // Dispatch to orchestrator
  const attachments = message.attachments.map((a) => ({
    type: 'file' as const,
    mime: a.mimeType,
    url: a.url,
    filename: a.fileName,
  }));

  console.log(`[Slack] Orchestrator dispatch: userId=${userId} channelId=${message.channelId}`);
  const result = await dispatchOrchestratorPrompt(c.env, {
    userId,
    content: message.text || '[Attachment]',
    channelType: 'slack',
    channelId: message.channelId,
    authorName: message.senderName,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (!result.dispatched) {
    const ctx: ChannelContext = { token: botToken, userId };
    const target: ChannelTarget = {
      channelType: 'slack',
      channelId: message.channelId,
      threadId: (message.metadata?.threadTs as string) || undefined,
    };
    await transport.sendMessage(target, {
      markdown: 'Your orchestrator is not running. Start it from the Agent-Ops dashboard.',
    }, ctx);
  }

  return c.json({ ok: true });
});
