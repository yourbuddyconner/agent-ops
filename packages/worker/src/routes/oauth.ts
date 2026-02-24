import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import * as oauthService from '../services/oauth.js';

export const oauthRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createStateJWT(env: Env, provider: string, inviteCode?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: any = { sub: provider, sid: crypto.randomUUID(), iat: now, exp: now + 5 * 60 };
  if (inviteCode) {
    payload.invite_code = inviteCode;
  }
  return signJWT(payload, env.ENCRYPTION_KEY);
}

async function parseStateJWT(state: string, env: Env): Promise<{ valid: boolean; inviteCode?: string }> {
  const payload = await verifyJWT(state, env.ENCRYPTION_KEY);
  if (!payload) return { valid: false };
  return { valid: true, inviteCode: (payload as any).invite_code };
}

function getFrontendUrl(env: Env): string {
  return env.FRONTEND_URL || 'http://localhost:5173';
}

function getWorkerUrl(env: Env, req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────

/**
 * GET /auth/github — Redirect to GitHub OAuth
 */
oauthRouter.get('/github', async (c) => {
  const inviteCode = c.req.query('invite_code');
  const state = await createStateJWT(c.env, 'github', inviteCode);
  const workerUrl = getWorkerUrl(c.env, c.req.raw);

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${workerUrl}/auth/github/callback`,
    scope: 'repo read:user user:email',
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

/**
 * GET /auth/github/callback — Exchange code for token, find/create user, issue session
 */
oauthRouter.get('/github/callback', async (c) => {
  const frontendUrl = getFrontendUrl(c.env);
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${frontendUrl}/login?error=missing_params`);
  }

  const stateResult = await parseStateJWT(state, c.env);
  if (!stateResult.valid) {
    return c.redirect(`${frontendUrl}/login?error=invalid_state`);
  }

  try {
    const workerUrl = getWorkerUrl(c.env, c.req.raw);
    const result = await oauthService.handleGitHubCallback(c.env, {
      code,
      inviteCode: stateResult.inviteCode,
      workerUrl,
    });

    if (!result.ok) {
      return c.redirect(`${frontendUrl}/login?error=${result.error}`);
    }

    return c.redirect(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(result.sessionToken)}&provider=github`
    );
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    return c.redirect(`${frontendUrl}/login?error=oauth_error`);
  }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

/**
 * GET /auth/google — Redirect to Google OAuth
 */
oauthRouter.get('/google', async (c) => {
  const inviteCode = c.req.query('invite_code');
  const state = await createStateJWT(c.env, 'google', inviteCode);
  const workerUrl = getWorkerUrl(c.env, c.req.raw);

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${workerUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/**
 * GET /auth/google/callback — Exchange code for token, find/create user, issue session
 */
oauthRouter.get('/google/callback', async (c) => {
  const frontendUrl = getFrontendUrl(c.env);
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${frontendUrl}/login?error=missing_params`);
  }

  const stateResult = await parseStateJWT(state, c.env);
  if (!stateResult.valid) {
    return c.redirect(`${frontendUrl}/login?error=invalid_state`);
  }

  try {
    const workerUrl = getWorkerUrl(c.env, c.req.raw);
    const result = await oauthService.handleGoogleCallback(c.env, {
      code,
      inviteCode: stateResult.inviteCode,
      workerUrl,
    });

    if (!result.ok) {
      return c.redirect(`${frontendUrl}/login?error=${result.error}`);
    }

    return c.redirect(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(result.sessionToken)}&provider=google`
    );
  } catch (err) {
    console.error('Google OAuth error:', err);
    return c.redirect(`${frontendUrl}/login?error=oauth_error`);
  }
});
