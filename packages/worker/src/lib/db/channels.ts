import type { D1Database } from '@cloudflare/workers-types';
import type { UserIdentityLink, ChannelBinding, ChannelType, QueueMode } from '@agent-ops/shared';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { userIdentityLinks, channelBindings } from '../schema/index.js';

function rowToIdentityLink(row: typeof userIdentityLinks.$inferSelect): UserIdentityLink {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    externalId: row.externalId,
    externalName: row.externalName || undefined,
    teamId: row.teamId || undefined,
    createdAt: row.createdAt,
  };
}

function rowToChannelBinding(row: typeof channelBindings.$inferSelect): ChannelBinding {
  return {
    id: row.id,
    sessionId: row.sessionId,
    channelType: row.channelType as ChannelType,
    channelId: row.channelId,
    scopeKey: row.scopeKey,
    userId: row.userId || undefined,
    orgId: row.orgId,
    queueMode: row.queueMode as QueueMode,
    collectDebounceMs: row.collectDebounceMs ?? 3000,
    slackChannelId: row.slackChannelId || undefined,
    slackThreadTs: row.slackThreadTs || undefined,
    githubRepoFullName: row.githubRepoFullName || undefined,
    githubPrNumber: row.githubPrNumber ?? undefined,
    createdAt: row.createdAt,
  };
}

// Identity Links

export async function createIdentityLink(
  db: D1Database,
  data: { id: string; userId: string; provider: string; externalId: string; externalName?: string; teamId?: string },
): Promise<UserIdentityLink> {
  const drizzle = getDb(db);
  await drizzle.insert(userIdentityLinks).values({
    id: data.id,
    userId: data.userId,
    provider: data.provider,
    externalId: data.externalId,
    externalName: data.externalName || null,
    teamId: data.teamId || null,
  });

  return {
    id: data.id,
    userId: data.userId,
    provider: data.provider,
    externalId: data.externalId,
    externalName: data.externalName,
    teamId: data.teamId,
    createdAt: new Date().toISOString(),
  };
}

export async function getUserIdentityLinks(db: D1Database, userId: string): Promise<UserIdentityLink[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(userIdentityLinks)
    .where(eq(userIdentityLinks.userId, userId))
    .orderBy(desc(userIdentityLinks.createdAt));
  return rows.map(rowToIdentityLink);
}

export async function deleteIdentityLink(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM user_identity_links WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function resolveUserByExternalId(
  db: D1Database,
  provider: string,
  externalId: string,
): Promise<string | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({ userId: userIdentityLinks.userId })
    .from(userIdentityLinks)
    .where(and(eq(userIdentityLinks.provider, provider), eq(userIdentityLinks.externalId, externalId)))
    .get();
  return row?.userId || null;
}

// Channel Bindings

export async function createChannelBinding(
  db: D1Database,
  data: {
    id: string;
    sessionId: string;
    channelType: ChannelType;
    channelId: string;
    scopeKey: string;
    userId?: string;
    orgId: string;
    queueMode?: QueueMode;
    collectDebounceMs?: number;
    slackChannelId?: string;
    slackThreadTs?: string;
    githubRepoFullName?: string;
    githubPrNumber?: number;
  },
): Promise<ChannelBinding> {
  const queueMode = data.queueMode || 'followup';
  const collectDebounceMs = data.collectDebounceMs ?? 3000;
  const drizzle = getDb(db);

  await drizzle.insert(channelBindings).values({
    id: data.id,
    sessionId: data.sessionId,
    channelType: data.channelType,
    channelId: data.channelId,
    scopeKey: data.scopeKey,
    userId: data.userId || null,
    orgId: data.orgId,
    queueMode,
    collectDebounceMs,
    slackChannelId: data.slackChannelId || null,
    slackThreadTs: data.slackThreadTs || null,
    githubRepoFullName: data.githubRepoFullName || null,
    githubPrNumber: data.githubPrNumber ?? null,
  });

  return {
    id: data.id,
    sessionId: data.sessionId,
    channelType: data.channelType,
    channelId: data.channelId,
    scopeKey: data.scopeKey,
    userId: data.userId,
    orgId: data.orgId,
    queueMode,
    collectDebounceMs,
    slackChannelId: data.slackChannelId,
    slackThreadTs: data.slackThreadTs,
    githubRepoFullName: data.githubRepoFullName,
    githubPrNumber: data.githubPrNumber,
    createdAt: new Date().toISOString(),
  };
}

export async function getChannelBindingByScopeKey(db: D1Database, scopeKey: string): Promise<ChannelBinding | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(channelBindings)
    .where(eq(channelBindings.scopeKey, scopeKey))
    .get();
  return row ? rowToChannelBinding(row) : null;
}

export async function getSessionChannelBindings(db: D1Database, sessionId: string): Promise<ChannelBinding[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(channelBindings)
    .where(eq(channelBindings.sessionId, sessionId))
    .orderBy(desc(channelBindings.createdAt));
  return rows.map(rowToChannelBinding);
}

export async function listUserChannelBindings(db: D1Database, userId: string): Promise<ChannelBinding[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(channelBindings)
    .where(eq(channelBindings.userId, userId))
    .orderBy(desc(channelBindings.createdAt));
  return rows.map(rowToChannelBinding);
}

export async function deleteChannelBinding(db: D1Database, id: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(channelBindings).where(eq(channelBindings.id, id));
}

export async function updateChannelBindingQueueMode(
  db: D1Database,
  id: string,
  queueMode: QueueMode,
  collectDebounceMs?: number,
): Promise<void> {
  const drizzle = getDb(db);
  const setValues: Record<string, unknown> = { queueMode };
  if (collectDebounceMs !== undefined) {
    setValues.collectDebounceMs = collectDebounceMs;
  }
  await drizzle
    .update(channelBindings)
    .set(setValues)
    .where(eq(channelBindings.id, id));
}
