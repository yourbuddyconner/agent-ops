import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { signJWT } from '../lib/jwt.js';

export const sessionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const createSessionSchema = z.object({
  workspace: z.string().min(1).max(100),
  config: z
    .object({
      memory: z.string().optional(),
      timeout: z.number().optional(),
    })
    .optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(100000),
  attachments: z
    .array(
      z.object({
        type: z.enum(['file', 'url']),
        name: z.string(),
        data: z.string(),
        mimeType: z.string().optional(),
      })
    )
    .optional(),
});

/**
 * Generate a 256-bit hex token for runner authentication.
 */
function generateRunnerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * GET /api/sessions
 * List user's sessions
 */
sessionsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { limit, cursor, status } = c.req.query();

  const result = await db.getUserSessions(c.env.DB, user.id, {
    limit: limit ? parseInt(limit) : undefined,
    cursor,
    status,
  });

  return c.json(result);
});

/**
 * POST /api/sessions
 * Create a new agent session.
 * Flow: create DB record → generate runner token → call Python backend
 * to spawn sandbox → initialize SessionAgentDO with sandbox info.
 */
sessionsRouter.post('/', zValidator('json', createSessionSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const sessionId = crypto.randomUUID();
  const runnerToken = generateRunnerToken();

  // Ensure user exists in DB
  await db.getOrCreateUser(c.env.DB, { id: user.id, email: user.email });

  // Create session record
  const session = await db.createSession(c.env.DB, {
    id: sessionId,
    userId: user.id,
    workspace: body.workspace,
    metadata: body.config,
  });

  // Construct WebSocket URL for the DO (used by Runner inside sandbox)
  const wsProtocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
  const host = c.req.header('host') || 'localhost';
  const doWsUrl = `${wsProtocol}://${host}/api/sessions/${sessionId}/ws`;

  // Initialize SessionAgentDO — it will spawn the sandbox asynchronously
  // so we can return immediately without waiting for the image build.
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  try {
    await sessionDO.fetch(new Request('http://do/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        userId: user.id,
        workspace: body.workspace,
        runnerToken,
        // DO will call Modal to spawn the sandbox in the background
        backendUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'create-session'),
        terminateUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'terminate-session'),
        spawnRequest: {
          sessionId,
          userId: user.id,
          workspace: body.workspace,
          imageType: 'base',
          doWsUrl,
          runnerToken,
          jwtSecret: c.env.ENCRYPTION_KEY,
          envVars: {
            ANTHROPIC_API_KEY: '',  // TODO: pull from user's API keys DO
          },
        },
      }),
    }));
  } catch (err) {
    console.error('Failed to initialize SessionAgentDO:', err);
    await db.updateSessionStatus(c.env.DB, sessionId, 'error');
    return c.json({
      error: 'Failed to initialize session',
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  // Build client WebSocket URL
  const websocketUrl = `${wsProtocol}://${host}/api/sessions/${sessionId}/ws?role=client&userId=${user.id}`;

  return c.json(
    {
      session: { ...session, status: 'initializing' as const },
      websocketUrl,
    },
    201
  );
});

/**
 * GET /api/sessions/:id
 * Get session details
 */
sessionsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  // Get live status from DO
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const statusRes = await sessionDO.fetch(new Request('http://do/status'));
  const doStatus = await statusRes.json() as {
    tunnelUrls?: Record<string, string>;
    [key: string]: unknown;
  };

  // Populate gatewayUrl from DO status for frontend consumption
  const gatewayUrl = doStatus.tunnelUrls?.gateway;

  return c.json({
    session: { ...session, gatewayUrl },
    doStatus,
  });
});

/**
 * GET /api/sessions/:id/sandbox-token
 * Issue a short-lived JWT for direct iframe access to sandbox tunnel URLs.
 * Returns the token + tunnel URLs so the frontend can construct iframe src.
 */
