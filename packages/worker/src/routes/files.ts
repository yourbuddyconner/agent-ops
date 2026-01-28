import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';

export const filesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/files/search
 * Search files in a session's workspace via OpenCode
 */
filesRouter.get('/search', async (c) => {
  const user = c.get('user');
  const { sessionId, query, limit } = c.req.query();

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  if (!query) {
    throw new ValidationError('query is required');
  }

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // Forward to session DO which proxies to OpenCode
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  const params = new URLSearchParams({ query });
  if (limit) params.set('limit', limit);

  const response = await sessionDO.fetch(
    new Request(`http://internal/proxy?path=/file/search?${params}`)
  );

  if (!response.ok) {
    return c.json({ results: [] });
  }

  const data = await response.json();
  return c.json(data);
});

/**
 * GET /api/files/read
 * Read a file from a session's workspace
 */
filesRouter.get('/read', async (c) => {
  const user = c.get('user');
  const { sessionId, path } = c.req.query();

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  if (!path) {
    throw new ValidationError('path is required');
  }

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // Forward to session DO
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  const response = await sessionDO.fetch(
    new Request(`http://internal/proxy?path=/file/read?path=${encodeURIComponent(path)}`)
  );

  if (!response.ok) {
    throw new NotFoundError('File', path);
  }

  const data = await response.json();
  return c.json(data);
});

/**
 * GET /api/files/list
 * List files in a directory
 */
filesRouter.get('/list', async (c) => {
  const user = c.get('user');
  const { sessionId, path } = c.req.query();

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  const dirPath = path || '/';

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // Forward to session DO
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  const response = await sessionDO.fetch(
    new Request(`http://internal/proxy?path=/file/list?path=${encodeURIComponent(dirPath)}`)
  );

  if (!response.ok) {
    return c.json({ files: [] });
  }

  const data = await response.json();
  return c.json(data);
});

/**
 * GET /api/files/backup
 * List backed up files in R2 for a session
 */
filesRouter.get('/backup', async (c) => {
  const user = c.get('user');
  const { sessionId, prefix } = c.req.query();

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // List files in R2
  const r2Prefix = `backups/${user.id}/sessions/${sessionId}/artifacts/${prefix || ''}`;
  const objects = await c.env.STORAGE.list({ prefix: r2Prefix, limit: 100 });

  const files = objects.objects.map((obj) => ({
    key: obj.key.replace(r2Prefix, ''),
    size: obj.size,
    uploaded: obj.uploaded,
  }));

  return c.json({ files });
});

/**
 * GET /api/files/backup/:key
 * Download a backed up file from R2
 */
filesRouter.get('/backup/:key', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.query();
  const { key } = c.req.param();

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // Get file from R2
  const r2Key = `backups/${user.id}/sessions/${sessionId}/artifacts/${key}`;
  const object = await c.env.STORAGE.get(r2Key);

  if (!object) {
    throw new NotFoundError('File', key);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `attachment; filename="${key}"`);

  return new Response(object.body, { headers });
});

/**
 * POST /api/files/backup
 * Backup a file to R2
 */
filesRouter.post('/backup', async (c) => {
  const user = c.get('user');
  const { sessionId, path, content } = await c.req.json<{
    sessionId: string;
    path: string;
    content: string;
  }>();

  if (!sessionId || !path || !content) {
    throw new ValidationError('sessionId, path, and content are required');
  }

  // Verify session ownership
  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  // Store in R2
  const timestamp = Date.now();
  const filename = path.split('/').pop() || 'file';
  const r2Key = `backups/${user.id}/sessions/${sessionId}/artifacts/${timestamp}_${filename}`;

  await c.env.STORAGE.put(r2Key, content, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      originalPath: path,
      sessionId,
    },
  });

  return c.json({ key: `${timestamp}_${filename}`, success: true });
});
