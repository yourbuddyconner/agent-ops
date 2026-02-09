import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { adminMiddleware } from '../middleware/admin.js';
import { ValidationError } from '@agent-ops/shared';
import {
  getOrgSettings,
  updateOrgSettings,
  listOrgApiKeys,
  setOrgApiKey,
  deleteOrgApiKey,
  listInvites,
  createInvite,
  deleteInvite,
  getInviteByCodeAny,
  listUsers,
  updateUserRole,
  deleteUser,
} from '../lib/db.js';

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

const VALID_PROVIDERS = ['anthropic', 'openai', 'google'] as const;

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

  const encryptedKey = await encryptApiKey(key, c.env.ENCRYPTION_KEY);
  const user = c.get('user');

  await setOrgApiKey(c.env.DB, {
    id: crypto.randomUUID(),
    provider,
    encryptedKey,
    setBy: user.id,
  });

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

  // Generate a random 12-char alphanumeric code
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);

  const user = c.get('user');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const invite = await createInvite(c.env.DB, {
    id: crypto.randomUUID(),
    code,
    email: email?.trim().toLowerCase(),
    role: role || 'member',
    invitedBy: user.id,
    expiresAt,
  });

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

  // Prevent demoting last admin
  if (role === 'member') {
    const users = await listUsers(c.env.DB);
    const adminCount = users.filter((u) => u.role === 'admin').length;
    const targetUser = users.find((u) => u.id === userId);
    if (targetUser?.role === 'admin' && adminCount <= 1) {
      throw new ValidationError('Cannot demote the last admin');
    }
  }

  await updateUserRole(c.env.DB, userId, role);
  return c.json({ ok: true });
});

adminRouter.delete('/users/:id', async (c) => {
  const userId = c.req.param('id');
  const currentUser = c.get('user');

  if (userId === currentUser.id) {
    throw new ValidationError('Cannot delete yourself');
  }

  const users = await listUsers(c.env.DB);
  const targetUser = users.find((u) => u.id === userId);
  if (targetUser?.role === 'admin') {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      throw new ValidationError('Cannot delete the last admin');
    }
  }

  await deleteUser(c.env.DB, userId);
  return c.json({ ok: true });
});

// --- Encryption helpers ---

export async function encryptApiKey(key: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret).slice(0, 32), 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyMaterial, enc.encode(key));
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptApiKey(encrypted: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret).slice(0, 32), 'AES-GCM', false, [
    'decrypt',
  ]);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyMaterial, ciphertext);
  return new TextDecoder().decode(plaintext);
}
