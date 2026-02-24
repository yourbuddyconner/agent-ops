import type { D1Database } from '@cloudflare/workers-types';
import type { Integration, SyncStatusResponse } from '@agent-ops/shared';
import { mapIntegration, mapSyncLog } from './mappers.js';

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
    scope: 'user' as const,
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
