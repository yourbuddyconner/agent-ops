import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';

export const agentRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Agent routes proxy requests to the OpenCode server running in containers.
 * These routes are used for direct agent interaction outside of the session abstraction.
 */

/**
 * GET /agent/:sessionId/health
 * Check if the agent container is healthy
 */
agentRouter.get('/:sessionId/health', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/proxy?path=/health'));

  if (!response.ok) {
    return c.json({ status: 'unhealthy', error: 'Container not responding' }, 503);
  }

  const data = await response.json() as Record<string, unknown>;
  return c.json({ status: 'healthy', ...data });
});

/**
 * GET /agent/:sessionId/project
 * Get project info from the agent
 */
agentRouter.get('/:sessionId/project', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/proxy?path=/project'));

  if (!response.ok) {
    return c.json({ error: 'Failed to get project info' }, response.status as ContentfulStatusCode);
  }

  return c.json(await response.json());
});

/**
 * GET /agent/:sessionId/providers
 * List available AI providers
 */
agentRouter.get('/:sessionId/providers', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/proxy?path=/provider'));

  if (!response.ok) {
    return c.json({ providers: [] });
  }

  return c.json(await response.json());
});

/**
 * GET /agent/:sessionId/models
 * List available AI models
 */
agentRouter.get('/:sessionId/models', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/proxy?path=/model'));

  if (!response.ok) {
    return c.json({ models: [] });
  }

  return c.json(await response.json());
});

/**
 * GET /agent/:sessionId/commands
 * List available slash commands
 */
agentRouter.get('/:sessionId/commands', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(new Request('http://internal/proxy?path=/command'));

  if (!response.ok) {
    return c.json({ commands: [] });
  }

  return c.json(await response.json());
});

/**
 * POST /agent/:sessionId/commands/:name
 * Execute a slash command
 */
agentRouter.post('/:sessionId/commands/:name', async (c) => {
  const user = c.get('user');
  const { sessionId, name } = c.req.param();
  const body = await c.req.json().catch(() => ({}));

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(
    new Request(`http://internal/proxy?path=/command/${name}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

  if (!response.ok) {
    return c.json({ error: `Command failed: ${name}` }, response.status as ContentfulStatusCode);
  }

  return c.json(await response.json());
});

/**
 * POST /agent/:sessionId/share
 * Share the current session
 */
agentRouter.post('/:sessionId/share', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  // Get OpenCode session ID
  const statusRes = await sessionDO.fetch(new Request('http://internal/status'));
  if (!statusRes.ok) {
    return c.json({ error: 'Failed to get session status' }, 500);
  }

  const response = await sessionDO.fetch(
    new Request('http://internal/proxy?path=/session/share', { method: 'POST' })
  );

  if (!response.ok) {
    return c.json({ error: 'Failed to share session' }, response.status as ContentfulStatusCode);
  }

  return c.json(await response.json());
});

/**
 * POST /agent/:sessionId/summarize
 * Summarize the current session
 */
agentRouter.post('/:sessionId/summarize', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const response = await sessionDO.fetch(
    new Request('http://internal/proxy?path=/session/summarize', { method: 'POST' })
  );

  if (!response.ok) {
    return c.json({ error: 'Failed to summarize session' }, response.status as ContentfulStatusCode);
  }

  return c.json(await response.json());
});

/**
 * Catch-all proxy for other OpenCode endpoints
 * GET/POST /agent/:sessionId/proxy/*
 */
agentRouter.all('/:sessionId/proxy/*', async (c) => {
  const user = c.get('user');
  const { sessionId } = c.req.param();
  const path = c.req.path.replace(`/agent/${sessionId}/proxy`, '');

  const session = await db.getSession(c.env.DB, sessionId);
  if (!session || session.userId !== user.id) {
    throw new NotFoundError('Session', sessionId);
  }

  const doId = c.env.AGENT_SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.AGENT_SESSIONS.get(doId);

  const url = new URL(c.req.url);
  const proxyPath = path + url.search;

  const response = await sessionDO.fetch(
    new Request(`http://internal/proxy?path=${encodeURIComponent(proxyPath)}`, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    })
  );

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});
