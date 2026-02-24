import type { D1Database } from '@cloudflare/workers-types';
import type { AgentPersona, AgentPersonaFile, PersonaVisibility } from '@agent-ops/shared';
import { eq, and, or, sql, desc, asc } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { agentPersonas, agentPersonaFiles, orgRepoPersonaDefaults } from '../schema/index.js';
import { users } from '../schema/users.js';

export async function createPersona(
  db: D1Database,
  data: { id: string; name: string; slug: string; description?: string; icon?: string; defaultModel?: string; visibility?: PersonaVisibility; isDefault?: boolean; createdBy: string }
): Promise<AgentPersona> {
  const drizzle = getDb(db);

  if (data.isDefault) {
    await drizzle
      .update(agentPersonas)
      .set({ isDefault: false })
      .where(and(eq(agentPersonas.orgId, 'default'), eq(agentPersonas.isDefault, true)));
  }

  await drizzle.insert(agentPersonas).values({
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description || null,
    icon: data.icon || null,
    defaultModel: data.defaultModel || null,
    visibility: data.visibility || 'shared',
    isDefault: !!data.isDefault,
    createdBy: data.createdBy,
  });

  return {
    id: data.id,
    orgId: 'default',
    name: data.name,
    slug: data.slug,
    description: data.description,
    icon: data.icon,
    defaultModel: data.defaultModel,
    visibility: data.visibility || 'shared',
    isDefault: !!data.isDefault,
    createdBy: data.createdBy,
    fileCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listPersonas(db: D1Database, userId: string, orgId: string = 'default'): Promise<AgentPersona[]> {
  // Subquery for file_count — use raw SQL for the subquery
  const result = await db
    .prepare(
      `SELECT p.*, u.name as creator_name,
              (SELECT COUNT(*) FROM agent_persona_files f WHERE f.persona_id = p.id) as file_count
       FROM agent_personas p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.org_id = ?
         AND (p.visibility = 'shared' OR p.created_by = ?)
       ORDER BY p.is_default DESC, p.name ASC`
    )
    .bind(orgId, userId)
    .all();

  return (result.results || []).map((row: any): AgentPersona => ({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    icon: row.icon || undefined,
    defaultModel: row.default_model || undefined,
    visibility: row.visibility as PersonaVisibility,
    isDefault: !!row.is_default,
    createdBy: row.created_by,
    creatorName: row.creator_name || undefined,
    fileCount: row.file_count ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getPersonaWithFiles(db: D1Database, id: string): Promise<AgentPersona | null> {
  const drizzle = getDb(db);

  // Main persona with creator name via raw SQL for the join
  const row = await db
    .prepare(
      `SELECT p.*, u.name as creator_name
       FROM agent_personas p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ?`
    )
    .bind(id)
    .first<any>();

  if (!row) return null;

  const files = await drizzle
    .select()
    .from(agentPersonaFiles)
    .where(eq(agentPersonaFiles.personaId, id))
    .orderBy(asc(agentPersonaFiles.sortOrder), asc(agentPersonaFiles.filename));

  const persona: AgentPersona = {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    icon: row.icon || undefined,
    defaultModel: row.default_model || undefined,
    visibility: row.visibility as PersonaVisibility,
    isDefault: !!row.is_default,
    createdBy: row.created_by,
    creatorName: row.creator_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  persona.files = files.map((f): AgentPersonaFile => ({
    id: f.id,
    personaId: f.personaId,
    filename: f.filename,
    content: f.content,
    sortOrder: f.sortOrder ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));

  return persona;
}

export async function updatePersona(
  db: D1Database,
  id: string,
  updates: Partial<Pick<AgentPersona, 'name' | 'slug' | 'description' | 'icon' | 'defaultModel' | 'visibility' | 'isDefault'>>
): Promise<void> {
  // Dynamic SET clauses — keep as raw SQL for flexibility
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.slug !== undefined) { sets.push('slug = ?'); params.push(updates.slug); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description || null); }
  if (updates.icon !== undefined) { sets.push('icon = ?'); params.push(updates.icon || null); }
  if (updates.defaultModel !== undefined) { sets.push('default_model = ?'); params.push(updates.defaultModel || null); }
  if (updates.visibility !== undefined) { sets.push('visibility = ?'); params.push(updates.visibility); }
  if (updates.isDefault !== undefined) {
    if (updates.isDefault) {
      await db.prepare("UPDATE agent_personas SET is_default = 0 WHERE org_id = 'default' AND is_default = 1").run();
    }
    sets.push('is_default = ?');
    params.push(updates.isDefault ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE agent_personas SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

export async function deletePersona(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(agentPersonas).where(eq(agentPersonas.id, id));
}

// Persona File Operations
export async function upsertPersonaFile(
  db: D1Database,
  data: { id: string; personaId: string; filename: string; content: string; sortOrder?: number }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(agentPersonaFiles).values({
    id: data.id,
    personaId: data.personaId,
    filename: data.filename,
    content: data.content,
    sortOrder: data.sortOrder ?? 0,
  }).onConflictDoUpdate({
    target: [agentPersonaFiles.personaId, agentPersonaFiles.filename],
    set: {
      content: sql`excluded.content`,
      sortOrder: sql`excluded.sort_order`,
      updatedAt: sql`datetime('now')`,
    },
  });
}

export async function deletePersonaFile(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(agentPersonaFiles).where(eq(agentPersonaFiles.id, id));
}

// Repo-Persona Default Operations
export async function setRepoPersonaDefault(db: D1Database, orgRepoId: string, personaId: string): Promise<void> {
  const id = crypto.randomUUID();
  const drizzle = getDb(db);
  await drizzle.insert(orgRepoPersonaDefaults).values({
    id,
    orgRepoId,
    personaId,
  }).onConflictDoUpdate({
    target: orgRepoPersonaDefaults.orgRepoId,
    set: { personaId: sql`excluded.persona_id` },
  });
}

export async function getRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<string | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ personaId: orgRepoPersonaDefaults.personaId })
    .from(orgRepoPersonaDefaults)
    .where(eq(orgRepoPersonaDefaults.orgRepoId, orgRepoId))
    .get();
  return row?.personaId || null;
}

export async function deleteRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(orgRepoPersonaDefaults).where(eq(orgRepoPersonaDefaults.orgRepoId, orgRepoId));
}
