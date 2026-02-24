import type { D1Database } from '@cloudflare/workers-types';

export async function createAuthSession(
  db: D1Database,
  data: { id: string; userId: string; tokenHash: string; provider: string; expiresAt: string }
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO auth_sessions (id, user_id, token_hash, provider, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, data.tokenHash, data.provider, data.expiresAt)
    .run();
}

export async function getAuthSessionByTokenHash(
  db: D1Database,
  tokenHash: string
): Promise<{ id: string; email: string } | null> {
  const result = await db
    .prepare(
      `SELECT u.id, u.email
       FROM auth_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ?
         AND s.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<{ id: string; email: string }>();

  if (result) {
    // Update last_used_at
    await db
      .prepare("UPDATE auth_sessions SET last_used_at = datetime('now') WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  return result || null;
}

export async function deleteAuthSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteUserAuthSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}
