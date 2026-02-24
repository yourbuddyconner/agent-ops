import type { D1Database } from '@cloudflare/workers-types';
import type { User, UserRole, QueueMode } from '@agent-ops/shared';
import { eq, sql, asc, inArray } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { toDate } from '../drizzle.js';
import { users } from '../schema/index.js';

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name || undefined,
    avatarUrl: row.avatarUrl || undefined,
    githubId: row.githubId || undefined,
    githubUsername: row.githubUsername || undefined,
    gitName: row.gitName || undefined,
    gitEmail: row.gitEmail || undefined,
    onboardingCompleted: !!row.onboardingCompleted,
    idleTimeoutSeconds: row.idleTimeoutSeconds ?? 900,
    modelPreferences: row.modelPreferences || undefined,
    uiQueueMode: (row.uiQueueMode as QueueMode) || 'followup',
    role: (row.role as UserRole) || 'member',
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export async function getOrCreateUser(
  db: D1Database,
  data: { id: string; email: string; name?: string; avatarUrl?: string }
): Promise<User> {
  const drizzle = getDb(db);
  const existing = await drizzle.select().from(users).where(eq(users.id, data.id)).get();

  if (existing) {
    return rowToUser(existing);
  }

  await drizzle.insert(users).values({
    id: data.id,
    email: data.email,
    name: data.name || null,
    avatarUrl: data.avatarUrl || null,
  });

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
  const drizzle = getDb(db);
  const row = await drizzle.select().from(users).where(eq(users.githubId, githubId)).get();
  return row ? rowToUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(users).where(eq(users.email, email)).get();
  return row ? rowToUser(row) : null;
}

export async function updateUserGitHub(
  db: D1Database,
  userId: string,
  data: { githubId: string; githubUsername: string; name?: string; avatarUrl?: string }
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(users)
    .set({
      githubId: data.githubId,
      githubUsername: data.githubUsername,
      name: sql`COALESCE(${data.name || null}, ${users.name})`,
      avatarUrl: sql`COALESCE(${data.avatarUrl || null}, ${users.avatarUrl})`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(users.id, userId));
}

export async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(users).where(eq(users.id, userId)).get();
  return row ? rowToUser(row) : null;
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
  const drizzle = getDb(db);
  await drizzle
    .update(users)
    .set({ role, updatedAt: sql`datetime('now')` })
    .where(eq(users.id, userId));
}

export async function getUserCount(db: D1Database): Promise<number> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ count: sql<number>`COUNT(*)` })
    .from(users)
    .get();
  return row?.count ?? 0;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const drizzle = getDb(db);
  const rows = await drizzle.select().from(users).orderBy(asc(users.createdAt));
  return rows.map(rowToUser);
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(users).where(eq(users.id, userId));
}

// ─── DO Helpers ──────────────────────────────────────────────────────────────

export async function getUserIdleTimeout(db: D1Database, userId: string): Promise<number> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ idleTimeoutSeconds: users.idleTimeoutSeconds })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.idleTimeoutSeconds ?? 900;
}

export async function getUserGitConfig(
  db: D1Database,
  userId: string,
): Promise<{
  name: string | null;
  email: string | null;
  githubUsername: string | null;
  gitName: string | null;
  gitEmail: string | null;
} | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({
      name: users.name,
      email: users.email,
      githubUsername: users.githubUsername,
      gitName: users.gitName,
      gitEmail: users.gitEmail,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row || null;
}

export async function getUsersByIds(db: D1Database, userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  const drizzle = getDb(db);
  const rows = await drizzle.select().from(users).where(inArray(users.id, userIds));
  return rows.map(rowToUser);
}

export async function getUserDiscoveredModels(
  db: D1Database,
  userId: string,
): Promise<unknown[] | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ discoveredModels: users.discoveredModels })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row?.discoveredModels) return null;
  const parsed = row.discoveredModels;
  return Array.isArray(parsed) ? parsed : null;
}

export async function updateUserDiscoveredModels(
  db: D1Database,
  userId: string,
  modelsJson: string,
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(users)
    .set({ discoveredModels: sql`${modelsJson}` })
    .where(eq(users.id, userId));
}
