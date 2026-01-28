import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';

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
 * Create a new agent session
 */
sessionsRouter.post('/', zValidator('json', createSessionSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const sessionId = crypto.randomUUID();

  // Ensure user exists in DB
  await db.getOrCreateUser(c.env.DB, { id: user.id, email: user.email });

  // Create session record
  const session = await db.createSession(c.env.DB, {
    id: sessionId,
    userId: user.id,
    workspace: body.workspace,
    metadata: body.config,
  });

  // Initialize the Durable Object
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  await sessionDO.fetch(new Request('http://internal/init', {
    method: 'POST',
    body: JSON.stringify({
      id: sessionId,
      userId: user.id,
      workspace: body.workspace,
      // In production, this would be the container's OpenCode server URL
      // openCodeBaseUrl: `http://container-${sessionId}:4096`,
    }),
  }));

  // Update session status
  await db.updateSessionStatus(c.env.DB, sessionId, 'idle');

  // Build WebSocket URL
  const wsProtocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
  const host = c.req.header('host') || 'localhost';
  const websocketUrl = `${wsProtocol}://${host}/api/sessions/${sessionId}/ws?userId=${user.id}`;

  return c.json(
    {
      session: { ...session, status: 'idle' as const },
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

  return c.json({ session });
});

/**
 * POST /api/sessions/:id/messages
 * Send a message to the agent
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

  // Forward to Durable Object
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/message', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

  // Stream the response back
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
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

  // In a real implementation, you'd subscribe to DO events here
  // For now, just keep the connection alive with heartbeats
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
 * Terminate a session
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

  // Terminate the Durable Object session
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  await sessionDO.fetch(new Request('http://internal/terminate', { method: 'POST' }));

  // Update DB status
  await db.updateSessionStatus(c.env.DB, id, 'terminated');

  return c.json({ success: true });
});
