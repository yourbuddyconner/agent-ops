# Managed Skills System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified skill management system with D1 storage, FTS search, persona attachment, org defaults, and agent CRUD tools.

**Architecture:** New `skills` table replaces skill rows in `org_plugin_artifacts`. Plugin sync writes to this table. SessionAgentDO resolves skills from persona attachments or org defaults. Five new OpenCode tools expose search/CRUD to agents. Existing action policy system governs risk.

**Tech Stack:** D1 (SQLite via Drizzle), FTS5, Hono routes, OpenCode plugin tools, TypeScript

---

### Task 1: D1 Migration — Skills Tables

**Files:**
- Create: `packages/worker/migrations/0062_managed_skills.sql`

**Step 1: Write the migration SQL**

```sql
-- Unified skills table (replaces skill rows in org_plugin_artifacts)
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  owner_id TEXT,
  source TEXT NOT NULL DEFAULT 'managed',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Builtin/plugin skills: unique per org + slug
CREATE UNIQUE INDEX idx_skills_org_slug ON skills(org_id, slug) WHERE source IN ('builtin', 'plugin');

-- Managed skills: unique per org + owner + slug
CREATE UNIQUE INDEX idx_skills_org_owner_slug ON skills(org_id, owner_id, slug) WHERE source = 'managed';

-- Lookup by org + status for delivery
CREATE INDEX idx_skills_org_status ON skills(org_id, status);

-- Lookup by owner
CREATE INDEX idx_skills_owner ON skills(owner_id) WHERE owner_id IS NOT NULL;

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE skills_fts USING fts5(
  name,
  description,
  content,
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Persona-skill attachments
CREATE TABLE persona_skills (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_persona_skills_unique ON persona_skills(persona_id, skill_id);
CREATE INDEX idx_persona_skills_persona ON persona_skills(persona_id);
CREATE INDEX idx_persona_skills_skill ON persona_skills(skill_id);

-- Org default skills (auto-loaded when no persona specified)
CREATE TABLE org_default_skills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_org_default_skills_unique ON org_default_skills(org_id, skill_id);

-- Migrate existing skill artifacts to skills table
INSERT INTO skills (id, org_id, owner_id, source, name, slug, description, content, visibility, status, created_at, updated_at)
  SELECT
    a.id,
    p.org_id,
    NULL,
    CASE WHEN p.source = 'builtin' THEN 'builtin' ELSE 'plugin' END,
    REPLACE(REPLACE(a.filename, '.md', ''), '_', '-'),
    REPLACE(REPLACE(a.filename, '.md', ''), '_', '-'),
    NULL,
    a.content,
    'shared',
    'active',
    datetime('now'),
    datetime('now')
  FROM org_plugin_artifacts a
  JOIN org_plugins p ON a.plugin_id = p.id
  WHERE a.type = 'skill';

-- Populate FTS index
INSERT INTO skills_fts(rowid, name, description, content)
  SELECT rowid, name, COALESCE(description, ''), content FROM skills;

-- Add all existing skills as org defaults (preserves current "load everything" behavior)
INSERT INTO org_default_skills (id, org_id, skill_id)
  SELECT
    lower(hex(randomblob(8))),
    org_id,
    id
  FROM skills WHERE source IN ('builtin', 'plugin');

-- Remove migrated skill rows from org_plugin_artifacts
DELETE FROM org_plugin_artifacts WHERE type = 'skill';
```

**Step 2: Verify migration is syntactically valid**

Run: `cd packages/worker && npx wrangler d1 migrations apply valet-db --local --persist-to=.wrangler/state/v3/d1`

Note: This may not work inside sandbox. If unavailable, verify SQL syntax manually and move on — it will be validated on deploy.

**Step 3: Commit**

```bash
git add packages/worker/migrations/0062_managed_skills.sql
git commit -m "feat(skills): add D1 migration for unified skills tables"
```

---

### Task 2: Drizzle Schema

**Files:**
- Create: `packages/worker/src/lib/schema/skills.ts`
- Modify: `packages/worker/src/lib/schema/index.ts`

**Step 1: Write the Drizzle schema**

Create `packages/worker/src/lib/schema/skills.ts`:

