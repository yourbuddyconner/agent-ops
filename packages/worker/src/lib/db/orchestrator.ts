import type { D1Database } from '@cloudflare/workers-types';
import type { OrchestratorIdentity, OrchestratorMemory, OrchestratorMemoryCategory, AgentSession } from '@agent-ops/shared';
import { mapOrchestratorIdentity, mapOrchestratorMemory, mapSession, MEMORY_CAP } from './mappers.js';
import { getSession } from './sessions.js';

// ─── Orchestrator Identity Operations ───────────────────────────────────────

export async function getOrchestratorIdentity(db: D1Database, userId: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const row = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE user_id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first();
  return row ? mapOrchestratorIdentity(row) : null;
}

export async function getOrchestratorIdentityByHandle(db: D1Database, handle: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const row = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE handle = ? AND org_id = ?')
    .bind(handle, orgId)
    .first();
  return row ? mapOrchestratorIdentity(row) : null;
}

export async function createOrchestratorIdentity(
  db: D1Database,
  data: { id: string; userId: string; name: string; handle: string; avatar?: string; customInstructions?: string; orgId?: string }
): Promise<OrchestratorIdentity> {
  const orgId = data.orgId || 'default';
  await db
    .prepare(
      'INSERT INTO orchestrator_identities (id, user_id, org_id, type, name, handle, avatar, custom_instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, orgId, 'personal', data.name, data.handle, data.avatar || null, data.customInstructions || null)
    .run();

  return {
    id: data.id,
    userId: data.userId,
    orgId,
    type: 'personal',
    name: data.name,
    handle: data.handle,
    avatar: data.avatar,
    customInstructions: data.customInstructions,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateOrchestratorIdentity(
  db: D1Database,
  id: string,
  updates: Partial<Pick<OrchestratorIdentity, 'name' | 'handle' | 'avatar' | 'customInstructions'>>
): Promise<void> {
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.handle !== undefined) { sets.push('handle = ?'); params.push(updates.handle); }
  if (updates.avatar !== undefined) { sets.push('avatar = ?'); params.push(updates.avatar || null); }
  if (updates.customInstructions !== undefined) { sets.push('custom_instructions = ?'); params.push(updates.customInstructions || null); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE orchestrator_identities SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

// ─── Orchestrator Memory Operations ─────────────────────────────────────────

export async function listOrchestratorMemories(
  db: D1Database,
  userId: string,
  options: { category?: string; query?: string; limit?: number } = {}
): Promise<OrchestratorMemory[]> {
  const limit = options.limit || 50;

  if (options.query) {
    // Use FTS5 full-text search with BM25 ranking
    // Tokenize query words and join with OR for broad matching
    const ftsQuery = options.query
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w}"`)
      .join(' OR ');

    if (!ftsQuery) {
      // Query was all punctuation — fall through to non-FTS path
      return listOrchestratorMemoriesPlain(db, userId, options.category, limit);
    }

    let query = `
      SELECT m.* FROM orchestrator_memories m
      JOIN orchestrator_memories_fts fts ON fts.rowid = m.rowid
      WHERE orchestrator_memories_fts MATCH ? AND m.user_id = ?`;
    const params: (string | number)[] = [ftsQuery, userId];

    if (options.category) {
      query += ' AND m.category = ?';
      params.push(options.category);
    }

    query += ' ORDER BY bm25(orchestrator_memories_fts) LIMIT ?';
    params.push(limit);

    const result = await db.prepare(query).bind(...params).all();
    return (result.results || []).map(mapOrchestratorMemory);
  }

  return listOrchestratorMemoriesPlain(db, userId, options.category, limit);
}

function listOrchestratorMemoriesPlain(
  db: D1Database,
  userId: string,
  category?: string,
  limit: number = 50,
): Promise<OrchestratorMemory[]> {
  let query = 'SELECT * FROM orchestrator_memories WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY relevance DESC, last_accessed_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).bind(...params).all().then((r) => (r.results || []).map(mapOrchestratorMemory));
}

export async function createOrchestratorMemory(
  db: D1Database,
  data: { id: string; userId: string; category: OrchestratorMemoryCategory; content: string; relevance?: number }
): Promise<OrchestratorMemory> {
  await db
    .prepare(
      'INSERT INTO orchestrator_memories (id, user_id, category, content, relevance) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, data.category, data.content, data.relevance ?? 1.0)
    .run();

  // Sync FTS index — get the rowid of the just-inserted row
  const inserted = await db
    .prepare('SELECT rowid FROM orchestrator_memories WHERE id = ?')
    .bind(data.id)
    .first<{ rowid: number }>();
  if (inserted) {
    await db
      .prepare('INSERT INTO orchestrator_memories_fts(rowid, category, content) VALUES (?, ?, ?)')
      .bind(inserted.rowid, data.category, data.content)
      .run();
  }

  // Prune if over cap: delete lowest-relevance entries
  const countResult = await db
    .prepare('SELECT COUNT(*) as cnt FROM orchestrator_memories WHERE user_id = ?')
    .bind(data.userId)
    .first<{ cnt: number }>();

  if (countResult && countResult.cnt > MEMORY_CAP) {
    const excess = countResult.cnt - MEMORY_CAP;
    // Get rowids before deleting so we can clean up FTS
    const toDelete = await db
      .prepare(
        `SELECT rowid FROM orchestrator_memories WHERE id IN (
          SELECT id FROM orchestrator_memories WHERE user_id = ?
          ORDER BY relevance ASC, last_accessed_at ASC LIMIT ?
        )`
      )
      .bind(data.userId, excess)
      .all<{ rowid: number }>();

    await db
      .prepare(
        `DELETE FROM orchestrator_memories WHERE id IN (
          SELECT id FROM orchestrator_memories WHERE user_id = ?
          ORDER BY relevance ASC, last_accessed_at ASC LIMIT ?
        )`
      )
      .bind(data.userId, excess)
      .run();

    // Clean up FTS rows
    for (const row of toDelete.results || []) {
      await db
        .prepare('DELETE FROM orchestrator_memories_fts WHERE rowid = ?')
        .bind(row.rowid)
        .run();
    }
  }

  return {
    id: data.id,
    userId: data.userId,
    orgId: 'default',
    category: data.category,
    content: data.content,
    relevance: data.relevance ?? 1.0,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };
}

export async function deleteOrchestratorMemory(db: D1Database, id: string, userId: string): Promise<boolean> {
  // Get rowid before deleting so we can clean up FTS
  const row = await db
    .prepare('SELECT rowid FROM orchestrator_memories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ rowid: number }>();

  const result = await db
    .prepare('DELETE FROM orchestrator_memories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();

  // Clean up FTS index
  if (row && (result.meta?.changes ?? 0) > 0) {
    await db
      .prepare('DELETE FROM orchestrator_memories_fts WHERE rowid = ?')
      .bind(row.rowid)
      .run();
  }

  return (result.meta?.changes ?? 0) > 0;
}

export async function boostMemoryRelevance(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE orchestrator_memories SET relevance = MIN(relevance + 0.1, 2.0), last_accessed_at = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .run();
}

// ─── Orchestrator Session Helpers ───────────────────────────────────────────

export async function getOrchestratorSession(db: D1Database, userId: string): Promise<AgentSession | null> {
  // Look up the active orchestrator session by flag, not by fixed ID.
  // This supports session ID rotation on refresh (new DO instance = fresh code).
  const row = await db.prepare(
    `SELECT * FROM sessions WHERE user_id = ? AND is_orchestrator = 1 AND status NOT IN ('terminated', 'archived', 'error') ORDER BY created_at DESC LIMIT 1`
  ).bind(userId).first();
  if (row) return mapSession(row);
  // Fallback: check for legacy fixed-ID session (may be in terminal state for restart detection)
  const legacyId = `orchestrator:${userId}`;
  return getSession(db, legacyId);
}

/**
 * Find orchestrator sessions stuck in terminal state for longer than `minAgeMinutes`.
 * Only returns one per user, and only if no newer healthy session exists.
 */
export async function getTerminatedOrchestratorSessions(
  db: D1Database,
  minAgeMinutes: number
): Promise<{ userId: string; sessionId: string; identityId: string; name: string; handle: string; customInstructions: string | null }[]> {
  const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const rows = await db.prepare(`
    SELECT s.id as session_id, s.user_id, oi.id as identity_id, oi.name, oi.handle, oi.custom_instructions
    FROM sessions s
    JOIN orchestrator_identities oi ON oi.user_id = s.user_id
    WHERE s.is_orchestrator = 1
      AND s.status IN ('terminated', 'error')
      AND s.last_active_at < ?
      AND NOT EXISTS (
        SELECT 1 FROM sessions s2
        WHERE s2.user_id = s.user_id
          AND s2.is_orchestrator = 1
          AND s2.status NOT IN ('terminated', 'archived', 'error')
      )
    ORDER BY s.created_at DESC
  `).bind(cutoff).all();

  // Deduplicate by user_id (keep the most recent session per user)
  const seen = new Set<string>();
  const result: { userId: string; sessionId: string; identityId: string; name: string; handle: string; customInstructions: string | null }[] = [];
  for (const row of rows.results ?? []) {
    const r = row as any;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    result.push({
      userId: r.user_id,
      sessionId: r.session_id,
      identityId: r.identity_id,
      name: r.name,
      handle: r.handle,
      customInstructions: r.custom_instructions,
    });
  }
  return result;
}
