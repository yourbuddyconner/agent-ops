import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { ValidationError } from '@agent-ops/shared';

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/auth/me
 * Returns the authenticated user's information and connected providers
 */
authRouter.get('/me', async (c) => {
  const authUser = c.get('user');

  const [fullUser, hasGitHub, hasGoogle, orgSettings] = await Promise.all([
    db.getUserById(c.env.DB, authUser.id),
    db.hasOAuthProvider(c.env.DB, authUser.id, 'github'),
    db.hasOAuthProvider(c.env.DB, authUser.id, 'google'),
    db.getOrgSettings(c.env.DB),
  ]);

  return c.json({
    user: fullUser ?? authUser,
    providers: {
      github: hasGitHub,
      google: hasGoogle,
    },
    orgModelPreferences: orgSettings.modelPreferences,
  });
});

const updateProfileSchema = z.object({
  name: z.string().max(255).optional(),
  gitName: z.string().max(255).optional(),
  gitEmail: z.string().email().max(255).optional(),
  onboardingCompleted: z.boolean().optional(),
  idleTimeoutSeconds: z.number().int().min(300).max(3600).optional(),
  modelPreferences: z.array(z.string().max(255)).max(20).optional(),
});

/**
 * PATCH /api/auth/me
 * Update the authenticated user's profile (git config, etc.)
 */
authRouter.patch('/me', async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();

  const result = updateProfileSchema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid input');
  }

  const updated = await db.updateUserProfile(c.env.DB, authUser.id, result.data);

  return c.json({ user: updated });
});

/**
 * POST /api/auth/logout
 * Invalidate the current session token
 */
authRouter.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    await db.deleteAuthSession(c.env.DB, tokenHash);
  }

  return c.json({ success: true });
});
