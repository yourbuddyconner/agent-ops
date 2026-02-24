import type { D1Database } from '@cloudflare/workers-types';
import type { OrchestratorIdentity, OrchestratorMemory, OrchestratorMemoryCategory, AgentSession } from '@agent-ops/shared';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { orchestratorIdentities, orchestratorMemories } from '../schema/index.js';
import { getSession } from './sessions.js';

function mapSessionRow(row: any): AgentSession {
  return {
    id: row.id,
    userId: row.user_id,
    workspace: row.workspace,
    status: row.status,
    title: row.title || undefined,
    parentSessionId: row.parent_session_id || undefined,
    containerId: row.container_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    errorMessage: row.error_message || undefined,
    personaId: row.persona_id || undefined,
    personaName: row.persona_name || undefined,
    isOrchestrator: !!row.is_orchestrator || undefined,
    purpose: row.purpose || 'interactive',
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

const MEMORY_CAP = 200;

// ─── Row-to-Domain Converters ───────────────────────────────────────────────

function rowToIdentity(row: typeof orchestratorIdentities.$inferSelect): OrchestratorIdentity {
  return {
    id: row.id,
    userId: row.userId || undefined,
    orgId: row.orgId,
    type: row.type as OrchestratorIdentity['type'],
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.customInstructions || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMemory(row: typeof orchestratorMemories.$inferSelect): OrchestratorMemory {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    category: row.category as OrchestratorMemoryCategory,
    content: row.content,
    relevance: row.relevance,
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt,
  };
}

// ─── Orchestrator Identity Operations ───────────────────────────────────────

export async function getOrchestratorIdentity(db: D1Database, userId: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(orchestratorIdentities)
    .where(and(eq(orchestratorIdentities.userId, userId), eq(orchestratorIdentities.orgId, orgId)))
    .get();
  return row ? rowToIdentity(row) : null;
}

export async function getOrchestratorIdentityByHandle(db: D1Database, handle: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(orchestratorIdentities)
    .where(and(eq(orchestratorIdentities.handle, handle), eq(orchestratorIdentities.orgId, orgId)))
    .get();
  return row ? rowToIdentity(row) : null;
}

export async function createOrchestratorIdentity(
  db: D1Database,
  data: { id: string; userId: string; name: string; handle: string; avatar?: string; customInstructions?: string; orgId?: string }
): Promise<OrchestratorIdentity> {
  const drizzle = getDb(db);
  const orgId = data.orgId || 'default';

  await drizzle.insert(orchestratorIdentities).values({
    id: data.id,
    userId: data.userId,
    orgId,
    type: 'personal',
    name: data.name,
    handle: data.handle,
    avatar: data.avatar || null,
    customInstructions: data.customInstructions || null,
  });

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

// Raw SQL: dynamic SET clauses
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

// Raw SQL: FTS5 MATCH + bm25() ranking (FTS path); plain path delegates to Drizzle
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
    return (result.results || []).map((row: any) => rowToMemory(row as typeof orchestratorMemories.$inferSelect));
  }

  return listOrchestratorMemoriesPlain(db, userId, options.category, limit);
}

async function listOrchestratorMemoriesPlain(
  db: D1Database,
  userId: string,
  category?: string,
  limit: number = 50,
): Promise<OrchestratorMemory[]> {
  const drizzle = getDb(db);
  const conditions = [eq(orchestratorMemories.userId, userId)];

  if (category) {
    conditions.push(eq(orchestratorMemories.category, category));
  }

  const rows = await drizzle
    .select()
    .from(orchestratorMemories)
    .where(and(...conditions))
    .orderBy(desc(orchestratorMemories.relevance), desc(orchestratorMemories.lastAccessedAt))
    .limit(limit);

  return rows.map(rowToMemory);
}

// Raw SQL: FTS5 INSERT sync, rowid queries, prune logic
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

// Raw SQL: FTS5 cleanup after DELETE
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

// Raw SQL: UPDATE with MIN() expression
export async function boostMemoryRelevance(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE orchestrator_memories SET relevance = MIN(relevance + 0.1, 2.0), last_accessed_at = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .run();
}

// ─── Orchestrator Session Helpers ───────────────────────────────────────────

// Raw SQL: uses mapSession for snake_case row mapping + fallback to getSession
export async function getOrchestratorSession(db: D1Database, userId: string): Promise<AgentSession | null> {
  // Look up the active orchestrator session by flag, not by fixed ID.
  // This supports session ID rotation on refresh (new DO instance = fresh code).
  const row = await db.prepare(
    `SELECT * FROM sessions WHERE user_id = ? AND is_orchestrator = 1 AND status NOT IN ('terminated', 'archived', 'error') ORDER BY created_at DESC LIMIT 1`
  ).bind(userId).first();
  if (row) return mapSessionRow(row);
  // Fallback: check for legacy fixed-ID session (may be in terminal state for restart detection)
  const legacyId = `orchestrator:${userId}`;
  return getSession(db, legacyId);
}

// Raw SQL: NOT EXISTS subquery + JOIN
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
