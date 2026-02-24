import type { D1Database } from '@cloudflare/workers-types';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { authSessions, users, invites } from '../schema/index.js';

export async function createAuthSession(
  db: D1Database,
  data: { id: string; userId: string; tokenHash: string; provider: string; expiresAt: string }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(authSessions).values({
    id: data.id,
    userId: data.userId,
    tokenHash: data.tokenHash,
    provider: data.provider,
    expiresAt: data.expiresAt,
  });
}

export async function getAuthSessionByTokenHash(
  db: D1Database,
  tokenHash: string
): Promise<{ id: string; email: string } | null> {
  const drizzle = getDb(db);
  const result = await drizzle
    .select({ id: users.id, email: users.email })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, sql`datetime('now')`)))
    .get();

  if (result) {
    await drizzle
      .update(authSessions)
      .set({ lastUsedAt: sql`datetime('now')` })
      .where(eq(authSessions.tokenHash, tokenHash));
  }

  return result || null;
}

export async function deleteAuthSession(db: D1Database, tokenHash: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

export async function deleteUserAuthSessions(db: D1Database, userId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(authSessions).where(eq(authSessions.userId, userId));
}

export async function getValidInviteByCode(
  db: D1Database,
  code: string
): Promise<{ id: string } | null> {
  const drizzle = getDb(db);
  const result = await drizzle
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.code, code), isNull(invites.acceptedAt), gt(invites.expiresAt, sql`datetime('now')`)))
    .get();
  return result || null;
}

export async function getValidInviteByEmail(
  db: D1Database,
  email: string
): Promise<{ id: string } | null> {
  const drizzle = getDb(db);
  const result = await drizzle
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, email), isNull(invites.acceptedAt), gt(invites.expiresAt, sql`datetime('now')`)))
    .get();
  return result || null;
}
