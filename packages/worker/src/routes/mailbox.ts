import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';

export const mailboxRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Validation Schemas ──────────────────────────────────────────────────

const sendMessageSchema = z.object({
  fromSessionId: z.string().optional(),
  fromUserId: z.string().optional(),
  toSessionId: z.string().optional(),
  toUserId: z.string().optional(),
  toHandle: z.string().optional(),
  messageType: z.enum(['message', 'notification', 'question', 'escalation']).optional(),
  content: z.string().min(1).max(10000),
  contextSessionId: z.string().optional(),
  contextTaskId: z.string().optional(),
  replyToId: z.string().optional(),
});

// ─── Mailbox Routes ─────────────────────────────────────────────────────

/**
 * GET /api/sessions/:sessionId/mailbox
 * Get mailbox messages for a session.
 */
mailboxRouter.get('/sessions/:sessionId/mailbox', async (c) => {
  const { sessionId } = c.req.param();
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const after = c.req.query('after') || undefined;

  const messages = await db.getSessionMailbox(c.env.DB, sessionId, { unreadOnly, limit, after });
  return c.json({ messages });
});

/**
 * POST /api/mailbox
 * Send a mailbox message (to session or user, with @handle resolution).
 */
mailboxRouter.post('/mailbox', zValidator('json', sendMessageSchema), async (c) => {
  const body = c.req.valid('json');

  // Resolve @handle to userId if provided
  let toUserId = body.toUserId;
  if (body.toHandle && !toUserId && !body.toSessionId) {
    const identity = await db.getOrchestratorIdentityByHandle(c.env.DB, body.toHandle);
    if (!identity) {
      return c.json({ error: `Handle @${body.toHandle} not found` }, 404);
    }
    toUserId = identity.userId;
  }

  if (!body.toSessionId && !toUserId) {
    return c.json({ error: 'Must specify toSessionId, toUserId, or toHandle' }, 400);
  }

  const message = await db.createMailboxMessage(c.env.DB, {
    fromSessionId: body.fromSessionId,
    fromUserId: body.fromUserId,
    toSessionId: body.toSessionId,
    toUserId,
    messageType: body.messageType,
    content: body.content,
    contextSessionId: body.contextSessionId,
    contextTaskId: body.contextTaskId,
    replyToId: body.replyToId,
  });

  return c.json({ message }, 201);
});

/**
 * PUT /api/sessions/:sessionId/mailbox/read
 * Mark all session mailbox messages as read.
 */
mailboxRouter.put('/sessions/:sessionId/mailbox/read', async (c) => {
  const { sessionId } = c.req.param();
  const count = await db.markSessionMailboxRead(c.env.DB, sessionId);
  return c.json({ success: true, count });
});
