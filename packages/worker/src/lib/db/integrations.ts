import type { D1Database } from '@cloudflare/workers-types';
import type { Integration, SyncStatusResponse } from '@agent-ops/shared';
import { eq, and, ne, desc, gt, sql, asc } from 'drizzle-orm';
import { getDb, toDate } from '../drizzle.js';
import { integrations, syncLogs, syncedEntities } from '../schema/index.js';

function rowToIntegration(row: typeof integrations.$inferSelect): Integration {
  return {
    id: row.id,
    userId: row.userId,
    service: row.service as Integration['service'],
    config: row.config as Integration['config'],
    status: row.status as Integration['status'],
    scope: (row.scope as 'user' | 'org') || 'user',
    lastSyncedAt: row.lastSyncedAt ? toDate(row.lastSyncedAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export async function createIntegration(
  db: D1Database,
  data: { id: string; userId: string; service: string; config: Record<string, unknown> }
): Promise<Integration> {
  const drizzle = getDb(db);
  await drizzle.insert(integrations).values({
    id: data.id,
    userId: data.userId,
    service: data.service,
    config: data.config as unknown as Integration['config'],
    status: 'pending',
  });

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
  const drizzle = getDb(db);
  const row = await drizzle.select().from(integrations).where(eq(integrations.id, id)).get();
  return row ? rowToIntegration(row) : null;
}

export async function getOrgIntegrations(db: D1Database, excludeUserId: string): Promise<Array<{
  id: string;
  service: string;
  status: string;
  scope: 'org';
  config: Record<string, unknown>;
  lastSyncedAt: Date | null;
  createdAt: Date;
}>> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(integrations)
    .where(and(eq(integrations.scope, 'org'), ne(integrations.userId, excludeUserId)))
    .orderBy(desc(integrations.createdAt));

  return rows.map((row) => ({
    id: row.id,
    service: row.service,
    status: row.status,
    scope: 'org' as const,
    config: row.config as Record<string, unknown>,
    lastSyncedAt: row.lastSyncedAt ? toDate(row.lastSyncedAt) : null,
    createdAt: toDate(row.createdAt),
  }));
}

export async function getUserIntegrations(db: D1Database, userId: string): Promise<Integration[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(integrations)
    .where(eq(integrations.userId, userId))
    .orderBy(desc(integrations.createdAt));
  return rows.map(rowToIntegration);
}

export async function updateIntegrationStatus(
  db: D1Database,
  id: string,
  status: Integration['status'],
  errorMessage?: string
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(integrations)
    .set({
      status,
      errorMessage: errorMessage || null,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(integrations.id, id));
}

export async function updateIntegrationSyncTime(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(integrations)
    .set({
      lastSyncedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(integrations.id, id));
}

export async function deleteIntegration(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(integrations).where(eq(integrations.id, id));
}

// Sync log operations
export async function createSyncLog(
  db: D1Database,
  data: { id: string; integrationId: string }
): Promise<SyncStatusResponse> {
  const drizzle = getDb(db);
  await drizzle.insert(syncLogs).values({
    id: data.id,
    integrationId: data.integrationId,
    status: 'pending',
  });

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
  // CASE expression for conditional completed_at — keep as raw SQL
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
  const drizzle = getDb(db);
  const row = await drizzle.select().from(syncLogs).where(eq(syncLogs.id, id)).get();
  if (!row) return null;

  return {
    id: row.id,
    integrationId: row.integrationId,
    status: row.status as SyncStatusResponse['status'],
    progress: row.recordsSynced ?? undefined,
    result: row.completedAt
      ? {
          success: row.status === 'completed',
          recordsSynced: row.recordsSynced || 0,
          errors: (row.errors as Array<{ entity: string; entityId?: string; message: string; code: string }>) || [],
          completedAt: toDate(row.completedAt),
        }
      : undefined,
    startedAt: toDate(row.startedAt),
    completedAt: row.completedAt ? toDate(row.completedAt) : undefined,
  };
}

// Synced entity operations
export async function upsertSyncedEntity(
  db: D1Database,
  data: { integrationId: string; entityType: string; externalId: string; data: unknown }
): Promise<void> {
  const id = `${data.integrationId}:${data.entityType}:${data.externalId}`;
  const drizzle = getDb(db);
  await drizzle.insert(syncedEntities).values({
    id,
    integrationId: data.integrationId,
    entityType: data.entityType,
    externalId: data.externalId,
    data: JSON.stringify(data.data),
    syncedAt: sql`datetime('now')`,
  }).onConflictDoUpdate({
    target: [syncedEntities.integrationId, syncedEntities.entityType, syncedEntities.externalId],
    set: {
      data: sql`excluded.data`,
      syncedAt: sql`datetime('now')`,
    },
  });
}

export async function getSyncedEntities(
  db: D1Database,
  integrationId: string,
  entityType: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ entities: unknown[]; cursor?: string; hasMore: boolean }> {
  const limit = options.limit || 100;
  const drizzle = getDb(db);

  const conditions = [
    eq(syncedEntities.integrationId, integrationId),
    eq(syncedEntities.entityType, entityType),
  ];
  if (options.cursor) {
    conditions.push(gt(syncedEntities.externalId, options.cursor));
  }

  const rows = await drizzle
    .select()
    .from(syncedEntities)
    .where(and(...conditions))
    .orderBy(asc(syncedEntities.externalId))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const entities = rows.slice(0, limit).map((row) => ({
    id: row.externalId,
    ...JSON.parse(row.data),
  }));

  return {
    entities,
    cursor: hasMore ? rows[limit - 1].externalId : undefined,
    hasMore,
  };
}
