import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { adminMiddleware } from '../middleware/admin.js';
import { ValidationError } from '@valet/shared';
import { getOrgDefaultSkills, setOrgDefaultSkills } from '../lib/db.js';

export const orgDefaultSkillsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// All org default skill routes require admin role
orgDefaultSkillsRouter.use('*', adminMiddleware);

// GET / — list org default skills
orgDefaultSkillsRouter.get('/', async (c) => {
  const db = c.get('db');
  const skills = await getOrgDefaultSkills(db, 'default');
  return c.json({ skills });
});

// PUT / — replace org default skills
orgDefaultSkillsRouter.put('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{ skillIds: string[] }>();

  if (!Array.isArray(body.skillIds)) {
    throw new ValidationError('skillIds must be an array');
  }

  await setOrgDefaultSkills(db, 'default', body.skillIds);
  return c.json({ updated: true });
});
