import type { D1Database } from '@cloudflare/workers-types';
import type { UserIdentityLink, ChannelBinding, ChannelType, QueueMode } from '@agent-ops/shared';
import { mapIdentityLink, mapChannelBinding } from './mappers.js';

// Identity Links

export async function createIdentityLink(
  db: D1Database,
  data: { id: string; userId: string; provider: string; externalId: string; externalName?: string; teamId?: string },
): Promise<UserIdentityLink> {
  await db
    .prepare(
      'INSERT INTO user_identity_links (id, user_id, provider, external_id, external_name, team_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(data.id, data.userId, data.provider, data.externalId, data.externalName || null, data.teamId || null)
    .run();

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
  const result = await db
    .prepare('SELECT * FROM user_identity_links WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (result.results || []).map(mapIdentityLink);
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
  const row = await db
    .prepare('SELECT user_id FROM user_identity_links WHERE provider = ? AND external_id = ?')
    .bind(provider, externalId)
    .first<{ user_id: string }>();
  return row?.user_id || null;
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

  await db
    .prepare(
      `INSERT INTO channel_bindings (id, session_id, channel_type, channel_id, scope_key, user_id, org_id, queue_mode, collect_debounce_ms, slack_channel_id, slack_thread_ts, github_repo_full_name, github_pr_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.sessionId,
      data.channelType,
      data.channelId,
      data.scopeKey,
      data.userId || null,
      data.orgId,
      queueMode,
      collectDebounceMs,
      data.slackChannelId || null,
      data.slackThreadTs || null,
      data.githubRepoFullName || null,
      data.githubPrNumber ?? null,
    )
    .run();

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
  const row = await db
    .prepare('SELECT * FROM channel_bindings WHERE scope_key = ?')
    .bind(scopeKey)
    .first();
  return row ? mapChannelBinding(row) : null;
}

export async function getSessionChannelBindings(db: D1Database, sessionId: string): Promise<ChannelBinding[]> {
  const result = await db
    .prepare('SELECT * FROM channel_bindings WHERE session_id = ? ORDER BY created_at DESC')
    .bind(sessionId)
    .all();
  return (result.results || []).map(mapChannelBinding);
}

export async function listUserChannelBindings(db: D1Database, userId: string): Promise<ChannelBinding[]> {
  const result = await db
    .prepare('SELECT * FROM channel_bindings WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (result.results || []).map(mapChannelBinding);
}

export async function deleteChannelBinding(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM channel_bindings WHERE id = ?').bind(id).run();
}

export async function updateChannelBindingQueueMode(
  db: D1Database,
  id: string,
  queueMode: QueueMode,
  collectDebounceMs?: number,
): Promise<void> {
  if (collectDebounceMs !== undefined) {
    await db
      .prepare('UPDATE channel_bindings SET queue_mode = ?, collect_debounce_ms = ? WHERE id = ?')
      .bind(queueMode, collectDebounceMs, id)
      .run();
  } else {
    await db
      .prepare('UPDATE channel_bindings SET queue_mode = ? WHERE id = ?')
      .bind(queueMode, id)
      .run();
  }
}