```typescript
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const skills = sqliteTable('skills', {
  id: text().primaryKey(),
  orgId: text().notNull().default('default'),
  ownerId: text(),
  source: text().notNull().default('managed'),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  content: text().notNull(),
  visibility: text().notNull().default('private'),
  status: text().notNull().default('active'),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_skills_org_status').on(table.orgId, table.status),
  index('idx_skills_owner').on(table.ownerId),
]);

export const personaSkills = sqliteTable('persona_skills', {
  id: text().primaryKey(),
  personaId: text().notNull(),
  skillId: text().notNull(),
  sortOrder: integer().notNull().default(0),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_persona_skills_unique').on(table.personaId, table.skillId),
  index('idx_persona_skills_persona').on(table.personaId),
  index('idx_persona_skills_skill').on(table.skillId),
]);

export const orgDefaultSkills = sqliteTable('org_default_skills', {
  id: text().primaryKey(),
  orgId: text().notNull(),
  skillId: text().notNull(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_org_default_skills_unique').on(table.orgId, table.skillId),
]);
```

**Step 2: Add to schema barrel export**

Add to `packages/worker/src/lib/schema/index.ts`:
```typescript
export * from './skills.js';
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add packages/worker/src/lib/schema/skills.ts packages/worker/src/lib/schema/index.ts
git commit -m "feat(skills): add Drizzle schema for skills, persona_skills, org_default_skills"
```

---

### Task 3: Database Query Helpers

**Files:**
- Create: `packages/worker/src/lib/db/skills.ts`
- Modify: `packages/worker/src/lib/db.ts`

**Step 1: Write DB query helpers**

Create `packages/worker/src/lib/db/skills.ts`:

