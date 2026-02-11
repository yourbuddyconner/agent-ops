import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { buildOrchestratorPersonaFiles } from '../lib/orchestrator-persona.js';
import { decryptApiKey } from './admin.js';

const createIdentityLinkSchema = z.object({
  provider: z.string().min(1).max(50),
  externalId: z.string().min(1).max(255),
  externalName: z.string().max(255).optional(),
  teamId: z.string().max(255).optional(),
});

export const orchestratorRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Validation Schemas ──────────────────────────────────────────────────

const createOrchestratorSchema = z.object({
  name: z.string().min(1).max(100),
  handle: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Handle must be lowercase alphanumeric with dashes/underscores'),
  avatar: z.string().max(500).optional(),
  customInstructions: z.string().max(10000).optional(),
});

const updateIdentitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  handle: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/).optional(),
  avatar: z.string().max(500).optional(),
  customInstructions: z.string().max(10000).optional(),
});

const createMemorySchema = z.object({
  content: z.string().min(1).max(5000),
  category: z.enum(['preference', 'workflow', 'context', 'project', 'decision', 'general']),
});

// ─── Helper: Generate runner token ──────────────────────────────────────

function generateRunnerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Orchestrator Routes ────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['terminated', 'archived', 'error']);

/**
 * GET /api/me/orchestrator
 * Returns orchestrator info for the current user.
 */
orchestratorRouter.get('/orchestrator', async (c) => {
  const user = c.get('user');

  const identity = await db.getOrchestratorIdentity(c.env.DB, user.id);
  const session = await db.getOrchestratorSession(c.env.DB, user.id);
  const sessionId = `orchestrator:${user.id}`;
  const needsRestart = !!identity && (!session || TERMINAL_STATUSES.has(session.status));

  return c.json({
    sessionId,
    identity,
    session,
    exists: !!identity && !!session,
    needsRestart,
  });
});

/**
 * POST /api/me/orchestrator
 * Onboarding: creates identity + session + DO.
 */