sessionsRouter.get('/:id/sandbox-token', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  // Don't attempt token generation for terminated sessions
  if (session.status === 'terminated' || session.status === 'error') {
    return c.json({ error: 'Session is not running' }, 503);
  }

  // Get tunnel URLs from the SessionAgent DO (source of truth, not stale D1 status)
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const statusRes = await sessionDO.fetch(new Request('http://do/status'));
  const statusData = await statusRes.json() as {
    tunnelUrls: Record<string, string> | null;
    sessionId: string;
  };

  if (!statusData.tunnelUrls) {
    return c.json({ error: 'Sandbox tunnel URLs not available' }, 503);
  }

  // Sign a short-lived JWT (15 minutes)
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    {
      sub: user.id,
      sid: id,
      iat: now,
      exp: now + 15 * 60,
    },
    c.env.ENCRYPTION_KEY,
  );

  return c.json({
    token,
    tunnelUrls: statusData.tunnelUrls,
    expiresAt: new Date((now + 15 * 60) * 1000).toISOString(),
  });
});

/**
 * POST /api/sessions/:id/messages
 * Send a message/prompt to the session agent.
 * The DO will queue it and forward to the runner via WebSocket.
 */
sessionsRouter.post('/:id/messages', zValidator('json', sendMessageSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const body = c.req.valid('json');

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  if (session.status === 'terminated') {
    throw new ValidationError('Session has been terminated');
  }

  // Save message to D1 for API access
  const messageId = crypto.randomUUID();
  await db.saveMessage(c.env.DB, {
    id: messageId,
    sessionId: id,
    role: 'user',
    content: body.content,
  });

  // Forward prompt to SessionAgent DO for queuing and runner delivery
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const doRes = await sessionDO.fetch(new Request('http://do/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: body.content }),
  }));

  if (!doRes.ok) {
    const err = await doRes.text();
    return c.json({ error: `Failed to deliver prompt: ${err}` }, 500);
  }

  return c.json({ success: true, messageId });
});

/**
 * POST /api/sessions/:id/clear-queue
 * Clear the prompt queue for a session. Only the session owner can do this.
 */
sessionsRouter.post('/:id/clear-queue', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const res = await sessionDO.fetch(new Request('http://do/clear-queue', { method: 'POST' }));
  const result = await res.json() as { cleared: number };

  return c.json(result);
});

/**
 * GET /api/sessions/:id/messages
 * Get session message history
 */
sessionsRouter.get('/:id/messages', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const { limit, after } = c.req.query();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  const messages = await db.getSessionMessages(c.env.DB, id, {
    limit: limit ? parseInt(limit) : undefined,
    after,
  });

  return c.json({ messages });
});

/**
 * GET /api/sessions/:id/ws
 * WebSocket upgrade — proxies to SessionAgentDO.
 */
sessionsRouter.get('/:id/ws', async (c) => {
  const { id } = c.req.param();

  // Allow both client and runner connections
  // Clients: ?role=client&userId=...
  // Runner: ?role=runner&token=...
  const role = c.req.query('role');

  if (role === 'client') {
    const user = c.get('user');
    const session = await db.getSession(c.env.DB, id);
    if (!session || session.userId !== user.id) {
      throw new NotFoundError('Session', id);
    }
  }
  // Runner auth is handled by the DO itself via token validation

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  // Forward the raw request (including upgrade headers and query params)
  return sessionDO.fetch(c.req.raw);
});

/**
 * GET /api/sessions/:id/events
 * Server-Sent Events endpoint for real-time updates
 */
sessionsRouter.get('/:id/events', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  // Create SSE stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial connection event
  writer.write(encoder.encode(`event: connected\ndata: {"sessionId":"${id}"}\n\n`));

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(async () => {
    try {
      await writer.write(encoder.encode(`: heartbeat\n\n`));
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Clean up on close
  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    writer.close();
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * DELETE /api/sessions/:id
 * Terminate a session — stops the DO and terminates the sandbox.
 */
sessionsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.getSession(c.env.DB, id);

  if (!session) {
    throw new NotFoundError('Session', id);
  }

  if (session.userId !== user.id) {
    throw new NotFoundError('Session', id);
  }

  // Stop the SessionAgent DO (it handles sandbox termination internally)
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  await sessionDO.fetch(new Request('http://do/stop', { method: 'POST' }));

  // Update DB status
  await db.updateSessionStatus(c.env.DB, id, 'terminated');

  return c.json({ success: true });
});