```typescript
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { skills, personaSkills, orgDefaultSkills } from '../schema/skills.js';
import type { AppDb } from '../drizzle.js';

// --- Types ---

export type SkillRecord = typeof skills.$inferSelect;
export type SkillSource = 'builtin' | 'plugin' | 'managed';
export type SkillVisibility = 'private' | 'shared';

export interface SkillSearchResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  source: string;
  visibility: string;
  ownerId: string | null;
  updatedAt: string;
}

export interface SkillForDelivery {
  filename: string;
  content: string;
}

// --- CRUD ---

export async function createSkill(
  db: AppDb,
  skill: typeof skills.$inferInsert,
): Promise<SkillRecord> {
  const [row] = await db.insert(skills).values(skill).returning();
  // Sync FTS
  await db.run(sql`INSERT INTO skills_fts(rowid, name, description, content)
    SELECT rowid, name, COALESCE(description, ''), content FROM skills WHERE id = ${skill.id}`);
  return row;
}

export async function updateSkill(
  db: AppDb,
  id: string,
  updates: Partial<Pick<typeof skills.$inferInsert, 'name' | 'slug' | 'description' | 'content' | 'visibility' | 'status'>>,
): Promise<SkillRecord | null> {
  const [row] = await db
    .update(skills)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(skills.id, id))
    .returning();
  if (row) {
    // Rebuild FTS for this row
    await db.run(sql`DELETE FROM skills_fts WHERE rowid = (SELECT rowid FROM skills WHERE id = ${id})`);
    await db.run(sql`INSERT INTO skills_fts(rowid, name, description, content)
      SELECT rowid, name, COALESCE(description, ''), content FROM skills WHERE id = ${id}`);
  }
  return row ?? null;
}

export async function deleteSkill(db: AppDb, id: string): Promise<boolean> {
  // Remove FTS entry first
  await db.run(sql`DELETE FROM skills_fts WHERE rowid = (SELECT rowid FROM skills WHERE id = ${id})`);
  // Remove persona attachments
  await db.delete(personaSkills).where(eq(personaSkills.skillId, id));
  // Remove org default entries
  await db.delete(orgDefaultSkills).where(eq(orgDefaultSkills.skillId, id));
  // Delete skill
  const result = await db.delete(skills).where(eq(skills.id, id)).returning();
  return result.length > 0;
}

export async function getSkill(db: AppDb, id: string): Promise<SkillRecord | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  return row ?? null;
}

export async function getSkillBySlug(
  db: AppDb,
  orgId: string,
  slug: string,
  ownerId?: string,
): Promise<SkillRecord | null> {
  const conditions = [eq(skills.orgId, orgId), eq(skills.slug, slug)];
  if (ownerId) {
    conditions.push(eq(skills.ownerId, ownerId));
  }
  const [row] = await db.select().from(skills).where(and(...conditions));
  return row ?? null;
}

// --- Search ---

export async function searchSkills(
  db: AppDb,
  orgId: string,
  userId: string,
  query: string,
  limit = 20,
): Promise<SkillSearchResult[]> {
  // FTS5 search — user sees shared skills + their own private skills
  const results = await db.all<SkillSearchResult>(sql`
    SELECT s.id, s.name, s.slug, s.description, s.source, s.visibility, s.owner_id as ownerId, s.updated_at as updatedAt
    FROM skills s
    JOIN skills_fts fts ON fts.rowid = s.rowid
    WHERE skills_fts MATCH ${query}
      AND s.org_id = ${orgId}
      AND s.status = 'active'
      AND (s.visibility = 'shared' OR s.owner_id = ${userId})
    ORDER BY rank
    LIMIT ${limit}
  `);
  return results;
}

export async function listSkills(
  db: AppDb,
  orgId: string,
  userId: string,
  filters?: { source?: string; visibility?: string },
): Promise<SkillSearchResult[]> {
  const conditions = [
    eq(skills.orgId, orgId),
    eq(skills.status, 'active'),
    or(eq(skills.visibility, 'shared'), eq(skills.ownerId, userId)),
  ];
  if (filters?.source) {
    conditions.push(eq(skills.source, filters.source));
  }
  if (filters?.visibility) {
    conditions.push(eq(skills.visibility, filters.visibility));
  }

  return db
    .select({
      id: skills.id,
      name: skills.name,
      slug: skills.slug,
      description: skills.description,
      source: skills.source,
      visibility: skills.visibility,
      ownerId: skills.ownerId,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .where(and(...conditions))
    .orderBy(skills.name);
}

// --- Upsert for plugin sync ---

export async function upsertSkillFromSync(
  db: AppDb,
  skill: typeof skills.$inferInsert,
): Promise<void> {
  await db
    .insert(skills)
    .values(skill)
    .onConflictDoUpdate({
      target: [skills.orgId, skills.slug],
      set: {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: skill.source,
        updatedAt: new Date().toISOString(),
      },
    });
  // Rebuild FTS for this row
  await db.run(sql`DELETE FROM skills_fts WHERE rowid = (SELECT rowid FROM skills WHERE id = ${skill.id})`);
  await db.run(sql`INSERT INTO skills_fts(rowid, name, description, content)
    SELECT rowid, name, COALESCE(description, ''), content FROM skills WHERE id = ${skill.id}`);
}

// --- Persona skill attachments ---

export async function getPersonaSkills(
  db: AppDb,
  personaId: string,
): Promise<SkillForDelivery[]> {
  const rows = await db
    .select({
      filename: skills.slug,
      content: skills.content,
    })
    .from(personaSkills)
    .innerJoin(skills, eq(personaSkills.skillId, skills.id))
    .where(and(eq(personaSkills.personaId, personaId), eq(skills.status, 'active')))
    .orderBy(personaSkills.sortOrder);

  return rows.map(r => ({ filename: `${r.filename}.md`, content: r.content }));
}

export async function attachSkillToPersona(
  db: AppDb,
  id: string,
  personaId: string,
  skillId: string,
  sortOrder = 0,
): Promise<void> {
  await db.insert(personaSkills).values({ id, personaId, skillId, sortOrder });
}

export async function detachSkillFromPersona(
  db: AppDb,
  personaId: string,
  skillId: string,
): Promise<boolean> {
  const result = await db
    .delete(personaSkills)
    .where(and(eq(personaSkills.personaId, personaId), eq(personaSkills.skillId, skillId)))
    .returning();
  return result.length > 0;
}

// --- Org default skills ---

export async function getOrgDefaultSkills(
  db: AppDb,
  orgId: string,
): Promise<SkillForDelivery[]> {
  const rows = await db
    .select({
      filename: skills.slug,
      content: skills.content,
    })
    .from(orgDefaultSkills)
    .innerJoin(skills, eq(orgDefaultSkills.skillId, skills.id))
    .where(and(eq(orgDefaultSkills.orgId, orgId), eq(skills.status, 'active')));

  return rows.map(r => ({ filename: `${r.filename}.md`, content: r.content }));
}

export async function setOrgDefaultSkills(
  db: AppDb,
  orgId: string,
  skillIds: string[],
): Promise<void> {
  // Replace all defaults
  await db.delete(orgDefaultSkills).where(eq(orgDefaultSkills.orgId, orgId));
  if (skillIds.length > 0) {
    await db.insert(orgDefaultSkills).values(
      skillIds.map(skillId => ({
        id: crypto.randomUUID(),
        orgId,
        skillId,
      })),
    );
  }
}
```

**Step 2: Add to DB barrel export**

Add to `packages/worker/src/lib/db.ts`:
```typescript
export * from './db/skills.js';
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/lib/db/skills.ts packages/worker/src/lib/db.ts
git commit -m "feat(skills): add DB query helpers for skills CRUD, search, persona attachments"
```

---

### Task 4: Shared Types

