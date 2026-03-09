import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { NotFoundError } from '@valet/shared';
import type { Message } from '@valet/shared';
import * as db from '../lib/db.js';

export const threadsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/sessions/:sessionId/threads
 * List threads for a session (paginated).
 */
threadsRouter.get('/:sessionId/threads', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();
  const { cursor, limit } = c.req.query();

  await db.assertSessionAccess(c.get('db'), sessionId, user.id, 'viewer');

  const result = await db.listThreads(c.env.DB, sessionId, {
    cursor,
    limit: limit ? parseInt(limit) : undefined,
  });

  return c.json(result);
});

/**
 * POST /api/sessions/:sessionId/threads
 * Create a new thread.
 */
threadsRouter.post('/:sessionId/threads', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  await db.assertSessionAccess(c.get('db'), sessionId, user.id, 'collaborator');

  const id = crypto.randomUUID();
  const thread = await db.createThread(c.env.DB, { id, sessionId });

  return c.json(thread, 201);
});

/**
 * GET /api/sessions/:sessionId/threads/:threadId
 * Get thread detail with messages.
 */
threadsRouter.get('/:sessionId/threads/:threadId', async (c) => {
  const user = c.get('user');
  const { sessionId, threadId } = c.req.param();

  await db.assertSessionAccess(c.get('db'), sessionId, user.id, 'viewer');

  const thread = await db.getThread(c.env.DB, threadId);
  if (!thread || thread.sessionId !== sessionId) {
    throw new NotFoundError('Thread', threadId);
  }

  // Fetch messages for this thread using raw D1 query
  const result = await c.env.DB
    .prepare(
      'SELECT * FROM messages WHERE session_id = ? AND thread_id = ? ORDER BY created_at ASC'
    )
    .bind(sessionId, threadId)
    .all();

  const messages: Message[] = (result.results || []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as Message['role'],
    content: row.content,
    parts: row.parts ? JSON.parse(row.parts) : undefined,
    authorId: row.author_id || undefined,
    authorEmail: row.author_email || undefined,
    authorName: row.author_name || undefined,
    authorAvatarUrl: row.author_avatar_url || undefined,
    channelType: row.channel_type || undefined,
    channelId: row.channel_id || undefined,
    opencodeSessionId: row.opencode_session_id || undefined,
    createdAt: new Date(row.created_at),
  }));

  return c.json({ thread, messages });
});

/**
 * POST /api/sessions/:sessionId/threads/:threadId/continue
 * Create a new thread as a continuation of an old one.
 */
threadsRouter.post('/:sessionId/threads/:threadId/continue', async (c) => {
  const user = c.get('user');
  const { sessionId, threadId } = c.req.param();

  await db.assertSessionAccess(c.get('db'), sessionId, user.id, 'collaborator');

  const oldThread = await db.getThread(c.env.DB, threadId);
  if (!oldThread || oldThread.sessionId !== sessionId) {
    throw new NotFoundError('Thread', threadId);
  }

  const id = crypto.randomUUID();
  const thread = await db.createThread(c.env.DB, { id, sessionId });

  return c.json({ thread }, 201);
});
