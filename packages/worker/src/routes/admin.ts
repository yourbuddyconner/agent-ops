import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { adminMiddleware } from '../middleware/admin.js';
import { ValidationError } from '@agent-ops/shared';
import {
  getOrgSettings,
  updateOrgSettings,
  listOrgApiKeys,
  deleteOrgApiKey,
  listInvites,
  deleteInvite,
  getInviteByCodeAny,
  listUsers,
  listCustomProviders,
  deleteCustomProvider,
} from '../lib/db.js';
import * as adminService from '../services/admin.js';

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// All admin routes require admin role
adminRouter.use('*', adminMiddleware);

// --- Org Settings ---

adminRouter.get('/', async (c) => {
  const settings = await getOrgSettings(c.env.DB);
  return c.json(settings);
});

adminRouter.put('/', async (c) => {
  const body = await c.req.json<{
    name?: string;
    allowedEmailDomain?: string;
    allowedEmails?: string;
    domainGatingEnabled?: boolean;
    emailAllowlistEnabled?: boolean;
    modelPreferences?: string[];
  }>();

  if (body.modelPreferences !== undefined) {
    if (!Array.isArray(body.modelPreferences)) {
      throw new ValidationError('modelPreferences must be an array of strings');
    }
    if (body.modelPreferences.length > 20) {
      throw new ValidationError('modelPreferences cannot exceed 20 items');
    }
    if (!body.modelPreferences.every((m) => typeof m === 'string' && m.length <= 255)) {
      throw new ValidationError('Each model preference must be a string (max 255 chars)');
    }
  }

  const settings = await updateOrgSettings(c.env.DB, body);
  return c.json(settings);
});

// --- LLM API Keys ---

const VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'parallel'] as const;

adminRouter.get('/llm-keys', async (c) => {
  const keys = await listOrgApiKeys(c.env.DB);
  return c.json(keys);
});

adminRouter.put('/llm-keys/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!VALID_PROVIDERS.includes(provider as any)) {
    throw new ValidationError(`Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  const { key } = await c.req.json<{ key: string }>();
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new ValidationError('API key is required');
  }

  const user = c.get('user');
  await adminService.setOrgLlmKey(c.env.DB, c.env.ENCRYPTION_KEY, { provider, key, setBy: user.id });

  return c.json({ ok: true });
});

adminRouter.delete('/llm-keys/:provider', async (c) => {
  const provider = c.req.param('provider');
  await deleteOrgApiKey(c.env.DB, provider);
  return c.json({ ok: true });
});

// --- Invites ---

adminRouter.get('/invites', async (c) => {
  const invites = await listInvites(c.env.DB);
  return c.json(invites);
});

adminRouter.post('/invites', async (c) => {
  const { email, role } = await c.req.json<{ email?: string; role?: 'admin' | 'member' }>();
  const user = c.get('user');

  const invite = await adminService.createInvite(c.env.DB, { email, role, invitedBy: user.id });
  return c.json(invite, 201);
});

adminRouter.delete('/invites/:id', async (c) => {
  const id = c.req.param('id');
  await deleteInvite(c.env.DB, id);
  return c.json({ ok: true });
});

// --- Users ---

adminRouter.get('/users', async (c) => {
  const users = await listUsers(c.env.DB);
  return c.json(users);
});

adminRouter.patch('/users/:id', async (c) => {
  const userId = c.req.param('id');
  const { role } = await c.req.json<{ role: 'admin' | 'member' }>();

  if (!role || !['admin', 'member'].includes(role)) {
    throw new ValidationError('Valid role is required (admin or member)');
  }

  const result = await adminService.updateUserRoleSafe(c.env.DB, userId, role);
  if (!result.ok) {
    throw new ValidationError('Cannot demote the last admin');
  }

  return c.json({ ok: true });
});

adminRouter.delete('/users/:id', async (c) => {
  const userId = c.req.param('id');
  const currentUser = c.get('user');

  const result = await adminService.deleteUserSafe(c.env.DB, userId, currentUser.id);
  if (!result.ok) {
    if (result.error === 'self_delete') {
      throw new ValidationError('Cannot delete yourself');
    }
    if (result.error === 'last_admin') {
      throw new ValidationError('Cannot delete the last admin');
    }
  }

  return c.json({ ok: true });
});

// --- Custom Providers ---

const BUILT_IN_PROVIDER_IDS = ['anthropic', 'openai', 'google', 'parallel'];
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

adminRouter.get('/custom-providers', async (c) => {
  const providers = await listCustomProviders(c.env.DB);
  return c.json(providers);
});

adminRouter.put('/custom-providers/:providerId', async (c) => {
  const providerId = c.req.param('providerId');

  // Validate provider ID format
  if (!providerId || providerId.length > 50 || !PROVIDER_ID_REGEX.test(providerId)) {
    throw new ValidationError('Provider ID must be 1-50 characters, lowercase alphanumeric with hyphens');
  }

  // Prevent collision with built-in providers
  if (BUILT_IN_PROVIDER_IDS.includes(providerId)) {
    throw new ValidationError(`Provider ID "${providerId}" is reserved for a built-in provider`);
  }

  const body = await c.req.json<{
    displayName: string;
    baseUrl: string;
    apiKey?: string;
    models: Array<{ id: string; name?: string; contextLimit?: number; outputLimit?: number }>;
  }>();

  if (!body.displayName || typeof body.displayName !== 'string' || body.displayName.trim().length === 0) {
    throw new ValidationError('Display name is required');
  }
  if (!body.baseUrl || typeof body.baseUrl !== 'string' || body.baseUrl.trim().length === 0) {
    throw new ValidationError('Base URL is required');
  }
  if (!Array.isArray(body.models) || body.models.length === 0) {
    throw new ValidationError('At least one model is required');
  }
  for (const model of body.models) {
    if (!model.id || typeof model.id !== 'string' || model.id.trim().length === 0) {
      throw new ValidationError('Each model must have an id');
    }
  }

  const user = c.get('user');
  await adminService.upsertCustomProviderWithEncryption(c.env.DB, c.env.ENCRYPTION_KEY, {
    providerId,
    displayName: body.displayName.trim(),
    baseUrl: body.baseUrl.trim(),
    apiKey: body.apiKey,
    models: JSON.stringify(body.models),
    setBy: user.id,
  });

  return c.json({ ok: true });
});

adminRouter.delete('/custom-providers/:providerId', async (c) => {
  const providerId = c.req.param('providerId');
  await deleteCustomProvider(c.env.DB, providerId);
  return c.json({ ok: true });
});