**Files:**
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Add skill types**

Add the following types to `packages/shared/src/types/index.ts` (after the existing plugin types):

```typescript
// --- Skills ---

export type SkillSource = 'builtin' | 'plugin' | 'managed';
export type SkillVisibility = 'private' | 'shared';

export interface Skill {
  id: string;
  orgId: string;
  ownerId: string | null;
  source: SkillSource;
  name: string;
  slug: string;
  description: string | null;
  content: string;
  visibility: SkillVisibility;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  source: SkillSource;
  visibility: SkillVisibility;
  ownerId: string | null;
  updatedAt: string;
}

export interface PersonaSkillAttachment {
  id: string;
  personaId: string;
  skillId: string;
  sortOrder: number;
  createdAt: string;
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat(skills): add shared types for Skill, SkillSummary, PersonaSkillAttachment"
```

---

### Task 5: Worker API Routes

**Files:**
- Create: `packages/worker/src/routes/skills.ts`
- Modify: `packages/worker/src/index.ts`

**Step 1: Write the skills router**

Create `packages/worker/src/routes/skills.ts`:

```typescript
import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import {
  createSkill,
  updateSkill,
  deleteSkill,
  getSkill,
  getSkillBySlug,
  searchSkills,
  listSkills,
} from '../lib/db.js';
import { NotFoundError, ValidationError } from '@valet/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// List/search skills
app.get('/', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const query = c.req.query('q');
  const source = c.req.query('source');
  const visibility = c.req.query('visibility');

  if (query) {
    const results = await searchSkills(db, 'default', user.id, query);
    return c.json({ skills: results });
  }

  const results = await listSkills(db, 'default', user.id, { source, visibility });
  return c.json({ skills: results });
});

// Get single skill
app.get('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const skill = await getSkill(db, c.req.param('id'));

  if (!skill) throw new NotFoundError('Skill not found');
  if (skill.visibility === 'private' && skill.ownerId !== user.id) {
    throw new NotFoundError('Skill not found');
  }

  return c.json({ skill });
});

// Create managed skill
app.post('/', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json<{
    name: string;
    slug?: string;
    description?: string;
    content: string;
    visibility?: string;
  }>();

  if (!body.name?.trim()) throw new ValidationError('name is required');
  if (!body.content?.trim()) throw new ValidationError('content is required');

  const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const skill = await createSkill(db, {
    id: crypto.randomUUID(),
    orgId: 'default',
    ownerId: user.id,
    source: 'managed',
    name: body.name,
    slug,
    description: body.description ?? null,
    content: body.content,
    visibility: body.visibility ?? 'private',
    status: 'active',
  });

  return c.json({ skill }, 201);
});

// Update managed skill
app.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const existing = await getSkill(db, c.req.param('id'));

  if (!existing) throw new NotFoundError('Skill not found');
  if (existing.source !== 'managed') throw new ValidationError('Cannot edit builtin or plugin skills');
  if (existing.ownerId !== user.id) throw new NotFoundError('Skill not found');

  const body = await c.req.json<{
    name?: string;
    slug?: string;
    description?: string;
    content?: string;
    visibility?: string;
  }>();

  const skill = await updateSkill(db, existing.id, {
    ...(body.name && { name: body.name }),
    ...(body.slug && { slug: body.slug }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.content && { content: body.content }),
    ...(body.visibility && { visibility: body.visibility }),
  });

  return c.json({ skill });
});

// Delete managed skill
app.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const existing = await getSkill(db, c.req.param('id'));

  if (!existing) throw new NotFoundError('Skill not found');
  if (existing.source !== 'managed') throw new ValidationError('Cannot delete builtin or plugin skills');
  if (existing.ownerId !== user.id) throw new NotFoundError('Skill not found');

  await deleteSkill(db, existing.id);
  return c.json({ deleted: true });
});

export const skillsRouter = app;
```

**Step 2: Mount the router in index.ts**

Add import to `packages/worker/src/index.ts`:
```typescript
import { skillsRouter } from './routes/skills.js';
```

Add route mounting (after the plugins line):
```typescript
app.route('/api/skills', skillsRouter);
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/routes/skills.ts packages/worker/src/index.ts
git commit -m "feat(skills): add REST API routes for skills CRUD and search"
```

---

### Task 6: Persona-Skill Attachment Routes

**Files:**
- Modify: `packages/worker/src/routes/personas.ts`

**Step 1: Read the existing personas router**

Read: `packages/worker/src/routes/personas.ts`
Understand the existing route structure and patterns.

**Step 2: Add persona-skill attachment endpoints**

