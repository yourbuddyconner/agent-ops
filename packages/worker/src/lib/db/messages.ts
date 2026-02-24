import type { D1Database } from '@cloudflare/workers-types';
import type { Message } from '@agent-ops/shared';
import { mapMessage } from './mappers.js';

export async function saveMessage(
  db: D1Database,
  data: { id: string; sessionId: string; role: string; content: string; toolCalls?: unknown[]; parts?: unknown; authorId?: string; authorEmail?: string; authorName?: string; authorAvatarUrl?: string; channelType?: string; channelId?: string; opencodeSessionId?: string }
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO messages (id, session_id, role, content, tool_calls, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(data.id, data.sessionId, data.role, data.content, data.toolCalls ? JSON.stringify(data.toolCalls) : null, data.parts ? JSON.stringify(data.parts) : null, data.authorId || null, data.authorEmail || null, data.authorName || null, data.authorAvatarUrl || null, data.channelType || null, data.channelId || null, data.opencodeSessionId || null)
    .run();
}

export async function getSessionMessages(
  db: D1Database,
  sessionId: string,
  options: { limit?: number; after?: string } = {}
): Promise<Message[]> {
  const limit = options.limit || 100;
  let query = 'SELECT * FROM messages WHERE session_id = ?';
  const params: (string | number)[] = [sessionId];

  if (options.after) {
    query += ' AND created_at > ?';
    params.push(options.after);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return (result.results || []).map(mapMessage);
}
