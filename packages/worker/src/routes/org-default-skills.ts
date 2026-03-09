import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { getOrgDefaultSkills, setOrgDefaultSkills } from '../lib/db.js';

export const orgDefaultSkillsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  await setOrgDefaultSkills(db, 'default', body.skillIds);
  return c.json({ updated: true });
});