Add the following routes to the personas router:

```typescript
// GET /api/personas/:id/skills — list skills attached to a persona
app.get('/:id/skills', async (c) => {
  const db = c.get('db');
  const personaId = c.req.param('id');
  const skills = await getPersonaSkills(db, personaId);
  return c.json({ skills });
});

// POST /api/personas/:id/skills — attach a skill
app.post('/:id/skills', async (c) => {
  const db = c.get('db');
  const personaId = c.req.param('id');
  const body = await c.req.json<{ skillId: string; sortOrder?: number }>();
  if (!body.skillId) throw new ValidationError('skillId is required');

  await attachSkillToPersona(db, crypto.randomUUID(), personaId, body.skillId, body.sortOrder ?? 0);
  return c.json({ attached: true }, 201);
});

// DELETE /api/personas/:id/skills/:skillId — detach a skill
app.delete('/:id/skills/:skillId', async (c) => {
  const db = c.get('db');
  const personaId = c.req.param('id');
  const skillId = c.req.param('skillId');

  const removed = await detachSkillFromPersona(db, personaId, skillId);
  if (!removed) throw new NotFoundError('Attachment not found');
  return c.json({ detached: true });
});
```

Add imports for `getPersonaSkills`, `attachSkillToPersona`, `detachSkillFromPersona` from `../lib/db.js`.

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/routes/personas.ts
git commit -m "feat(skills): add persona-skill attachment/detachment routes"
```

---

### Task 7: Update Plugin Sync to Use Skills Table

**Files:**
- Modify: `packages/worker/src/services/plugin-sync.ts`

**Step 1: Read the current plugin-sync.ts**

Read: `packages/worker/src/services/plugin-sync.ts`

**Step 2: Update sync to write skills to the skills table**

Modify `doSync()` to:
1. Continue upserting non-skill artifacts (tools, personas) to `org_plugin_artifacts` as before
2. For skill artifacts, call `upsertSkillFromSync()` instead of `upsertPluginArtifact()`
3. Determine source type: check if the plugin name matches known builtins (browser, workflows, sandbox-tunnels) → `builtin`, otherwise → `plugin`

```typescript
import { upsertSkillFromSync } from '../lib/db.js';

// Inside doSync(), when iterating artifacts:
for (const artifact of entry.artifacts) {
  if (artifact.type === 'skill') {
    // Write to skills table instead
    const source = ['browser', 'workflows', 'sandbox-tunnels'].includes(entry.name)
      ? 'builtin' as const
      : 'plugin' as const;
    const slug = artifact.filename.replace('.md', '').replace(/_/g, '-');
    await upsertSkillFromSync(db, {
      id: crypto.randomUUID(),
      orgId: 'default',
      ownerId: null,
      source,
      name: slug,
      slug,
      description: entry.description ?? null,
      content: artifact.content,
      visibility: 'shared',
      status: 'active',
    });
  } else {
    // Existing behavior for tools and personas
    await upsertPluginArtifact(db, { ... });
  }
}
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/services/plugin-sync.ts
git commit -m "feat(skills): route plugin skill sync to unified skills table"
```

---

### Task 8: Update SessionAgentDO Skill Delivery

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts`

**Step 1: Read the sendPluginContent method**

Read: `packages/worker/src/durable-objects/session-agent.ts` around line 8619-8668

**Step 2: Update skill resolution logic**

Modify `sendPluginContent()` to:
1. Import `getPersonaSkills` and `getOrgDefaultSkills` from `../lib/db.js`
2. Check if the session has a persona (from spawnRequest)
3. If persona → call `getPersonaSkills(db, personaId)` for curated skills
4. If no persona → call `getOrgDefaultSkills(db, orgId)` for org defaults
5. Replace the `artifacts.filter(a => a.type === 'skill')` line with the resolved skills

```typescript
// Replace skill resolution in sendPluginContent():
import { getPersonaSkills, getOrgDefaultSkills } from '../lib/db.js';

// Resolve skills based on persona or org defaults
let skillsForDelivery: Array<{ filename: string; content: string }>;
const personaId = spawnRequest?.personaId;
if (personaId) {
  skillsForDelivery = await getPersonaSkills(this.env.DB, personaId);
} else {
  skillsForDelivery = await getOrgDefaultSkills(this.env.DB, orgId);
}

// In the content object:
const content = {
  personas: [ /* ... unchanged ... */ ],
  skills: skillsForDelivery,
  tools: artifacts.filter(a => a.type === 'tool').map(a => ({
    filename: a.filename,
    content: a.content,
  })),
  allowRepoContent: settings.allowRepoContent,
};
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(skills): resolve session skills from persona attachments or org defaults"
```

