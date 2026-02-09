import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import { encryptString } from '../lib/crypto.js';
import * as db from '../lib/db.js';

export const oauthRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

async function isEmailAllowed(env: Env, email: string, inviteCode?: string): Promise<boolean> {
  const emailLower = email.toLowerCase();

  // If a valid invite code is provided, always allow
  if (inviteCode) {
    try {
      const invite = await env.DB.prepare(
        "SELECT 1 FROM invites WHERE code = ? AND accepted_at IS NULL AND expires_at > datetime('now')"
      ).bind(inviteCode).first();
      if (invite) return true;
    } catch {
      // Fall through
    }
  }

  try {
    const orgSettings = await env.DB.prepare("SELECT * FROM org_settings WHERE id = 'default'").first<{
      domain_gating_enabled: number;
      allowed_email_domain: string | null;
      email_allowlist_enabled: number;
      allowed_emails: string | null;
    }>();

    if (orgSettings) {
      const domainGating = !!orgSettings.domain_gating_enabled;
      const emailAllowlist = !!orgSettings.email_allowlist_enabled;

      if (domainGating && orgSettings.allowed_email_domain) {
        const domain = emailLower.split('@')[1];
        if (domain === orgSettings.allowed_email_domain.toLowerCase()) return true;
        if (emailAllowlist) {
          // Check allowlist too if both are enabled
        } else {
          return false;
        }
      }

      if (emailAllowlist && orgSettings.allowed_emails) {
        const allowed = orgSettings.allowed_emails.split(',').map(e => e.trim().toLowerCase());
        if (allowed.includes(emailLower)) return true;
        if (domainGating) return false; // Already checked domain above
        return false;
      }

      if (domainGating || emailAllowlist) {
        return false; // A gating method is enabled but email didn't pass
      }
    }

    // Check for a valid invite by email
    const invite = await env.DB.prepare(
      "SELECT 1 FROM invites WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime('now')"
    ).bind(emailLower).first();
    if (invite) return true;

  } catch {
    // DB not available or table doesn't exist yet — fall through to env var
  }

  // Backward compat: env var fallback
  const allowed = env.ALLOWED_EMAILS;
  if (!allowed) return true;
  return allowed.split(',').map(e => e.trim().toLowerCase()).includes(emailLower);
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

  // Validate CSRF state and extract invite_code
  const stateResult = await parseStateJWT(state, c.env);
  if (!stateResult.valid) {
    return c.redirect(`${frontendUrl}/login?error=invalid_state`);
  }
  const inviteCode = stateResult.inviteCode;

  try {
    const workerUrl = getWorkerUrl(c.env, c.req.raw);

    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${workerUrl}/auth/github/callback`,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
      scope?: string;
    };

    if (!tokenData.access_token) {
      console.error('GitHub token exchange failed:', tokenData.error);
      return c.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    // Fetch GitHub user profile
    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Agent-Ops',
      },
    });

    if (!profileRes.ok) {
      return c.redirect(`${frontendUrl}/login?error=github_profile_failed`);
    }

    const profile = (await profileRes.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    };

    // If email is null (private), fetch from /user/emails
    let email = profile.email;
    let primaryVisibility: 'public' | 'private' | null | undefined;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Agent-Ops',
        },
      });

      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
          visibility?: 'public' | 'private' | null;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        const fallback = emails.find((e) => e.verified);
        primaryVisibility = primary?.visibility ?? fallback?.visibility;
        email = primary?.email || fallback?.email || null;
      }
    }

    if (!email) {
      return c.redirect(`${frontendUrl}/login?error=no_email`);
    }

    if (!(await isEmailAllowed(c.env, email, inviteCode))) {
      return c.redirect(`${frontendUrl}/login?error=not_allowed`);
    }

    const githubId = String(profile.id);

    // Find user by github_id, then by email, or create new
    let user = await db.findUserByGitHubId(c.env.DB, githubId);
    let isNewUser = false;

    if (!user) {
      user = await db.findUserByEmail(c.env.DB, email);
    }

    if (!user) {
      // Create new user
      user = await db.getOrCreateUser(c.env.DB, {
        id: crypto.randomUUID(),
        email,
        name: profile.name || profile.login,
        avatarUrl: profile.avatar_url,
      });
      isNewUser = true;

      // First-user-admin: if this is the only user, promote to admin
      const userCount = await db.getUserCount(c.env.DB);
      if (userCount === 1) {
        await db.updateUserRole(c.env.DB, user.id, 'admin');
      }
    }

    // Accept invite by code (if provided), or fall back to email-based invite
    if (inviteCode) {
      const invite = await db.getInviteByCode(c.env.DB, inviteCode);
      if (invite) {
        await db.markInviteAccepted(c.env.DB, invite.id, user.id);
        await db.updateUserRole(c.env.DB, user.id, invite.role);
      }
    } else if (isNewUser) {
      const invite = await db.getInviteByEmail(c.env.DB, email);
      if (invite) {
        await db.markInviteAccepted(c.env.DB, invite.id, user.id);
        await db.updateUserRole(c.env.DB, user.id, invite.role);
      }
    }

    // Update GitHub-specific fields
    await db.updateUserGitHub(c.env.DB, user.id, {
      githubId,
      githubUsername: profile.login,
      name: profile.name || undefined,
      avatarUrl: profile.avatar_url,
    });

    // Auto-populate git config if not already set (or still using a private email)
    const shouldUseNoReply = profile.email === null || (primaryVisibility && primaryVisibility !== 'public');
    const inferredGitName = profile.name || profile.login;
    const inferredGitEmail = shouldUseNoReply
      ? `${profile.id}+${profile.login}@users.noreply.github.com`
      : email;
    const shouldUpdateGitName = !user.gitName;
    const shouldUpdateGitEmail = !user.gitEmail
      || (shouldUseNoReply && (user.gitEmail === user.email || user.gitEmail === email));
    if (shouldUpdateGitName || shouldUpdateGitEmail) {
      await db.updateUserProfile(c.env.DB, user.id, {
        gitName: shouldUpdateGitName ? inferredGitName : user.gitName,
        gitEmail: shouldUpdateGitEmail ? inferredGitEmail : user.gitEmail,
      });
    }

    // Encrypt and store OAuth token
    const encryptedToken = await encryptString(tokenData.access_token, c.env.ENCRYPTION_KEY);
    await db.upsertOAuthToken(c.env.DB, {
      id: crypto.randomUUID(),
      userId: user.id,
      provider: 'github',
      encryptedAccessToken: encryptedToken,
      scopes: tokenData.scope || 'repo read:user user:email',
    });

    // Generate session token
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.createAuthSession(c.env.DB, {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      provider: 'github',
      expiresAt,
    });

    // Redirect to frontend callback with token
    return c.redirect(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(sessionToken)}&provider=github`
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
  const inviteCode = stateResult.inviteCode;

  try {
    const workerUrl = getWorkerUrl(c.env, c.req.raw);

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${workerUrl}/auth/google/callback`,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!tokenData.id_token) {
      console.error('Google token exchange failed:', tokenData.error);
      return c.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    // Decode id_token JWT (we trust Google's signature since we just got it from their endpoint)
    const idTokenParts = tokenData.id_token.split('.');
    const payload = JSON.parse(atob(idTokenParts[1])) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
      picture?: string;
    };

    if (!payload.email || !payload.email_verified) {
      return c.redirect(`${frontendUrl}/login?error=email_not_verified`);
    }

    if (!(await isEmailAllowed(c.env, payload.email, inviteCode))) {
      return c.redirect(`${frontendUrl}/login?error=not_allowed`);
    }

    // Find user by email or create new
    let user = await db.findUserByEmail(c.env.DB, payload.email);
    let isNewUser = false;

    if (!user) {
      user = await db.getOrCreateUser(c.env.DB, {
        id: crypto.randomUUID(),
        email: payload.email,
        name: payload.name,
        avatarUrl: payload.picture,
      });
      isNewUser = true;

      // First-user-admin: if this is the only user, promote to admin
      const userCount = await db.getUserCount(c.env.DB);
      if (userCount === 1) {
        await db.updateUserRole(c.env.DB, user.id, 'admin');
      }
    }

    // Accept invite by code (if provided), or fall back to email-based invite
    if (inviteCode) {
      const invite = await db.getInviteByCode(c.env.DB, inviteCode);
      if (invite) {
        await db.markInviteAccepted(c.env.DB, invite.id, user.id);
        await db.updateUserRole(c.env.DB, user.id, invite.role);
      }
    } else if (isNewUser) {
      const invite = await db.getInviteByEmail(c.env.DB, payload.email);
      if (invite) {
        await db.markInviteAccepted(c.env.DB, invite.id, user.id);
        await db.updateUserRole(c.env.DB, user.id, invite.role);
      }
    }

    // Auto-populate git config if not already set
    if (!user.gitName || !user.gitEmail) {
      await db.updateUserProfile(c.env.DB, user.id, {
        gitName: user.gitName || payload.name || undefined,
        gitEmail: user.gitEmail || payload.email || undefined,
      });
    }

    // Encrypt and store Google OAuth tokens
    if (tokenData.access_token) {
      const encryptedAccessToken = await encryptString(tokenData.access_token, c.env.ENCRYPTION_KEY);
      const encryptedRefreshToken = tokenData.refresh_token
        ? await encryptString(tokenData.refresh_token, c.env.ENCRYPTION_KEY)
        : undefined;

      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined;

      await db.upsertOAuthToken(c.env.DB, {
        id: crypto.randomUUID(),
        userId: user.id,
        provider: 'google',
        encryptedAccessToken,
        encryptedRefreshToken,
        scopes: 'openid email profile',
        expiresAt,
      });
    }

    // Generate session token
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.createAuthSession(c.env.DB, {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      provider: 'google',
      expiresAt,
    });

    return c.redirect(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(sessionToken)}&provider=google`
    );
  } catch (err) {
    console.error('Google OAuth error:', err);
    return c.redirect(`${frontendUrl}/login?error=oauth_error`);
  }
});
