import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ForbiddenError, NotFoundError, ValidationError, webManualScopeKey } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { signJWT } from '../lib/jwt.js';
import { decryptString } from '../lib/crypto.js';
import { decryptApiKey } from './admin.js';

export const sessionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const createSessionSchema = z.object({
  workspace: z.string().min(1).max(100),
  repoUrl: z.string().url().optional(),
  branch: z.string().optional(),
  ref: z.string().optional(),
  title: z.string().max(200).optional(),
  parentSessionId: z.string().uuid().optional(),
  config: z
    .object({
      memory: z.string().optional(),
      timeout: z.number().optional(),
    })
    .optional(),
  sourceType: z.enum(['pr', 'issue', 'branch', 'manual']).optional(),
  sourcePrNumber: z.number().int().positive().optional(),
  sourceIssueNumber: z.number().int().positive().optional(),
  sourceRepoFullName: z.string().optional(),
  initialPrompt: z.string().max(100000).optional(),
  initialModel: z.string().max(255).optional(),
  personaId: z.string().uuid().optional(),
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

type ChildTunnelSummary = { name: string; url?: string; path?: string; port?: number; protocol?: string };
type ChildSummaryWithRuntime = Awaited<ReturnType<typeof db.getChildSessions>>['children'][number] & {
  prTitle?: string;
  gatewayUrl?: string;
  tunnels?: ChildTunnelSummary[];
};

const NON_ACTIVE_TUNNEL_STATUSES = new Set(['terminated', 'error', 'hibernated']);
const PR_REFRESH_INTERVAL_MS = 60_000;
const childPrRefreshCache = new Map<string, number>();

function assertSessionShareable(session: Awaited<ReturnType<typeof db.assertSessionAccess>>) {
  if (session.isOrchestrator || session.purpose === 'workflow') {
    throw new ForbiddenError('This session type cannot be shared');
  }
}

async function getGitHubTokenIfConnected(env: Env, userId: string): Promise<string | null> {
  try {
    const oauthToken = await db.getOAuthToken(env.DB, userId, 'github');
    if (!oauthToken) return null;
    return await decryptString(oauthToken.encryptedAccessToken, env.ENCRYPTION_KEY);
  } catch {
    return null;
  }
}

function parseGitHubPullRequestUrl(prUrl: string): { owner: string; repo: string; pullNumber: number } | null {
  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return null;
  const pullNumber = Number.parseInt(match[3], 10);
  if (!Number.isFinite(pullNumber)) return null;
  return {
    owner: match[1],
    repo: match[2],
    pullNumber,
  };
}

function mapGitHubPullRequestState(input: string | undefined, draft: boolean, merged: boolean): 'draft' | 'open' | 'closed' | 'merged' | null {
  if (merged) return 'merged';
  if (input === 'open') return draft ? 'draft' : 'open';
  if (input === 'closed') return 'closed';
  return null;
}

async function enrichChildrenWithRuntimeStatus(
  env: Env,
  children: Awaited<ReturnType<typeof db.getChildSessions>>['children']
): Promise<ChildSummaryWithRuntime[]> {
  return Promise.all(
    children.map(async (child) => {
      if (NON_ACTIVE_TUNNEL_STATUSES.has(child.status)) {
        return child;
      }

      try {
        const childDoId = env.SESSIONS.idFromName(child.id);
        const childDO = env.SESSIONS.get(childDoId);
        const statusRes = await childDO.fetch(new Request('http://do/status'));
        if (!statusRes.ok) return child;

        const statusData = await statusRes.json() as {
          tunnelUrls?: Record<string, string> | null;
          tunnels?: Array<{ name: string; url?: string; path?: string; port?: number; protocol?: string }> | null;
        };

        const tunnels = Array.isArray(statusData.tunnels)
          ? statusData.tunnels.filter((t): t is ChildTunnelSummary => typeof t?.name === 'string')
          : [];

        return {
          ...child,
          gatewayUrl: statusData.tunnelUrls?.gateway ?? undefined,
          tunnels: tunnels.length > 0 ? tunnels : undefined,
        };
      } catch {
        return child;
      }
    })
  );
}

async function refreshOpenChildPullRequestStates(
  env: Env,
  userId: string,
  children: ChildSummaryWithRuntime[],
): Promise<ChildSummaryWithRuntime[]> {
  const githubToken = await getGitHubTokenIfConnected(env, userId);
  if (!githubToken) return children;

  const now = Date.now();

  return Promise.all(
    children.map(async (child) => {
      if (child.prState !== 'open' || typeof child.prNumber !== 'number' || !child.prUrl) {
        return child;
      }

      const parsed = parseGitHubPullRequestUrl(child.prUrl);
      if (!parsed) return child;

      const cacheKey = `${child.id}:${child.prNumber}`;
      const lastCheckedAt = childPrRefreshCache.get(cacheKey);
      if (lastCheckedAt && now - lastCheckedAt < PR_REFRESH_INTERVAL_MS) {
        return child;
      }
      childPrRefreshCache.set(cacheKey, now);

      try {
        const res = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`,
          {
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'Agent-Ops',
            },
          },
        );

        if (!res.ok) {
          return child;
        }

        const pr = await res.json() as {
          state?: string;
          draft?: boolean;
          merged?: boolean;
          html_url?: string;
          title?: string;
        };

        const refreshedState = mapGitHubPullRequestState(pr.state, Boolean(pr.draft), Boolean(pr.merged));
        if (!refreshedState) return child;

        const refreshedUrl = typeof pr.html_url === 'string' ? pr.html_url : child.prUrl;
        const refreshedTitle = typeof pr.title === 'string' ? pr.title : undefined;
        const nextTitle = refreshedTitle ?? child.prTitle;

        if (refreshedState !== child.prState || refreshedUrl !== child.prUrl || (nextTitle && nextTitle !== child.prTitle)) {
          await db.updateSessionGitState(env.DB, child.id, {
            prState: refreshedState,
            prUrl: refreshedUrl,
            ...(nextTitle ? { prTitle: nextTitle } : {}),
          });
        }

        return {
          ...child,
          prState: refreshedState,
          prUrl: refreshedUrl,
          ...(nextTitle ? { prTitle: nextTitle } : {}),
        };
      } catch {
        return child;
      }
    })
  );
}

/**
 * GET /api/sessions
 * List user's sessions
 */
sessionsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { limit, cursor, status, ownership } = c.req.query();

  const result = await db.getUserSessions(c.env.DB, user.id, {
    limit: limit ? parseInt(limit) : undefined,
    cursor,
    status,
    ownership: ownership as db.SessionOwnershipFilter | undefined,
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

  // Check concurrency limits (skip for orchestrator/workflow sessions)
  const isOrchestratorSession = body.parentSessionId?.startsWith('orchestrator:');
  if (!isOrchestratorSession) {
    const concurrency = await db.checkSessionConcurrency(c.env.DB, user.id);
    if (!concurrency.allowed) {
      return c.json(
        { error: concurrency.reason, activeCount: concurrency.activeCount, limit: concurrency.limit },
        429
      );
    }
  }

  // If persona requested, fetch and validate access
  let personaFiles: { filename: string; content: string; sortOrder: number }[] | undefined;
  let personaDefaultModel: string | undefined;
  if (body.personaId) {
    const persona = await db.getPersonaWithFiles(c.env.DB, body.personaId);
    if (!persona) {
      return c.json({ error: 'Persona not found' }, 404);
    }
    // Validate user can see this persona
    if (persona.visibility === 'private' && persona.createdBy !== user.id) {
      return c.json({ error: 'Persona not found' }, 404);
    }
    if (persona.files?.length) {
      personaFiles = persona.files.map((f) => ({
        filename: f.filename,
        content: f.content,
        sortOrder: f.sortOrder,
      }));
    }
    if (persona.defaultModel) {
      personaDefaultModel = persona.defaultModel;
    }
  }

  // Create session record
  const session = await db.createSession(c.env.DB, {
    id: sessionId,
    userId: user.id,
    workspace: body.workspace,
    title: body.title,
    parentSessionId: body.parentSessionId,
    metadata: body.config,
    personaId: body.personaId,
  });

  // Create git state record
  const sourceType = body.sourceType || (body.repoUrl ? 'branch' : 'manual');
  // Extract repo full name from URL if not provided
  let sourceRepoFullName = body.sourceRepoFullName || null;
  if (!sourceRepoFullName && body.repoUrl) {
    const match = body.repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (match) sourceRepoFullName = match[1];
  }

  await db.createSessionGitState(c.env.DB, {
    sessionId,
    sourceType,
    sourcePrNumber: body.sourcePrNumber,
    sourceIssueNumber: body.sourceIssueNumber,
    sourceRepoFullName: sourceRepoFullName || undefined,
    sourceRepoUrl: body.repoUrl,
    branch: body.branch,
    ref: body.ref,
  });

  // Construct WebSocket URL for the DO (used by Runner inside sandbox)
  const wsProtocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
  const host = c.req.header('host') || 'localhost';
  const doWsUrl = `${wsProtocol}://${host}/api/sessions/${sessionId}/ws`;

  // Build environment variables for the sandbox
  const envVars: Record<string, string> = {};

  // LLM key fallback chain: org DB keys → env vars
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
      // DB table may not exist yet — fall through to env var
    }
    if (c.env[envKey]) envVars[envKey] = c.env[envKey]!;
  }

  // User-level credentials (1Password, etc.) — no env var fallback
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

  // If repo URL provided, decrypt GitHub token and add repo/git env vars
  if (body.repoUrl) {
    const oauthToken = await db.getOAuthToken(c.env.DB, user.id, 'github');
    if (!oauthToken) {
      return c.json({ error: 'GitHub account not connected. Sign in with GitHub first.' }, 400);
    }
    const githubToken = await decryptString(oauthToken.encryptedAccessToken, c.env.ENCRYPTION_KEY);

    // Fetch git user info from the users table
    const userRow = await c.env.DB.prepare('SELECT name, email, github_username, git_name, git_email FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ name: string | null; email: string | null; github_username: string | null; git_name: string | null; git_email: string | null }>();

    envVars.GITHUB_TOKEN = githubToken;
    envVars.REPO_URL = body.repoUrl;
    if (body.branch) {
      envVars.REPO_BRANCH = body.branch;
    }
    if (body.ref) {
      envVars.REPO_REF = body.ref;
    }
    envVars.GIT_USER_NAME = userRow?.git_name || userRow?.name || userRow?.github_username || 'Agent Ops User';
    envVars.GIT_USER_EMAIL = userRow?.git_email || userRow?.email || user.email;
  }

  // Fetch user's idle timeout preference
  const userRow = await db.getUserById(c.env.DB, user.id);
  const idleTimeoutSeconds = userRow?.idleTimeoutSeconds ?? 900;
  const idleTimeoutMs = idleTimeoutSeconds * 1000;

  // Initialize SessionAgentDO — it will spawn the sandbox asynchronously
  // so we can return immediately without waiting for the image build.
  const doId = c.env.SESSIONS.idFromName(sessionId);
  const sessionDO = c.env.SESSIONS.get(doId);

  const initialModel = body.initialModel || personaDefaultModel;

  const spawnRequest = {
    sessionId,
    userId: user.id,
    workspace: body.workspace,
    imageType: 'base',
    doWsUrl,
    runnerToken,
    jwtSecret: c.env.ENCRYPTION_KEY,
    idleTimeoutSeconds,
    envVars,
    personaFiles,
  };

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
        hibernateUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'hibernate-session'),
        restoreUrl: c.env.MODAL_BACKEND_URL.replace('{label}', 'restore-session'),
        idleTimeoutMs,
    spawnRequest,
    initialPrompt: body.initialPrompt,
        initialModel,
      }),
    }));
  } catch (err) {
    console.error('Failed to initialize SessionAgentDO:', err);
    await db.updateSessionStatus(c.env.DB, sessionId, 'error', undefined, `Failed to initialize session: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({
      error: 'Failed to initialize session',
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  // Auto-create web channel binding for routing consistency (Phase D)
  try {
    const orgSettings = await c.env.DB.prepare('SELECT id FROM org_settings LIMIT 1').first<{ id: string }>();
    if (orgSettings) {
      await db.createChannelBinding(c.env.DB, {
        id: crypto.randomUUID(),
        sessionId,
        channelType: 'web',
        channelId: sessionId,
        scopeKey: webManualScopeKey(user.id, sessionId),
        userId: user.id,
        orgId: orgSettings.id,
        queueMode: 'followup',
      });
    }
  } catch (err) {
    // Non-fatal — don't block session creation if binding fails
    console.warn('[sessions] Failed to create channel binding:', err);
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
 * GET /api/sessions/available-models
 * Returns the list of available models. Checks the orchestrator DO first,
 * then falls back to D1 cached models from previous discovery.
 */
sessionsRouter.get('/available-models', async (c) => {
  const user = c.get('user');
  const orchestratorId = `orchestrator:${user.id}`;

  try {
    const doId = c.env.SESSIONS.idFromName(orchestratorId);
    const sessionDO = c.env.SESSIONS.get(doId);

    // Try to get models from the live orchestrator DO
    const resp = await sessionDO.fetch(new Request('http://do/models'));
    if (resp.ok) {
      const data = await resp.json() as { models: unknown[] };
      if (data.models && data.models.length > 0) {
        return c.json(data);
      }
    }
  } catch {
    // DO may not exist or be unreachable — fall through to D1 cache
  }

  // Fall back to D1 cached models from previous discovery
  try {
    const row = await c.env.DB.prepare('SELECT discovered_models FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ discovered_models: string | null }>();
    if (row?.discovered_models) {
      const models = JSON.parse(row.discovered_models);
      if (Array.isArray(models) && models.length > 0) {
        return c.json({ models });
      }
    }
  } catch {
    // D1 read failed — return empty
  }

  return c.json({ models: [] });
});

/**
 * POST /api/sessions/join/:token
 * Redeem a share link and join as a participant
 */
sessionsRouter.post('/join/:token', async (c) => {
  const user = c.get('user');
  const { token } = c.req.param();

  const link = await db.getShareLink(c.env.DB, token);
  if (!link) {
    return c.json({ error: 'Invalid, expired, or exhausted share link' }, 400);
  }

  const targetSession = await db.getSession(c.env.DB, link.sessionId);
  if (!targetSession) {
    return c.json({ error: 'Invalid, expired, or exhausted share link' }, 400);
  }
  if (targetSession.isOrchestrator || targetSession.purpose === 'workflow') {
    return c.json({ error: 'This session type cannot be shared' }, 403);
  }

  const result = await db.redeemShareLink(c.env.DB, token, user.id);
  if (!result) {
    return c.json({ error: 'Invalid, expired, or exhausted share link' }, 400);
  }

  return c.json({ sessionId: result.sessionId, role: result.role });
});

/**
 * GET /api/sessions/:id
 * Get session details
 */
sessionsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  // Get live status from DO
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const statusRes = await sessionDO.fetch(new Request('http://do/status'));
  const doStatus = await statusRes.json() as {
    tunnelUrls?: Record<string, string>;
    tunnels?: Array<{ name: string; url?: string; path?: string; port?: number; protocol?: string }>;
    [key: string]: unknown;
  };

  // Populate gatewayUrl from DO status for frontend consumption
  const gatewayUrl = doStatus.tunnelUrls?.gateway;
  const tunnels = doStatus.tunnels ?? null;

  return c.json({
    session: { ...session, gatewayUrl, tunnels },
    doStatus,
  });
});

/**
 * GET /api/sessions/:id/git-state
 * Get the git state for a session
 */
sessionsRouter.get('/:id/git-state', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  const gitState = await db.getSessionGitState(c.env.DB, id);

  return c.json({ gitState });
});

/**
 * GET /api/sessions/:id/sandbox-token
 * Issue a short-lived JWT for direct iframe access to sandbox tunnel URLs.
 * Returns the token + tunnel URLs so the frontend can construct iframe src.
 */
sessionsRouter.get('/:id/sandbox-token', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  // Don't attempt token generation for terminated sessions
  if (session.status === 'terminated' || session.status === 'error') {
    return c.json({ error: 'Session is not running' }, 503);
  }

  // Return special response for hibernated sessions
  if (session.status === 'hibernated' || session.status === 'hibernating' || session.status === 'restoring') {
    return c.json({ status: session.status }, 503);
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
 * GET /api/sessions/:id/tunnels
 * Get tunnel URLs for a running session.
 */
sessionsRouter.get('/:id/tunnels', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const statusRes = await sessionDO.fetch(new Request('http://do/status'));
  const statusData = await statusRes.json() as {
    tunnelUrls?: Record<string, string> | null;
    tunnels?: Array<{ name: string; url?: string; path?: string; port?: number; protocol?: string }> | null;
  };

  return c.json({
    gatewayUrl: statusData.tunnelUrls?.gateway ?? null,
    tunnels: statusData.tunnels ?? [],
  });
});

/**
 * DELETE /api/sessions/:id/tunnels/:name
 * Unregister a sandbox tunnel by name (delegated to the runner).
 */
sessionsRouter.delete('/:id/tunnels/:name', async (c) => {
  const user = c.get('user');
  const { id, name } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'collaborator');

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const resp = await sessionDO.fetch(new Request('http://do/tunnels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'delete',
      name,
      actorId: user.id,
      actorName: user.email,
      actorEmail: user.email,
    }),
  }));

  if (!resp.ok) {
    const errText = await resp.text();
    return c.json({ error: errText || 'Failed to delete tunnel' }, resp.status as 400 | 401 | 403 | 404 | 409 | 422 | 500);
  }

  return c.json({ success: true });
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

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'collaborator');

  if (session.status === 'terminated') {
    throw new ValidationError('Session has been terminated');
  }

  // Save message to D1 for API access (INSERT OR IGNORE deduplicates with DO flush)
  const messageId = crypto.randomUUID();
  await db.saveMessage(c.env.DB, {
    id: messageId,
    sessionId: id,
    role: 'user',
    content: body.content,
    authorId: user.id,
    authorEmail: user.email,
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

  await db.assertSessionAccess(c.env.DB, id, user.id, 'collaborator');

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

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

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
    await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');
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

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

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
 * POST /api/sessions/:id/hibernate
 * Hibernate a running session — snapshots the sandbox and terminates it.
 */
sessionsRouter.post('/:id/hibernate', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'collaborator');

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const res = await sessionDO.fetch(new Request('http://do/hibernate', { method: 'POST' }));
  const result = await res.json() as { status: string; message: string };

  return c.json(result);
});

/**
 * POST /api/sessions/:id/wake
 * Wake a hibernated session — restores the sandbox from snapshot.
 */
sessionsRouter.post('/:id/wake', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'collaborator');

  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  const res = await sessionDO.fetch(new Request('http://do/wake', { method: 'POST' }));
  const result = await res.json() as { status: string; message: string };

  return c.json(result);
});

/**
 * POST /api/sessions/bulk-delete
 * Permanently delete multiple sessions — stops DOs, wipes storage, removes D1 rows.
 */
const bulkDeleteSchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1).max(100),
});

sessionsRouter.post('/bulk-delete', zValidator('json', bulkDeleteSchema), async (c) => {
  const user = c.get('user');
  const { sessionIds } = c.req.valid('json');

  // Validate all sessions belong to the authenticated user
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT id FROM sessions WHERE id IN (${placeholders}) AND user_id = ?`
  )
    .bind(...sessionIds, user.id)
    .all<{ id: string }>();

  const ownedIds = new Set(rows.results.map((r) => r.id));
  const validIds = sessionIds.filter((id) => ownedIds.has(id));

  if (validIds.length === 0) {
    return c.json({ deleted: 0, errors: [] });
  }

  const errors: { sessionId: string; error: string }[] = [];

  // Fan-out: stop each DO, then GC its storage
  const stopResults = await Promise.allSettled(
    validIds.map(async (sessionId) => {
      const doId = c.env.SESSIONS.idFromName(sessionId);
      const sessionDO = c.env.SESSIONS.get(doId);

      try {
        await sessionDO.fetch(new Request('http://do/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'bulk_delete' }),
        }));
      } catch (err) {
        // Stopping may fail if already terminated — continue to GC
      }

      try {
        await sessionDO.fetch(new Request('http://do/gc', { method: 'POST' }));
      } catch (err) {
        errors.push({
          sessionId,
          error: `GC failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })
  );

  // Batch-delete D1 rows
  const deletePlaceholders = validIds.map(() => '?').join(',');
  await c.env.DB.prepare(
    `DELETE FROM sessions WHERE id IN (${deletePlaceholders}) AND user_id = ?`
  )
    .bind(...validIds, user.id)
    .run();

  // Also delete associated messages
  await c.env.DB.prepare(
    `DELETE FROM messages WHERE session_id IN (${deletePlaceholders})`
  )
    .bind(...validIds)
    .run();

  return c.json({ deleted: validIds.length, errors });
});

/**
 * GET /api/sessions/:id/children
 * Get child sessions for a parent session (paginated).
 * Query params: ?limit=20&cursor=...&status=...&hideTerminated=true
 */
sessionsRouter.get('/:id/children', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const { limit, cursor, status, hideTerminated } = c.req.query();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  const excludeStatuses = hideTerminated === 'true' ? ['terminated', 'error'] : undefined;

  const result = await db.getChildSessions(c.env.DB, id, {
    limit: limit ? parseInt(limit) : undefined,
    cursor,
    status,
    excludeStatuses,
  });

  // Only enrich the current page (not all children)
  const enrichedChildren = await enrichChildrenWithRuntimeStatus(c.env, result.children);
  const refreshedChildren = await refreshOpenChildPullRequestStates(c.env, user.id, enrichedChildren);

  return c.json({
    children: refreshedChildren,
    cursor: result.cursor,
    hasMore: result.hasMore,
    totalCount: result.totalCount,
  });
});

/**
 * GET /api/sessions/:id/audit-log
 * Get the audit log for a session (from D1).
 */
sessionsRouter.get('/:id/audit-log', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const { limit, after, eventType } = c.req.query();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  const entries = await db.getSessionAuditLog(c.env.DB, id, {
    limit: limit ? parseInt(limit) : undefined,
    after,
    eventType,
  });
  return c.json({ entries });
});

/**
 * GET /api/sessions/:id/files-changed
 * Get files changed in a session.
 */
sessionsRouter.get('/:id/files-changed', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');

  const files = await db.getSessionFilesChanged(c.env.DB, id);
  return c.json({ files });
});

/**
 * PATCH /api/sessions/:id
 * Update session title.
 */
const updateSessionSchema = z.object({
  title: z.string().max(200),
});

sessionsRouter.patch('/:id', zValidator('json', updateSessionSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const body = c.req.valid('json');

  await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');

  await db.updateSessionTitle(c.env.DB, id, body.title);
  return c.json({ success: true });
});

/**
 * DELETE /api/sessions/:id
 * Terminate a session — stops the DO and terminates the sandbox.
 */
sessionsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');

  // Stop the SessionAgent DO (it handles sandbox termination internally)
  const doId = c.env.SESSIONS.idFromName(id);
  const sessionDO = c.env.SESSIONS.get(doId);

  await sessionDO.fetch(new Request('http://do/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'user_stopped' }),
  }));

  // Update DB status
  await db.updateSessionStatus(c.env.DB, id, 'terminated');

  return c.json({ success: true });
});

// ─── Participant Management Endpoints ─────────────────────────────────────

/**
 * GET /api/sessions/:id/participants
 * List participants for a session (viewer+)
 */
sessionsRouter.get('/:id/participants', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'viewer');
  assertSessionShareable(session);

  const participants = await db.getSessionParticipants(c.env.DB, id);

  // Include the owner as a virtual participant
  const ownerUser = await db.getUserById(c.env.DB, session.userId);
  const allParticipants = [
    {
      id: `owner:${session.userId}`,
      sessionId: id,
      userId: session.userId,
      role: 'owner' as const,
      createdAt: session.createdAt,
      userName: ownerUser?.name,
      userEmail: ownerUser?.email,
      userAvatarUrl: ownerUser?.avatarUrl,
    },
    ...participants.filter((p) => p.userId !== session.userId),
  ];

  return c.json({ participants: allParticipants });
});

const addParticipantSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['collaborator', 'viewer']).default('collaborator'),
}).refine((d) => d.userId || d.email, { message: 'userId or email required' });

/**
 * POST /api/sessions/:id/participants
 * Add a participant to a session (owner only)
 */
sessionsRouter.post('/:id/participants', zValidator('json', addParticipantSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const body = c.req.valid('json');

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');
  assertSessionShareable(session);

  let targetUserId = body.userId;
  if (!targetUserId && body.email) {
    const targetUser = await db.findUserByEmail(c.env.DB, body.email);
    if (!targetUser) {
      throw new NotFoundError('User', body.email);
    }
    targetUserId = targetUser.id;
  }

  await db.addSessionParticipant(c.env.DB, id, targetUserId!, body.role, user.id);

  return c.json({ success: true });
});

/**
 * DELETE /api/sessions/:id/participants/:userId
 * Remove a participant from a session (owner only)
 */
sessionsRouter.delete('/:id/participants/:userId', async (c) => {
  const user = c.get('user');
  const { id, userId: targetUserId } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');
  assertSessionShareable(session);

  await db.removeSessionParticipant(c.env.DB, id, targetUserId);

  return c.json({ success: true });
});

// ─── Share Link Endpoints ─────────────────────────────────────────────────

const createShareLinkSchema = z.object({
  role: z.enum(['collaborator', 'viewer']).default('collaborator'),
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().positive().optional(),
});

/**
 * POST /api/sessions/:id/share-link
 * Create a share link for a session (owner only)
 */
sessionsRouter.post('/:id/share-link', zValidator('json', createShareLinkSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();
  const body = c.req.valid('json');

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');
  assertSessionShareable(session);

  const link = await db.createShareLink(c.env.DB, id, body.role, user.id, body.expiresAt, body.maxUses);

  return c.json({ shareLink: link }, 201);
});

/**
 * GET /api/sessions/:id/share-links
 * List share links for a session (owner only)
 */
sessionsRouter.get('/:id/share-links', async (c) => {
  const user = c.get('user');
  const { id } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');
  assertSessionShareable(session);

  const links = await db.getSessionShareLinks(c.env.DB, id);

  return c.json({ shareLinks: links });
});

/**
 * DELETE /api/sessions/:id/share-link/:linkId
 * Revoke a share link (owner only)
 */
sessionsRouter.delete('/:id/share-link/:linkId', async (c) => {
  const user = c.get('user');
  const { id, linkId } = c.req.param();

  const session = await db.assertSessionAccess(c.env.DB, id, user.id, 'owner');
  assertSessionShareable(session);

  await db.deactivateShareLink(c.env.DB, linkId);

  return c.json({ success: true });
});
