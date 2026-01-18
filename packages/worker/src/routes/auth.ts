import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/auth/me
 * Returns the authenticated user's information
 */
authRouter.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user });
});
