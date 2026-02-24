import type { D1Database } from '@cloudflare/workers-types';
import type { UserCredential } from '@agent-ops/shared';
import { eq, and, sql, asc } from 'drizzle-orm';
import { getDb, toDate } from '../drizzle.js';
import { oauthTokens, userCredentials } from '../schema/index.js';

export async function upsertOAuthToken(
  db: D1Database,
  data: {
    id: string;
    userId: string;
    provider: string;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string;
    scopes?: string;
    expiresAt?: string;
  }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(oauthTokens).values({
    id: data.id,
    userId: data.userId,
    provider: data.provider,
    encryptedAccessToken: data.encryptedAccessToken,
    encryptedRefreshToken: data.encryptedRefreshToken || null,
    scopes: data.scopes || null,
    expiresAt: data.expiresAt || null,
  }).onConflictDoUpdate({
    target: [oauthTokens.userId, oauthTokens.provider],
    set: {
      encryptedAccessToken: sql`excluded.encrypted_access_token`,
      encryptedRefreshToken: sql`COALESCE(excluded.encrypted_refresh_token, ${oauthTokens.encryptedRefreshToken})`,
      scopes: sql`COALESCE(excluded.scopes, ${oauthTokens.scopes})`,
      expiresAt: sql`excluded.expires_at`,
      updatedAt: sql`datetime('now')`,
    },
  });
}

export async function getOAuthToken(
  db: D1Database,
  userId: string,
  provider: string
): Promise<{ encryptedAccessToken: string; encryptedRefreshToken: string | null; scopes: string | null } | null> {
  const drizzle = getDb(db);
  const result = await drizzle
    .select({
      encryptedAccessToken: oauthTokens.encryptedAccessToken,
      encryptedRefreshToken: oauthTokens.encryptedRefreshToken,
      scopes: oauthTokens.scopes,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
    .get();

  return result || null;
}

export async function hasOAuthProvider(db: D1Database, userId: string, provider: string): Promise<boolean> {
  const drizzle = getDb(db);
  const result = await drizzle
    .select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
    .get();
  return !!result;
}

export async function listUserCredentials(db: D1Database, userId: string): Promise<UserCredential[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select({
      id: userCredentials.id,
      provider: userCredentials.provider,
      createdAt: userCredentials.createdAt,
      updatedAt: userCredentials.updatedAt,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .orderBy(asc(userCredentials.provider));

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  }));
}

export async function getUserCredential(db: D1Database, userId: string, provider: string): Promise<{ encryptedKey: string } | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ encryptedKey: userCredentials.encryptedKey })
    .from(userCredentials)
    .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, provider)))
    .get();
  return row || null;
}

export async function setUserCredential(
  db: D1Database,
  params: { id: string; userId: string; provider: string; encryptedKey: string }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.insert(userCredentials).values({
    id: params.id,
    userId: params.userId,
    provider: params.provider,
    encryptedKey: params.encryptedKey,
  }).onConflictDoUpdate({
    target: [userCredentials.userId, userCredentials.provider],
    set: {
      encryptedKey: sql`excluded.encrypted_key`,
      updatedAt: sql`datetime('now')`,
    },
  });
}

export async function deleteUserCredential(db: D1Database, userId: string, provider: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(userCredentials).where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, provider)));
}
