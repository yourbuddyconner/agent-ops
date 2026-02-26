import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../../test-utils/db.js';
import { credentials } from '../schema/credentials.js';
import { users } from '../schema/users.js';
import { sql } from 'drizzle-orm';

const TEST_USER_ID = 'user-test-001';
const TEST_EMAIL = 'test@example.com';

describe('credentials DB layer', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;

    // Seed a test user (FK dependency)
    db.insert(users).values({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
    }).run();
  });

  it('inserts and retrieves a credential row', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'enc-data-1',
      scopes: 'repo user',
    }).run();

    const row = db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, TEST_USER_ID), eq(credentials.provider, 'github')))
      .get();

    expect(row).toBeDefined();
    expect(row!.id).toBe('cred-1');
    expect(row!.provider).toBe('github');
    expect(row!.credentialType).toBe('oauth2');
    expect(row!.encryptedData).toBe('enc-data-1');
    expect(row!.scopes).toBe('repo user');
    expect(row!.createdAt).toBeDefined();
    expect(row!.updatedAt).toBeDefined();
  });

  it('upserts on conflict (same user+provider)', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'original',
    }).run();

    db.insert(credentials).values({
      id: 'cred-2',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'updated',
    }).onConflictDoUpdate({
      target: [credentials.userId, credentials.provider],
      set: {
        credentialType: sql`excluded.credential_type`,
        encryptedData: sql`excluded.encrypted_data`,
        updatedAt: sql`datetime('now')`,
      },
    }).run();

    const rows = db.select().from(credentials)
      .where(eq(credentials.userId, TEST_USER_ID))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].encryptedData).toBe('updated');
  });

  it('deletes a credential', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'data',
    }).run();

    db.delete(credentials)
      .where(and(eq(credentials.userId, TEST_USER_ID), eq(credentials.provider, 'github')))
      .run();

    const row = db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, TEST_USER_ID), eq(credentials.provider, 'github')))
      .get();

    expect(row).toBeUndefined();
  });

  it('lists credentials by user', () => {
    db.insert(credentials).values([
      { id: 'cred-1', userId: TEST_USER_ID, provider: 'github', credentialType: 'oauth2', encryptedData: 'a' },
      { id: 'cred-2', userId: TEST_USER_ID, provider: 'google', credentialType: 'oauth2', encryptedData: 'b' },
    ]).run();

    const rows = db
      .select({
        provider: credentials.provider,
        credentialType: credentials.credentialType,
        scopes: credentials.scopes,
        expiresAt: credentials.expiresAt,
        createdAt: credentials.createdAt,
        updatedAt: credentials.updatedAt,
      })
      .from(credentials)
      .where(eq(credentials.userId, TEST_USER_ID))
      .all();

    expect(rows).toHaveLength(2);
    const providers = rows.map((r) => r.provider).sort();
    expect(providers).toEqual(['github', 'google']);
  });

  it('hasCredential returns true when credential exists', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'data',
    }).run();

    const row = db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.userId, TEST_USER_ID), eq(credentials.provider, 'github')))
      .get();

    expect(!!row).toBe(true);
  });

  it('hasCredential returns false when no credential exists', () => {
    const row = db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.userId, TEST_USER_ID), eq(credentials.provider, 'nonexistent')))
      .get();

    expect(!!row).toBe(false);
  });

  it('cascades delete when user is deleted', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'data',
    }).run();

    db.delete(users).where(eq(users.id, TEST_USER_ID)).run();

    const rows = db.select().from(credentials).all();
    expect(rows).toHaveLength(0);
  });

  it('enforces unique constraint on user_id+provider', () => {
    db.insert(credentials).values({
      id: 'cred-1',
      userId: TEST_USER_ID,
      provider: 'github',
      credentialType: 'oauth2',
      encryptedData: 'data-1',
    }).run();

    expect(() => {
      db.insert(credentials).values({
        id: 'cred-2',
        userId: TEST_USER_ID,
        provider: 'github',
        credentialType: 'oauth2',
        encryptedData: 'data-2',
      }).run();
    }).toThrow();
  });
});