---

### Task 9: OpenCode Tools — search_skills and read_skill

**Files:**
- Create: `docker/opencode/tools/search_skills.ts`
- Create: `docker/opencode/tools/read_skill.ts`

**Step 1: Write search_skills tool**

Create `docker/opencode/tools/search_skills.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Search the skill library for skills by keyword. Returns skill summaries (name, description, source, tags) " +
    "but not full content. Use read_skill to fetch the full content of a skill you want to use. " +
    "Skills teach you how to perform specific tasks, follow processes, or use tools effectively.",
  args: {
    query: tool.schema
      .string()
      .describe("Search query — matches against skill name, description, and content"),
    source: tool.schema
      .enum(["builtin", "plugin", "managed"])
      .optional()
      .describe("Filter by skill source type"),
  },
  async execute(args) {
    if (!args.query?.trim()) {
      return "Error: query is required"
    }

    try {
      const params = new URLSearchParams({ q: args.query })
      if (args.source) params.set("source", args.source)

      const res = await fetch(`http://localhost:9000/api/skills?${params}`, {
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to search skills: ${errText}`
      }

      const data = (await res.json()) as {
        skills: Array<{
          id: string
          name: string
          slug: string
          description: string | null
          source: string
          visibility: string
          updatedAt: string
        }>
      }

      if (data.skills.length === 0) {
        return "No skills found matching your query."
      }

      const lines = data.skills.map(
        (s) =>
          `- **${s.name}** (${s.source}) [id: ${s.id}]\n  ${s.description || "No description"}`
      )
      return `Found ${data.skills.length} skill(s):\n\n${lines.join("\n\n")}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to search skills: ${msg}`
    }
  },
})
```

**Step 2: Write read_skill tool**

