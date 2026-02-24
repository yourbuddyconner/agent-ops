import type { D1Database } from '@cloudflare/workers-types';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { apiTokens } from '../schema/index.js';

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export async function listApiTokens(db: D1Database, userId: string): Promise<ApiTokenRow[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  return rows as ApiTokenRow[];
}

export async function insertApiToken(
  db: D1Database,
  params: { id: string; userId: string; name: string; tokenHash: string; prefix: string; expiresAt: string | null }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(apiTokens).values({
    id: params.id,
    userId: params.userId,
    name: params.name,
    tokenHash: params.tokenHash,
    prefix: params.prefix,
    createdAt: sql`datetime('now')`,
    expiresAt: params.expiresAt,
  });
}

export async function revokeApiToken(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE api_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .bind(id, userId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}
