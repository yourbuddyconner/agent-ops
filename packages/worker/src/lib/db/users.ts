import type { D1Database } from '@cloudflare/workers-types';
import type { User, UserRole, QueueMode } from '@agent-ops/shared';
import { mapUser } from './mappers.js';

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
    role: 'member' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function findUserByGitHubId(db: D1Database, githubId: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return row ? mapUser(row) : null;
}

export async function updateUserGitHub(
  db: D1Database,
  userId: string,
  data: { githubId: string; githubUsername: string; name?: string; avatarUrl?: string }
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET github_id = ?, github_username = ?, name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(data.githubId, data.githubUsername, data.name || null, data.avatarUrl || null, userId)
    .run();
}

export async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return row ? mapUser(row) : null;
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  data: {
    name?: string;
    gitName?: string;
    gitEmail?: string;
    onboardingCompleted?: boolean;
    idleTimeoutSeconds?: number;
    modelPreferences?: string[];
    uiQueueMode?: QueueMode;
  },
): Promise<User | null> {
  await db
    .prepare(
      "UPDATE users SET name = COALESCE(?, name), git_name = COALESCE(?, git_name), git_email = COALESCE(?, git_email), onboarding_completed = COALESCE(?, onboarding_completed), idle_timeout_seconds = COALESCE(?, idle_timeout_seconds), model_preferences = COALESCE(?, model_preferences), ui_queue_mode = COALESCE(?, ui_queue_mode), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(
      data.name ?? null,
      data.gitName ?? null,
      data.gitEmail ?? null,
      data.onboardingCompleted !== undefined ? (data.onboardingCompleted ? 1 : 0) : null,
      data.idleTimeoutSeconds ?? null,
      data.modelPreferences !== undefined ? JSON.stringify(data.modelPreferences) : null,
      data.uiQueueMode ?? null,
      userId,
    )
    .run();

  return getUserById(db, userId);
}

export async function backfillGitConfig(
  db: D1Database,
  userId: string,
  data: { gitName?: string; gitEmail?: string }
): Promise<User | null> {
  const sets: string[] = [];
  const binds: (string | null)[] = [];

  if (data.gitName) {
    sets.push('git_name = COALESCE(git_name, ?)');
    binds.push(data.gitName);
  }
  if (data.gitEmail) {
    sets.push('git_email = COALESCE(git_email, ?)');
    binds.push(data.gitEmail);
  }

  if (sets.length === 0) return getUserById(db, userId);

  sets.push("updated_at = datetime('now')");
  binds.push(userId);

  await db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return getUserById(db, userId);
}

export async function updateUserRole(db: D1Database, userId: string, role: UserRole): Promise<void> {
  await db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").bind(role, userId).run();
}

export async function getUserCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare('SELECT * FROM users ORDER BY created_at').all();
  return (result.results || []).map(mapUser);
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}
