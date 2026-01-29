import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/auth/me
 * Returns the authenticated user's information and connected providers
 */
authRouter.get('/me', async (c) => {
  const user = c.get('user');

  const hasGitHub = await db.hasOAuthProvider(c.env.DB, user.id, 'github');
  const hasGoogle = await db.hasOAuthProvider(c.env.DB, user.id, 'google');

  return c.json({
    user,
    providers: {
      github: hasGitHub,
      google: hasGoogle,
    },
  });
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
