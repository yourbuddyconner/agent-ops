import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { buildOrchestratorPersonaFiles } from '../lib/orchestrator-persona.js';
import { decryptApiKey } from './admin.js';

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

/**
 * GET /api/me/orchestrator
 * Returns orchestrator info for the current user.
 */
orchestratorRouter.get('/orchestrator', async (c) => {
  const user = c.get('user');

  const identity = await db.getOrchestratorIdentity(c.env.DB, user.id);
  const session = await db.getOrchestratorSession(c.env.DB, user.id);
  const sessionId = `orchestrator:${user.id}`;

  return c.json({
    sessionId,
    identity,
    session,
    exists: !!identity && !!session,
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
  const existing = await db.getOrchestratorIdentity(c.env.DB, user.id);
  if (existing) {
    return c.json({ error: 'Orchestrator already exists' }, 409);
  }

  // Check handle uniqueness
  const handleTaken = await db.getOrchestratorIdentityByHandle(c.env.DB, body.handle);
  if (handleTaken) {
    return c.json({ error: 'Handle already taken' }, 409);
  }

  // Ensure user exists in DB
  await db.getOrCreateUser(c.env.DB, { id: user.id, email: user.email });

  // Create identity
  const identityId = crypto.randomUUID();
  const identity = await db.createOrchestratorIdentity(c.env.DB, {
    id: identityId,
    userId: user.id,
    name: body.name,
    handle: body.handle,
    avatar: body.avatar,
    customInstructions: body.customInstructions,
  });

  // Build persona files
  const personaFiles = buildOrchestratorPersonaFiles(identity);

  // Create session with well-known ID
  const sessionId = `orchestrator:${user.id}`;
  const runnerToken = generateRunnerToken();

  const session = await db.createSession(c.env.DB, {
    id: sessionId,
    userId: user.id,
    workspace: 'orchestrator',
    title: `${body.name} (Orchestrator)`,
    isOrchestrator: true,
  });

  // Build env vars (LLM keys only — no repo for orchestrator)
  const envVars: Record<string, string> = {};
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