Create `docker/opencode/tools/read_skill.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Read the full content of a skill by ID or slug. Use search_skills first to find the skill you need, " +
    "then read_skill to load its full instructions into your context.",
  args: {
    id: tool.schema
      .string()
      .optional()
      .describe("Skill ID (from search_skills results)"),
    slug: tool.schema
      .string()
      .optional()
      .describe("Skill slug (URL-safe name)"),
  },
  async execute(args) {
    if (!args.id && !args.slug) {
      return "Error: must specify either id or slug"
    }

    try {
      const identifier = args.id || args.slug
      const res = await fetch(`http://localhost:9000/api/skills/${identifier}`, {
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        if (res.status === 404) return "Skill not found."
        const errText = await res.text()
        return `Failed to read skill: ${errText}`
      }

      const data = (await res.json()) as {
        skill: {
          id: string
          name: string
          slug: string
          source: string
          content: string
        }
      }

      return `# Skill: ${data.skill.name} (${data.skill.source})\n\n${data.skill.content}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to read skill: ${msg}`
    }
  },
})
```

**Step 3: Commit**

```bash
git add docker/opencode/tools/search_skills.ts docker/opencode/tools/read_skill.ts
git commit -m "feat(skills): add search_skills and read_skill OpenCode tools"
```

---

### Task 10: OpenCode Tools — create_skill, update_skill, delete_skill

**Files:**
- Create: `docker/opencode/tools/create_skill.ts`
- Create: `docker/opencode/tools/update_skill.ts`
- Create: `docker/opencode/tools/delete_skill.ts`

**Step 1: Write create_skill tool**

Create `docker/opencode/tools/create_skill.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Create a new managed skill in the skill library. Skills are markdown documents that teach you " +
    "how to perform specific tasks. Created skills are private to your user by default. " +
    "Use YAML frontmatter for structured metadata (tags, version).",
  args: {
    name: tool.schema.string().describe("Human-readable skill name"),
    slug: tool.schema
      .string()
      .optional()
      .describe("URL-safe identifier (auto-generated from name if omitted)"),
    description: tool.schema
      .string()
      .optional()
      .describe("Brief description of what this skill teaches"),
    content: tool.schema
      .string()
      .describe(
        "Full markdown content of the skill. Can include YAML frontmatter with tags and version."
      ),
    visibility: tool.schema
      .enum(["private", "shared"])
      .optional()
      .describe("Visibility: 'private' (default, only you) or 'shared' (whole org)"),
  },
  async execute(args) {
    if (!args.name?.trim()) return "Error: name is required"
    if (!args.content?.trim()) return "Error: content is required"

    try {
      const res = await fetch("http://localhost:9000/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          slug: args.slug,
          description: args.description,
          content: args.content,
          visibility: args.visibility || "private",
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to create skill: ${errText}`
      }

      const data = (await res.json()) as { skill: { id: string; name: string; slug: string } }
      return `Skill created: "${data.skill.name}" (id: ${data.skill.id}, slug: ${data.skill.slug})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to create skill: ${msg}`
    }
  },
})
```

**Step 2: Write update_skill tool**

Create `docker/opencode/tools/update_skill.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Update an existing managed skill. Only skills you created (source: managed) can be edited. " +
    "You can update the name, description, content, or visibility.",
  args: {
    id: tool.schema.string().describe("Skill ID to update"),
    name: tool.schema.string().optional().describe("New skill name"),
    description: tool.schema.string().optional().describe("New description"),
    content: tool.schema.string().optional().describe("New markdown content"),
    visibility: tool.schema
      .enum(["private", "shared"])
      .optional()
      .describe("New visibility setting"),
  },
  async execute(args) {
    if (!args.id) return "Error: id is required"
    if (!args.name && !args.description && !args.content && !args.visibility) {
      return "Error: at least one field to update is required"
    }

    try {
      const body: Record<string, string> = {}
      if (args.name) body.name = args.name
      if (args.description) body.description = args.description
      if (args.content) body.content = args.content
      if (args.visibility) body.visibility = args.visibility

      const res = await fetch(`http://localhost:9000/api/skills/${args.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        if (res.status === 404) return "Skill not found or not editable."
        const errText = await res.text()
        return `Failed to update skill: ${errText}`
      }

      const data = (await res.json()) as { skill: { id: string; name: string } }
      return `Skill updated: "${data.skill.name}" (id: ${data.skill.id})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to update skill: ${msg}`
    }
  },
})
```

**Step 3: Write delete_skill tool**

Create `docker/opencode/tools/delete_skill.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Delete a managed skill from the skill library. Only skills you created (source: managed) can be deleted. " +
    "This also removes the skill from any persona attachments and org defaults.",
  args: {
    id: tool.schema.string().describe("Skill ID to delete"),
  },
  async execute(args) {
    if (!args.id) return "Error: id is required"

    try {
      const res = await fetch(`http://localhost:9000/api/skills/${args.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        if (res.status === 404) return "Skill not found or not deletable."
        const errText = await res.text()
        return `Failed to delete skill: ${errText}`
      }

      return "Skill deleted."
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to delete skill: ${msg}`
    }
  },
})
```

**Step 4: Commit**

```bash
git add docker/opencode/tools/create_skill.ts docker/opencode/tools/update_skill.ts docker/opencode/tools/delete_skill.ts
git commit -m "feat(skills): add create_skill, update_skill, delete_skill OpenCode tools"
```

---

### Task 11: Update Content Registry Generator

**Files:**
- Modify: `scripts/generate-plugin-registry.ts`

**Step 1: Read the generator script**

Read: `scripts/generate-plugin-registry.ts`
Understand how it scans plugins and generates the content-registry.

**Step 2: Update generator to exclude skills from content-registry inlining**

The content-registry still needs skill data for the sync process (so `plugin-sync.ts` knows what skills exist), but we should mark them clearly. The simplest approach: keep skills in the registry entries (they're needed for sync to the `skills` table), but add a comment noting they're synced to the `skills` table, not `org_plugin_artifacts`.

No code change needed here if `plugin-sync.ts` (Task 7) already routes skills correctly. Verify and move on.

**Step 3: Run registry generation**

Run: `make generate-registries`
Expected: Generates without errors

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit (if changes)**

```bash
git add scripts/generate-plugin-registry.ts packages/worker/src/plugins/content-registry.ts
git commit -m "chore(skills): update registry generator for skills table sync"
```

---

### Task 12: Update OpenCode Base Instructions

**Files:**
- Modify: `docker/opencode/opencode.json`

**Step 1: Read the current opencode.json**

Read: `docker/opencode/opencode.json`
Find where skills are referenced in the base instructions.

**Step 2: Add skill library instructions**

Add a section to the base instructions explaining the skill library:

```
You have access to a skill library with searchable skills. Skills loaded at session start are
your core skills (attached to your persona or org defaults). For additional skills, use:
- search_skills: Find skills by keyword
- read_skill: Load a skill's full content
- create_skill: Create a new skill from what you've learned
- update_skill: Update an existing skill you created
- delete_skill: Remove a skill you created
```

**Step 3: Commit**

```bash
git add docker/opencode/opencode.json
git commit -m "feat(skills): add skill library tool descriptions to OpenCode base instructions"
```

---

### Task 13: Org Default Skills Admin Routes

**Files:**
- Create: `packages/worker/src/routes/org-default-skills.ts` (or add to existing admin routes)
- Modify: `packages/worker/src/index.ts`

**Step 1: Write org default skills routes**

```typescript
import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { getOrgDefaultSkills, setOrgDefaultSkills } from '../lib/db.js';
import { listSkills } from '../lib/db.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/default-skills — list org default skills
app.get('/', async (c) => {
  const db = c.get('db');
  const skills = await getOrgDefaultSkills(db, 'default');
  return c.json({ skills });
});

