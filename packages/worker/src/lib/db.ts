import type { D1Database } from '@cloudflare/workers-types';
import type { AgentSession, Integration, Message, User, SyncStatusResponse } from '@agent-ops/shared';

/**
 * Database helper functions for D1
 */

// User operations
export async function getOrCreateUser(
  db: D1Database,
  data: { id: string; email: string; name?: string; avatarUrl?: string }
): Promise<User> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(data.id)
    .first<User>();

  if (existing) {
    return existing;
  }

  await db
    .prepare('INSERT INTO users (id, email, name, avatar_url) VALUES (?, ?, ?, ?)')
    .bind(data.id, data.email, data.name || null, data.avatarUrl || null)
    .run();

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatarUrl,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Session operations
export async function createSession(
  db: D1Database,
  data: { id: string; userId: string; workspace: string; containerId?: string; metadata?: Record<string, unknown> }
): Promise<AgentSession> {
  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, workspace, status, container_id, metadata) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(
      data.id,
      data.userId,
      data.workspace,
      'initializing',
      data.containerId || null,
      data.metadata ? JSON.stringify(data.metadata) : null
    )
    .run();

  return {
    id: data.id,
    userId: data.userId,
    workspace: data.workspace,
    status: 'initializing',
    containerId: data.containerId,
    metadata: data.metadata,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };
}

export async function getSession(db: D1Database, id: string): Promise<AgentSession | null> {
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  return row ? mapSession(row) : null;
}

export async function getUserSessions(
  db: D1Database,
  userId: string,
  options: { limit?: number; cursor?: string; status?: string } = {}
): Promise<{ sessions: AgentSession[]; cursor?: string; hasMore: boolean }> {
  const limit = options.limit || 20;
  let query = 'SELECT * FROM sessions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (options.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  if (options.cursor) {
    query += ' AND created_at < ?';
    params.push(options.cursor);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const stmt = db.prepare(query);
  const result = await stmt.bind(...params).all();
  const rows = result.results || [];

  const hasMore = rows.length > limit;
  const sessions = rows.slice(0, limit).map(mapSession);

  return {
    sessions,
    cursor: hasMore ? sessions[sessions.length - 1].createdAt.toISOString() : undefined,
    hasMore,
  };
}

