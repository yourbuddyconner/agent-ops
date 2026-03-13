import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import { repoProviderRegistry } from '../repos/registry.js';
import { storeCredential } from '../services/credentials.js';
import { getDb } from '../lib/drizzle.js';
import * as credentialDb from '../lib/db/credentials.js';

export const repoProviderRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// List available repo providers
repoProviderRouter.get('/', async (c) => {
  const providers = repoProviderRegistry.list();
  return c.json(providers.map(p => ({
    id: p.id,
    displayName: p.displayName,
    icon: p.icon,
    supportsOrgLevel: p.supportsOrgLevel,
    supportsPersonalLevel: p.supportsPersonalLevel,
  })));
});

// Get GitHub App installation URL (org or personal)
repoProviderRouter.get('/:provider/install', async (c) => {
  const providerId = c.req.param('provider');
  const level = c.req.query('level') || 'personal';
  const user = c.get('user');

  if (providerId !== 'github') {
    return c.json({ error: 'Only GitHub App installation is supported' }, 400);
  }

  const appSlug = c.env.GITHUB_APP_SLUG;
  if (!appSlug) {
    return c.json({ error: 'GitHub App not configured' }, 500);
  }

  // State is a signed JWT to prevent forgery
  const now = Math.floor(Date.now() / 1000);
  const state = await signJWT(
    { sub: user.id, sid: level, iat: now, exp: now + 10 * 60 } as any,
    c.env.ENCRYPTION_KEY,
  );
  const installUrl = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  return c.json({ url: installUrl });
});

// List installations for a repo provider
repoProviderRouter.get('/:provider/installations', async (c) => {
  const providerId = c.req.param('provider');
  const user = c.get('user');
  const db = getDb(c.env.DB);

  // Get user-level installations
  const userCreds = await credentialDb.listCredentialsByOwner(db, 'user', user.id);
  const userInstalls = userCreds.filter(cred => cred.provider === providerId && cred.credentialType === 'app_install');

  // TODO: Get org-level installations (needs orgId from user context)

  return c.json({
    installations: [
      ...userInstalls.map(i => ({
        level: 'personal',
        provider: i.provider,
        createdAt: i.createdAt,
      })),
    ],
  });
});

/**
 * GitHub App installation callback — mounted outside /api/* (no auth middleware).
 * User identity is derived from the signed state JWT, not session auth.
 */
export const repoProviderCallbackRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

repoProviderCallbackRouter.get('/:provider/install/callback', async (c) => {
  const providerId = c.req.param('provider');
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');
  const stateParam = c.req.query('state');
  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';

  // Only GitHub App installations are supported — reject other provider IDs
  // to prevent storing GitHub App credentials under arbitrary provider names
  if (providerId !== 'github') {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=unsupported_provider`);
  }

  if (!installationId || !stateParam) {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=missing_params`);
  }

  // Verify signed state JWT — this is how we identify the user without session auth
  const payload = await verifyJWT(stateParam, c.env.ENCRYPTION_KEY);
  if (!payload || !payload.sub) {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=invalid_state`);
  }
  const userId = payload.sub as string;
  const level = (payload as any).sid || 'personal';

  // Only support personal-level installations until real orgId wiring is available
  const ownerType = 'user' as const;
  const ownerId = userId;
  if (level === 'org') {
    console.warn('[repo-providers] Org-level install requested but not yet supported, storing as user-level');
  }

  // Validate required env vars before storing
  if (!c.env.GITHUB_APP_ID || !c.env.GITHUB_APP_PRIVATE_KEY) {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=app_not_configured`);
  }

  // Store the installation credential
  const metadata: Record<string, string> = { installationId };

  if (setupAction === 'install') {
    await storeCredential(c.env, ownerType, ownerId, providerId, {
      installation_id: installationId,
      app_id: c.env.GITHUB_APP_ID,
      private_key: c.env.GITHUB_APP_PRIVATE_KEY,
    }, {
      credentialType: 'app_install',
      metadata,
    });
  }

  return c.redirect(`${frontendUrl}/settings?tab=repositories&installed=true`);
});