// PUT /api/admin/default-skills — replace org default skills
app.put('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{ skillIds: string[] }>();
  await setOrgDefaultSkills(db, 'default', body.skillIds);
  return c.json({ updated: true });
});

export const orgDefaultSkillsRouter = app;
```

**Step 2: Mount in index.ts**

```typescript
import { orgDefaultSkillsRouter } from './routes/org-default-skills.js';
// ...
app.route('/api/admin/default-skills', orgDefaultSkillsRouter);
```

**Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/routes/org-default-skills.ts packages/worker/src/index.ts
git commit -m "feat(skills): add admin routes for org default skills management"
```

---

### Task 14: Runner Gateway — Skill API Proxy

**Files:**
- Modify: `packages/runner/src/gateway.ts`

**Step 1: Read the gateway**

Read: `packages/runner/src/gateway.ts`
Understand how the auth gateway proxies requests to the worker.

**Step 2: Verify skills routes are proxied**

The gateway should already proxy `/api/skills/*` requests to the worker since it proxies `/api/*` generically. Verify this is the case. If the gateway uses explicit route matching, add `/api/skills` to the allowed routes.

**Step 3: Run typecheck**

Run: `cd packages/runner && pnpm typecheck`
Expected: PASS

**Step 4: Commit (if changes needed)**

```bash
git add packages/runner/src/gateway.ts
git commit -m "feat(skills): ensure gateway proxies skill API routes"
```

---

### Task 15: End-to-End Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

**Step 2: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass (no regressions)

**Step 3: Verify registry generation**

Run: `make generate-registries`
Expected: Generates without errors, content-registry.ts is valid

**Step 4: Manual verification checklist**

- [ ] Migration SQL is syntactically valid
- [ ] Drizzle schema matches migration columns
- [ ] DB helpers match Drizzle schema types
- [ ] Shared types match DB helper return types
- [ ] API routes use correct DB helpers
- [ ] OpenCode tools hit correct API endpoints
- [ ] Plugin sync routes skills to the skills table
- [ ] SessionAgentDO resolves skills from persona or org defaults
- [ ] FTS index is populated and queried correctly

**Step 5: Final commit**

```bash
git commit --allow-empty -m "feat(skills): managed skills system complete — unified skill storage, FTS search, persona attachment, agent CRUD tools"
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `packages/worker/migrations/0062_managed_skills.sql` | Create | D1 tables + FTS + data migration |
| `packages/worker/src/lib/schema/skills.ts` | Create | Drizzle schema |
| `packages/worker/src/lib/schema/index.ts` | Modify | Add skills export |
| `packages/worker/src/lib/db/skills.ts` | Create | CRUD, search, persona attachment queries |
| `packages/worker/src/lib/db.ts` | Modify | Add skills export |
| `packages/shared/src/types/index.ts` | Modify | Skill, SkillSummary, PersonaSkillAttachment types |
| `packages/worker/src/routes/skills.ts` | Create | REST API for skills |
| `packages/worker/src/routes/org-default-skills.ts` | Create | Admin routes for org defaults |
| `packages/worker/src/routes/personas.ts` | Modify | Persona-skill attachment endpoints |
| `packages/worker/src/index.ts` | Modify | Mount new routers |
| `packages/worker/src/services/plugin-sync.ts` | Modify | Route skills to skills table |
| `packages/worker/src/durable-objects/session-agent.ts` | Modify | Resolve skills from persona/org defaults |
| `docker/opencode/tools/search_skills.ts` | Create | Search tool |
| `docker/opencode/tools/read_skill.ts` | Create | Read tool |
| `docker/opencode/tools/create_skill.ts` | Create | Create tool |
| `docker/opencode/tools/update_skill.ts` | Create | Update tool |
| `docker/opencode/tools/delete_skill.ts` | Create | Delete tool |
| `docker/opencode/opencode.json` | Modify | Skill library instructions |
| `packages/runner/src/gateway.ts` | Verify | Skill API proxy |
