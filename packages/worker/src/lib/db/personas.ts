import type { D1Database } from '@cloudflare/workers-types';
import type { AgentPersona, AgentPersonaFile, PersonaVisibility } from '@agent-ops/shared';
import { mapPersona, mapPersonaFile } from './mappers.js';

export async function createPersona(
  db: D1Database,
  data: { id: string; name: string; slug: string; description?: string; icon?: string; defaultModel?: string; visibility?: PersonaVisibility; isDefault?: boolean; createdBy: string }
): Promise<AgentPersona> {
  // If setting as default, clear existing defaults first
  if (data.isDefault) {
    await db.prepare("UPDATE agent_personas SET is_default = 0 WHERE org_id = 'default' AND is_default = 1").run();
  }

  await db
    .prepare(
      `INSERT INTO agent_personas (id, name, slug, description, icon, default_model, visibility, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.name,
      data.slug,
      data.description || null,
      data.icon || null,
      data.defaultModel || null,
      data.visibility || 'shared',
      data.isDefault ? 1 : 0,
      data.createdBy
    )
    .run();

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

  return (result.results || []).map(mapPersona);
}

export async function getPersonaWithFiles(db: D1Database, id: string): Promise<AgentPersona | null> {
  const row = await db
    .prepare(
      `SELECT p.*, u.name as creator_name
       FROM agent_personas p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ?`
    )
    .bind(id)
    .first();

  if (!row) return null;

  const filesResult = await db
    .prepare('SELECT * FROM agent_persona_files WHERE persona_id = ? ORDER BY sort_order ASC, filename ASC')
    .bind(id)
    .all();

  const persona = mapPersona(row);
  persona.files = (filesResult.results || []).map(mapPersonaFile);
  return persona;
}

export async function updatePersona(
  db: D1Database,
  id: string,
  updates: Partial<Pick<AgentPersona, 'name' | 'slug' | 'description' | 'icon' | 'defaultModel' | 'visibility' | 'isDefault'>>
): Promise<void> {
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
  await db.prepare('DELETE FROM agent_personas WHERE id = ?').bind(id).run();
}

// Persona File Operations
export async function upsertPersonaFile(
  db: D1Database,
  data: { id: string; personaId: string; filename: string; content: string; sortOrder?: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_persona_files (id, persona_id, filename, content, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(persona_id, filename) DO UPDATE SET
         content = excluded.content,
         sort_order = excluded.sort_order,
         updated_at = datetime('now')`
    )
    .bind(data.id, data.personaId, data.filename, data.content, data.sortOrder ?? 0)
    .run();
}

export async function deletePersonaFile(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM agent_persona_files WHERE id = ?').bind(id).run();
}

// Repo-Persona Default Operations
export async function setRepoPersonaDefault(db: D1Database, orgRepoId: string, personaId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO org_repo_persona_defaults (id, org_repo_id, persona_id)
       VALUES (?, ?, ?)
       ON CONFLICT(org_repo_id) DO UPDATE SET persona_id = excluded.persona_id`
    )
    .bind(id, orgRepoId, personaId)
    .run();
}

export async function getRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT persona_id FROM org_repo_persona_defaults WHERE org_repo_id = ?')
    .bind(orgRepoId)
    .first<{ persona_id: string }>();
  return row?.persona_id || null;
}

export async function deleteRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<void> {
  await db.prepare('DELETE FROM org_repo_persona_defaults WHERE org_repo_id = ?').bind(orgRepoId).run();
}