orchestratorRouter.post('/orchestrator', zValidator('json', createOrchestratorSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Check if identity already exists
  let identity = await db.getOrchestratorIdentity(c.env.DB, user.id);
  const existingSession = await db.getOrchestratorSession(c.env.DB, user.id);

  if (identity && existingSession && !TERMINAL_STATUSES.has(existingSession.status)) {
    // Identity exists and session is healthy — cannot recreate
    return c.json({ error: 'Orchestrator already exists' }, 409);
  }

  // Ensure user exists in DB
  await db.getOrCreateUser(c.env.DB, { id: user.id, email: user.email });

  if (!identity) {
    // Check handle uniqueness only for new identities
    const handleTaken = await db.getOrchestratorIdentityByHandle(c.env.DB, body.handle);
    if (handleTaken) {
      return c.json({ error: 'Handle already taken' }, 409);
    }

    // Create identity
    const identityId = crypto.randomUUID();
    identity = await db.createOrchestratorIdentity(c.env.DB, {
      id: identityId,
      userId: user.id,
      name: body.name,
      handle: body.handle,
      avatar: body.avatar,
      customInstructions: body.customInstructions,
    });
  } else {
    // Reuse existing identity — optionally update name/instructions if provided
    await db.updateOrchestratorIdentity(c.env.DB, identity.id, {
      name: body.name,
      handle: body.handle,
      customInstructions: body.customInstructions,
    });
    identity = (await db.getOrchestratorIdentity(c.env.DB, user.id))!;
  }

  // Build persona files
  const personaFiles = buildOrchestratorPersonaFiles(identity);

  // Create session with well-known ID (resets the old terminated session)
  const sessionId = `orchestrator:${user.id}`;
  const runnerToken = generateRunnerToken();

  // If old session exists in terminal state, update it back to initializing
  if (existingSession && TERMINAL_STATUSES.has(existingSession.status)) {
    await db.updateSessionStatus(c.env.DB, sessionId, 'initializing');
  }

  const session = existingSession && TERMINAL_STATUSES.has(existingSession.status)
    ? { ...existingSession, status: 'initializing' as const }
    : await db.createSession(c.env.DB, {
        id: sessionId,
        userId: user.id,
        workspace: 'orchestrator',
        title: `${identity.name} (Orchestrator)`,
        isOrchestrator: true,
        purpose: 'orchestrator',
      });

  // Build env vars (LLM keys + orchestrator flag — no repo for orchestrator)
  const envVars: Record<string, string> = {
    IS_ORCHESTRATOR: 'true',
  };
  const providerEnvMap = [
    { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY' },
    { provider: 'openai', envKey: 'OPENAI_API_KEY' },
    { provider: 'google', envKey: 'GOOGLE_API_KEY' },
  ] as const;

  for (const { provider, envKey } of providerEnvMap) {
    try {
      const orgKey = await db.getOrgApiKey(c.env.DB, provider);
      if (orgKey) {
        envVars[envKey] = await decryptApiKey(orgKey.encryptedKey, c.env.ENCRYPTION_KEY);
        continue;
      }
    } catch {
      // fall through
    }
    if (c.env[envKey]) envVars[envKey] = c.env[envKey]!;
  }

  // User-level credentials (1Password, etc.)
  const credentialEnvMap = [
    { provider: '1password', envKey: 'OP_SERVICE_ACCOUNT_TOKEN' },
  ] as const;

  for (const { provider, envKey } of credentialEnvMap) {
    try {
      const cred = await db.getUserCredential(c.env.DB, user.id, provider);
      if (cred) {
        envVars[envKey] = await decryptApiKey(cred.encryptedKey, c.env.ENCRYPTION_KEY);
      }
    } catch {
      // Table may not exist yet — skip
    }
  }

  // Construct DO WebSocket URL
  const wsProtocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
  const host = c.req.header('host') || 'localhost';
  const doWsUrl = `${wsProtocol}://${host}/api/sessions/${sessionId}/ws`;

  // Fetch user's idle timeout preference
  const userRow = await db.getUserById(c.env.DB, user.id);
  const idleTimeoutSeconds = userRow?.idleTimeoutSeconds ?? 900;
  const idleTimeoutMs = idleTimeoutSeconds * 1000;

  const spawnRequest = {
    sessionId,
    userId: user.id,
    workspace: 'orchestrator',
    imageType: 'base',
    doWsUrl,
    runnerToken,
    jwtSecret: c.env.ENCRYPTION_KEY,
    idleTimeoutSeconds,
    envVars,
    personaFiles,
  };

  // Initialize SessionAgent DO
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  try {
    await sessionDO.fetch(new Request('http://do/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        userId: user.id,
        workspace: 'orchestrator',
        runnerToken,
        backendUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'create-session'),
        terminateUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'terminate-session'),
        hibernateUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'hibernate-session'),
        restoreUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'restore-session'),
        idleTimeoutMs,
        spawnRequest,
      }),
    }));
  } catch (err) {
    console.error('Failed to initialize orchestrator DO:', err);
    await db.updateSessionStatus(c.env.DB, sessionId, 'error', undefined,
      `Failed to initialize orchestrator: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({
      error: 'Failed to initialize orchestrator session',
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  return c.json({ sessionId, identity, session }, 201);
});

/**
 * GET /api/me/orchestrator/identity
 */
orchestratorRouter.get('/orchestrator/identity', async (c) => {
  const user = c.get('user');
  const identity = await db.getOrchestratorIdentity(c.env.DB, user.id);
  if (!identity) {
    return c.json({ error: 'Orchestrator not set up' }, 404);
  }
  return c.json({ identity });
});

/**
 * PUT /api/me/orchestrator/identity
 */
orchestratorRouter.put('/orchestrator/identity', zValidator('json', updateIdentitySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const identity = await db.getOrchestratorIdentity(c.env.DB, user.id);
  if (!identity) {
    return c.json({ error: 'Orchestrator not set up' }, 404);
  }

  // If changing handle, check uniqueness
  if (body.handle && body.handle !== identity.handle) {
    const handleTaken = await db.getOrchestratorIdentityByHandle(c.env.DB, body.handle);
    if (handleTaken) {
      return c.json({ error: 'Handle already taken' }, 409);
    }
  }

  await db.updateOrchestratorIdentity(c.env.DB, identity.id, body);

  const updated = await db.getOrchestratorIdentity(c.env.DB, user.id);
  return c.json({ identity: updated });
});

/**
 * GET /api/me/orchestrator/check-handle?handle=foo
 * Returns whether a handle is available.
 */
orchestratorRouter.get('/orchestrator/check-handle', async (c) => {
  const handle = c.req.query('handle');
  if (!handle) {
    return c.json({ error: 'handle query param required' }, 400);
  }
  const existing = await db.getOrchestratorIdentityByHandle(c.env.DB, handle);
  // If the handle belongs to the current user, it's still "available" to them
  const user = c.get('user');
  const available = !existing || existing.userId === user.id;
  return c.json({ available, handle });
});

// ─── Memory Routes ──────────────────────────────────────────────────────

/**
 * GET /api/me/memories
 */
orchestratorRouter.get('/memories', async (c) => {
  const user = c.get('user');
  const { category, query, limit } = c.req.query();

  const memories = await db.listOrchestratorMemories(c.env.DB, user.id, {
    category,
    query,
    limit: limit ? parseInt(limit) : undefined,
  });

  return c.json({ memories });
});

/**
 * POST /api/me/memories
 */
orchestratorRouter.post('/memories', zValidator('json', createMemorySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const memory = await db.createOrchestratorMemory(c.env.DB, {
    id,
    userId: user.id,
    category: body.category,
    content: body.content,
  });

  return c.json({ memory }, 201);
});

/**
 * DELETE /api/me/memories/:id
 */
orchestratorRouter.delete('/memories/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const deleted = await db.deleteOrchestratorMemory(c.env.DB, id, user.id);
  if (!deleted) {
    return c.json({ error: 'Memory not found' }, 404);
  }

  return c.json({ success: true });
});

// ─── Notification Queue Routes (Phase C) ────────────────────────────────

async function listNotifications(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const user = c.get('user');
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const messageType = c.req.query('messageType') || undefined;
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const cursor = c.req.query('cursor') || undefined;

  const result = await db.getUserNotifications(c.env.DB, user.id, {
    unreadOnly,
    messageType,
    limit,
    cursor,
  });
  return c.json(result);
}

async function getNotificationCount(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const user = c.get('user');
  const count = await db.getUserNotificationCount(c.env.DB, user.id);
  return c.json({ count });
}

async function getNotificationThread(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const user = c.get('user');
  const { threadId } = c.req.param();

  const thread = await db.getNotificationThread(c.env.DB, threadId, user.id);
  if (!thread.rootMessage) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  await db.markNotificationThreadRead(c.env.DB, threadId, user.id);

  return c.json({
    rootMessage: thread.rootMessage,
    replies: thread.replies,
    totalCount: 1 + thread.replies.length,
  });
}

async function markNotificationRead(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const user = c.get('user');
  const { messageId } = c.req.param();

  const success = await db.markNotificationRead(c.env.DB, messageId, user.id);
  if (!success) {
    return c.json({ error: 'Message not found or already read' }, 404);
  }
  return c.json({ success: true });
}

async function replyToNotification(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const user = c.get('user');
  const { messageId } = c.req.param();
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'content is required' }, 400);
  }

  const original = await db.getMailboxMessage(c.env.DB, messageId);
  if (!original) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const threadRootId = original.replyToId || original.id;
  const rootMessage = original.replyToId
    ? await db.getMailboxMessage(c.env.DB, threadRootId)
    : original;
  if (!rootMessage) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  if (rootMessage.toUserId !== user.id && rootMessage.fromUserId !== user.id) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const isRecipient = rootMessage.toUserId === user.id;
  const reply = await db.enqueueNotification(c.env.DB, {
    fromUserId: user.id,
    toSessionId: isRecipient ? rootMessage.fromSessionId : rootMessage.toSessionId,
    toUserId: isRecipient ? rootMessage.fromUserId : rootMessage.toUserId,
    messageType: rootMessage.messageType,
    content: body.content,
    contextSessionId: rootMessage.contextSessionId,
    contextTaskId: rootMessage.contextTaskId,
    replyToId: threadRootId,
  });

  return c.json({ message: reply }, 201);
}

/**
 * GET /api/me/notifications
 * User notification queue — paginated and filterable.
 */
orchestratorRouter.get('/notifications', listNotifications);

/**
 * GET /api/me/notifications/count
 * Unread count (for badge).
 */
orchestratorRouter.get('/notifications/count', getNotificationCount);

/**
 * GET /api/me/notifications/threads/:threadId
 * Fetch full thread (root + replies) and auto-mark read.
 */
orchestratorRouter.get('/notifications/threads/:threadId', getNotificationThread);

/**
 * PUT /api/me/notifications/:messageId/read
 * Mark single notification as read.
 */
orchestratorRouter.put('/notifications/:messageId/read', markNotificationRead);

/**
 * PUT /api/me/notifications/read-non-actionable
 * Mark non-actionable unread notifications as read.
 */
orchestratorRouter.put('/notifications/read-non-actionable', async (c) => {
  const user = c.get('user');
  const count = await db.markNonActionableNotificationsRead(c.env.DB, user.id);
  return c.json({ success: true, count });
});

/**
 * POST /api/me/notifications/:messageId/reply
 * Reply to a notification thread.
 */
orchestratorRouter.post('/notifications/:messageId/reply', replyToNotification);

// ─── Notification Preferences Routes (Phase C) ─────────────────────────

/**
 * GET /api/me/notification-preferences
 */
orchestratorRouter.get('/notification-preferences', async (c) => {
  const user = c.get('user');
  const preferences = await db.getNotificationPreferences(c.env.DB, user.id);
  return c.json({ preferences });
});

/**
 * PUT /api/me/notification-preferences
 */
orchestratorRouter.put('/notification-preferences', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    messageType: string;
    webEnabled?: boolean;
    slackEnabled?: boolean;
    emailEnabled?: boolean;
  }>();

  if (!body.messageType) {
    return c.json({ error: 'messageType is required' }, 400);
  }

  const pref = await db.upsertNotificationPreference(c.env.DB, user.id, body.messageType, {
    webEnabled: body.webEnabled,
    slackEnabled: body.slackEnabled,
    emailEnabled: body.emailEnabled,
  });

  return c.json({ preference: pref });
});

// ─── Org Directory Routes (Phase C) ────────────────────────────────────

/**
 * GET /api/me/org-agents
 * List orchestrator identities in org.
 */
orchestratorRouter.get('/org-agents', async (c) => {
  const user = c.get('user');
  // Get the user's org from settings
  const orgSettings = await c.env.DB
    .prepare('SELECT id FROM org_settings LIMIT 1')
    .first<{ id: string }>();

  if (!orgSettings) {
    return c.json({ agents: [] });
  }

  const agents = await db.getOrgAgents(c.env.DB, orgSettings.id);
  return c.json({ agents });
});

// ─── Identity Link Routes (Phase D) ──────────────────────────────────────

/**
 * GET /api/me/identity-links
 * List user's linked external identities.
 */
orchestratorRouter.get('/identity-links', async (c) => {
  const user = c.get('user');
  const links = await db.getUserIdentityLinks(c.env.DB, user.id);
  return c.json({ links });
});

/**
 * POST /api/me/identity-links
 * Link an external identity (e.g. Slack user, GitHub user).
 */
orchestratorRouter.post('/identity-links', zValidator('json', createIdentityLinkSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  try {
    const link = await db.createIdentityLink(c.env.DB, {
      id,
      userId: user.id,
      provider: body.provider,
      externalId: body.externalId,
      externalName: body.externalName,
      teamId: body.teamId,
    });
    return c.json({ link }, 201);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'This external identity is already linked' }, 409);
    }
    throw err;
  }
});

/**
 * DELETE /api/me/identity-links/:id
 * Unlink an external identity.
 */
orchestratorRouter.delete('/identity-links/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const deleted = await db.deleteIdentityLink(c.env.DB, id, user.id);
  if (!deleted) {
    return c.json({ error: 'Identity link not found' }, 404);
  }

  return c.json({ success: true });
});