export async function updateSessionStatus(
  db: D1Database,
  id: string,
  status: AgentSession['status'],
  containerId?: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE sessions SET status = ?, container_id = COALESCE(?, container_id), last_active_at = datetime(\'now\') WHERE id = ?'
    )
    .bind(status, containerId || null, id)
    .run();
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

// Integration operations
export async function createIntegration(
  db: D1Database,
  data: { id: string; userId: string; service: string; config: Record<string, unknown> }
): Promise<Integration> {
  await db
    .prepare('INSERT INTO integrations (id, user_id, service, config, status) VALUES (?, ?, ?, ?, ?)')
    .bind(data.id, data.userId, data.service, JSON.stringify(data.config), 'pending')
    .run();

  return {
    id: data.id,
    userId: data.userId,
    service: data.service as Integration['service'],
    config: data.config as unknown as Integration['config'],
    status: 'pending',
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getIntegration(db: D1Database, id: string): Promise<Integration | null> {
  const row = await db.prepare('SELECT * FROM integrations WHERE id = ?').bind(id).first();
  return row ? mapIntegration(row) : null;
}

export async function getUserIntegrations(db: D1Database, userId: string): Promise<Integration[]> {
  const result = await db
    .prepare('SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (result.results || []).map(mapIntegration);
}

export async function updateIntegrationStatus(
  db: D1Database,
  id: string,
  status: Integration['status'],
  errorMessage?: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE integrations SET status = ?, error_message = ?, updated_at = datetime(\'now\') WHERE id = ?'
    )
    .bind(status, errorMessage || null, id)
    .run();
}

export async function updateIntegrationSyncTime(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE integrations SET last_synced_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .bind(id)
    .run();
}

export async function deleteIntegration(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM integrations WHERE id = ?').bind(id).run();
}

// Sync log operations
export async function createSyncLog(
  db: D1Database,
  data: { id: string; integrationId: string }
): Promise<SyncStatusResponse> {
  await db
    .prepare('INSERT INTO sync_logs (id, integration_id, status) VALUES (?, ?, ?)')
    .bind(data.id, data.integrationId, 'pending')
    .run();

  return {
    id: data.id,
    integrationId: data.integrationId,
    status: 'pending',
    startedAt: new Date(),
  };
}

export async function updateSyncLog(
  db: D1Database,
  id: string,
  data: { status: string; recordsSynced?: number; errors?: unknown[] }
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_logs SET
        status = ?,
        records_synced = COALESCE(?, records_synced),
        errors = ?,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN datetime('now') ELSE completed_at END
      WHERE id = ?`
    )
    .bind(
      data.status,
      data.recordsSynced ?? null,
      data.errors ? JSON.stringify(data.errors) : null,
      data.status,
      id
    )
    .run();
}

export async function getSyncLog(db: D1Database, id: string): Promise<SyncStatusResponse | null> {
  const row = await db.prepare('SELECT * FROM sync_logs WHERE id = ?').bind(id).first();
  return row ? mapSyncLog(row) : null;
}

// Message operations
export async function saveMessage(
  db: D1Database,
  data: { id: string; sessionId: string; role: string; content: string; toolCalls?: unknown[] }
): Promise<void> {
  await db
    .prepare('INSERT INTO messages (id, session_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)')
    .bind(data.id, data.sessionId, data.role, data.content, data.toolCalls ? JSON.stringify(data.toolCalls) : null)
    .run();
}

export async function getSessionMessages(
  db: D1Database,
  sessionId: string,
  options: { limit?: number; after?: string } = {}
): Promise<Message[]> {
  const limit = options.limit || 100;
  let query = 'SELECT * FROM messages WHERE session_id = ?';
  const params: (string | number)[] = [sessionId];

  if (options.after) {
    query += ' AND created_at > ?';
    params.push(options.after);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return (result.results || []).map(mapMessage);
}

// Synced entity operations
export async function upsertSyncedEntity(
  db: D1Database,
  data: { integrationId: string; entityType: string; externalId: string; data: unknown }
): Promise<void> {
  const id = `${data.integrationId}:${data.entityType}:${data.externalId}`;
  await db
    .prepare(
      `INSERT INTO synced_entities (id, integration_id, entity_type, external_id, data, synced_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(integration_id, entity_type, external_id)
       DO UPDATE SET data = excluded.data, synced_at = datetime('now')`
    )
    .bind(id, data.integrationId, data.entityType, data.externalId, JSON.stringify(data.data))
    .run();
}

export async function getSyncedEntities(
  db: D1Database,
  integrationId: string,
  entityType: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ entities: unknown[]; cursor?: string; hasMore: boolean }> {
  const limit = options.limit || 100;
  let query = 'SELECT * FROM synced_entities WHERE integration_id = ? AND entity_type = ?';
  const params: (string | number)[] = [integrationId, entityType];

  if (options.cursor) {
    query += ' AND external_id > ?';
    params.push(options.cursor);
  }

  query += ' ORDER BY external_id ASC LIMIT ?';
  params.push(limit + 1);

  const result = await db.prepare(query).bind(...params).all();
  const rows = result.results || [];

  const hasMore = rows.length > limit;
  const entities = rows.slice(0, limit).map((row: any) => ({
    id: row.external_id,
    ...JSON.parse(row.data as string),
  }));

  return {
    entities,
    cursor: hasMore ? (rows[limit - 1] as any).external_id : undefined,
    hasMore,
  };
}

// Mapping helpers
function mapSession(row: any): AgentSession {
  return {
    id: row.id,
    userId: row.user_id,
    workspace: row.workspace,
    status: row.status,
    containerId: row.container_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

function mapIntegration(row: any): Integration {
  return {
    id: row.id,
    userId: row.user_id,
    service: row.service,
    config: JSON.parse(row.config),
    status: row.status,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    createdAt: new Date(row.created_at),
  };
}

function mapSyncLog(row: any): SyncStatusResponse {
  return {
    id: row.id,
    integrationId: row.integration_id,
    status: row.status,
    progress: row.records_synced,
    result: row.completed_at
      ? {
          success: row.status === 'completed',
          recordsSynced: row.records_synced || 0,
          errors: row.errors ? JSON.parse(row.errors) : [],
          completedAt: new Date(row.completed_at),
        }
      : undefined,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}
