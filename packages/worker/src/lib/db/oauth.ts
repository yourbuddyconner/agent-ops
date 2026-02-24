import type { D1Database } from '@cloudflare/workers-types';
import type { UserCredential } from '@agent-ops/shared';

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
  await db
    .prepare(
      `INSERT INTO oauth_tokens (id, user_id, provider, encrypted_access_token, encrypted_refresh_token, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider)
       DO UPDATE SET
         encrypted_access_token = excluded.encrypted_access_token,
         encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, encrypted_refresh_token),
         scopes = COALESCE(excluded.scopes, scopes),
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`
    )
    .bind(
      data.id,
      data.userId,
      data.provider,
      data.encryptedAccessToken,
      data.encryptedRefreshToken || null,
      data.scopes || null,
      data.expiresAt || null
    )
    .run();
}

export async function getOAuthToken(
  db: D1Database,
  userId: string,
  provider: string
): Promise<{ encryptedAccessToken: string; encryptedRefreshToken: string | null; scopes: string | null } | null> {
  const result = await db
    .prepare('SELECT encrypted_access_token, encrypted_refresh_token, scopes FROM oauth_tokens WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first<{ encrypted_access_token: string; encrypted_refresh_token: string | null; scopes: string | null }>();

  if (!result) return null;
  return {
    encryptedAccessToken: result.encrypted_access_token,
    encryptedRefreshToken: result.encrypted_refresh_token,
    scopes: result.scopes,
  };
}

export async function hasOAuthProvider(db: D1Database, userId: string, provider: string): Promise<boolean> {
  const result = await db
    .prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first();
  return !!result;
}

export async function listUserCredentials(db: D1Database, userId: string): Promise<UserCredential[]> {
  const result = await db.prepare(
    'SELECT id, provider, created_at, updated_at FROM user_credentials WHERE user_id = ? ORDER BY provider'
  ).bind(userId).all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function getUserCredential(db: D1Database, userId: string, provider: string): Promise<{ encryptedKey: string } | null> {
  const row = await db.prepare(
    'SELECT encrypted_key FROM user_credentials WHERE user_id = ? AND provider = ?'
  ).bind(userId, provider).first<{ encrypted_key: string }>();
  return row ? { encryptedKey: row.encrypted_key } : null;
}

export async function setUserCredential(
  db: D1Database,
  params: { id: string; userId: string; provider: string; encryptedKey: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO user_credentials (id, user_id, provider, encrypted_key)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       updated_at = datetime('now')`
  ).bind(params.id, params.userId, params.provider, params.encryptedKey).run();
}

export async function deleteUserCredential(db: D1Database, userId: string, provider: string): Promise<void> {
  await db.prepare('DELETE FROM user_credentials WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
}
