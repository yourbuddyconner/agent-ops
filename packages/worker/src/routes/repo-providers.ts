import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
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
  const level = c.req.query('level') || 'org'; // 'org' or 'personal'
  const user = c.get('user');

  if (providerId !== 'github') {
    return c.json({ error: 'Only GitHub App installation is supported' }, 400);
  }

  const appSlug = c.env.GITHUB_APP_SLUG;
  if (!appSlug) {
    return c.json({ error: 'GitHub App not configured' }, 500);
  }

  // State encodes the level and user info for the callback
  const state = btoa(JSON.stringify({ level, userId: user.id }));
  const installUrl = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  return c.json({ url: installUrl });
});

// GitHub App installation callback
repoProviderRouter.get('/:provider/install/callback', async (c) => {
  const providerId = c.req.param('provider');
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');
  const stateParam = c.req.query('state');
  const user = c.get('user');

  if (!installationId) {
    return c.json({ error: 'Missing installation_id' }, 400);
  }

  let level = 'personal';
  if (stateParam) {
    try {
      const state = JSON.parse(atob(stateParam));
      level = state.level || 'personal';
    } catch {
      // ignore malformed state
    }
  }

  // Determine owner type and ID
  // TODO: support org-level installations once orgId is available in user context
  const ownerType = level === 'org' ? 'org' : 'user';
  const ownerId = user.id;

  // Store the installation credential
  const metadata: Record<string, string> = {
    installationId,
    appId: c.env.GITHUB_APP_ID || '',
    privateKey: c.env.GITHUB_APP_PRIVATE_KEY || '',
  };

  if (setupAction === 'install') {
    await storeCredential(c.env, ownerType, ownerId, providerId, {
      installation_id: installationId,
    }, {
      credentialType: 'app_install',
      metadata,
    });
  }

  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';
  return c.redirect(`${frontendUrl}/settings?tab=repositories&installed=true`);
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
