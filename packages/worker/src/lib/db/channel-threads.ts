import type { D1Database } from '@cloudflare/workers-types';
import { createThread } from './threads.js';

/**
 * Look up an existing channel→thread mapping.
 * Returns the orchestrator thread ID if found, null otherwise.
 */
export async function getChannelThreadMapping(
  db: D1Database,
  channelType: string,
  channelId: string,
  externalThreadId: string,
): Promise<{ threadId: string; sessionId: string } | null> {
  const row = await db
    .prepare(
      'SELECT thread_id, session_id FROM channel_thread_mappings WHERE channel_type = ? AND channel_id = ? AND external_thread_id = ?'
    )
    .bind(channelType, channelId, externalThreadId)
    .first();

  if (!row) return null;
  return { threadId: row.thread_id as string, sessionId: row.session_id as string };
}

/**
 * Resolve an external channel thread to an orchestrator thread.
 * Creates the orchestrator thread + mapping if none exists.
 *
 * Race-safe: uses INSERT OR IGNORE on the unique index so concurrent callers
 * don't fail. The loser's optimistically-created session_thread is cleaned up.
 *
 * This is channel-agnostic: Slack passes thread_ts, Discord passes thread snowflake,
 * Telegram passes '_root', etc.
 */
export async function getOrCreateChannelThread(
  db: D1Database,
  params: {
    channelType: string;
    channelId: string;
    externalThreadId: string;
    sessionId: string;
    userId: string;
  },
): Promise<string> {
  // Fast path: existing mapping
  const existing = await getChannelThreadMapping(
    db,
    params.channelType,
    params.channelId,
    params.externalThreadId,
  );
  if (existing) {
    // Auto-reactivate if the thread was archived (no-op for active threads)
    await db
      .prepare(
        "UPDATE session_threads SET status = 'active', last_active_at = datetime('now') WHERE id = ? AND status = 'archived'"
      )
      .bind(existing.threadId)
      .run();
    return existing.threadId;
  }

  // Create orchestrator thread optimistically
  const threadId = crypto.randomUUID();
  await createThread(db, { id: threadId, sessionId: params.sessionId });

  // Insert mapping with INSERT OR IGNORE to handle concurrent racers.
  // The unique index on (channel_type, channel_id, external_thread_id) ensures
  // only the first writer wins; the second silently no-ops.
  const mappingId = crypto.randomUUID();
  await db
    .prepare(
      'INSERT OR IGNORE INTO channel_thread_mappings (id, session_id, thread_id, channel_type, channel_id, external_thread_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      mappingId,
      params.sessionId,
      threadId,
      params.channelType,
      params.channelId,
      params.externalThreadId,
      params.userId,
    )
    .run();

  // Read back the winner — may be ours or a concurrent racer's
  const winner = await getChannelThreadMapping(
    db,
    params.channelType,
    params.channelId,
    params.externalThreadId,
  );

  // If we lost the race, clean up our orphaned thread
  if (winner && winner.threadId !== threadId) {
    await db.prepare('DELETE FROM session_threads WHERE id = ?').bind(threadId).run();
  }

  return winner!.threadId;
}
