import type { AppDb } from '../drizzle.js';
import { eq, and, sql } from 'drizzle-orm';
import { credentials } from '../schema/index.js';

export interface CredentialRow {
  id: string;
  userId: string;
  provider: string;
  credentialType: string;
  encryptedData: string;
  scopes: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getCredentialRow(
  db: AppDb,
  userId: string,
  provider: string,
): Promise<CredentialRow | null> {
  const row = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)))
    .get();
  return (row as CredentialRow | undefined) ?? null;
}

export async function upsertCredential(
  db: AppDb,
  data: {
    id: string;
    userId: string;
    provider: string;
    credentialType: string;
    encryptedData: string;
    scopes?: string | null;
    expiresAt?: string | null;
  },
): Promise<void> {
  await db
    .insert(credentials)
    .values({
      id: data.id,
      userId: data.userId,
      provider: data.provider,
      credentialType: data.credentialType,
      encryptedData: data.encryptedData,
      scopes: data.scopes ?? null,
      expiresAt: data.expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.provider],
      set: {
        credentialType: sql`excluded.credential_type`,
        encryptedData: sql`excluded.encrypted_data`,
        scopes: sql`COALESCE(excluded.scopes, ${credentials.scopes})`,
        expiresAt: sql`excluded.expires_at`,
        updatedAt: sql`datetime('now')`,
      },
    });
}

export async function deleteCredential(
  db: AppDb,
  userId: string,
  provider: string,
): Promise<void> {
  await db
    .delete(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)));
}

export async function listCredentialsByUser(
  db: AppDb,
  userId: string,
): Promise<Array<{
  provider: string;
  credentialType: string;
  scopes: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>> {
  return db
    .select({
      provider: credentials.provider,
      credentialType: credentials.credentialType,
      scopes: credentials.scopes,
      expiresAt: credentials.expiresAt,
      createdAt: credentials.createdAt,
      updatedAt: credentials.updatedAt,
    })
    .from(credentials)
    .where(eq(credentials.userId, userId));
}

export async function hasCredential(
  db: AppDb,
  userId: string,
  provider: string,
): Promise<boolean> {
  const row = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)))
    .get();
  return !!row;
}
