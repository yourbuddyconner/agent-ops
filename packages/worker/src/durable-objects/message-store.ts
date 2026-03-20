/**
 * MessageStore — encapsulates all DO-local message persistence and streaming turn state.
 *
 * Phase 1 of SessionAgentDO decomposition. This class owns:
 * - The `messages` and `replication_state` tables in DO SQLite
 * - A monotonic sequence counter (`seq`) that bumps on every SQLite mutation
 * - In-memory `activeTurns` map for streaming turn assembly
 * - D1 flush via seq-based watermark
 *
 * SqlStorage is the Cloudflare Durable Object `ctx.storage.sql` API.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthorInfo {
  id?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface TurnMetadata {
  channelType?: string;
  channelId?: string;
  opencodeSessionId?: string;
  threadId?: string;
}

export interface TurnSnapshot {
  turnId: string;
  content: string;
  parts: Array<{ type: string; [key: string]: unknown }>;
  metadata: TurnMetadata;
}

export interface MessageRow {
  id: string;
  seq: number;
  role: string;
  content: string;
  parts: string | null;
  authorId: string | null;
  authorEmail: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  channelType: string | null;
  channelId: string | null;
  opencodeSessionId: string | null;
  messageFormat: string;
  threadId: string | null;
  createdAt: number;
}

/** Minimal interface for Cloudflare DO SqlStorage. */
export interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): Record<string, unknown>[] };
}

/** Shape of a single active turn held in memory during streaming. */
interface ActiveTurn {
  text: string;
  parts: Array<{ type: string; [key: string]: unknown }>;
  metadata: TurnMetadata;
}

// ─── Schema SQL ──────────────────────────────────────────────────────────────

const MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  parts TEXT,
  author_id TEXT,
  author_email TEXT,
  author_name TEXT,
  author_avatar_url TEXT,
  channel_type TEXT,
  channel_id TEXT,
  opencode_session_id TEXT,
  message_format TEXT NOT NULL DEFAULT 'v2',
  thread_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

const REPLICATION_STATE_SQL = `
CREATE TABLE IF NOT EXISTS replication_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

const MIGRATION_COLUMNS: Array<{ sql: string }> = [
  { sql: 'ALTER TABLE messages ADD COLUMN seq INTEGER NOT NULL DEFAULT 0' },
  { sql: "ALTER TABLE messages ADD COLUMN message_format TEXT NOT NULL DEFAULT 'v2'" },
  { sql: 'ALTER TABLE messages ADD COLUMN thread_id TEXT' },
];

// ─── MessageStore Class ──────────────────────────────────────────────────────

export class MessageStore {
  private sql: SqlStorage;
  private nextSeq: number;
  private lastReplicatedSeq: number;
  private activeTurns = new Map<string, ActiveTurn>();

  constructor(sql: SqlStorage) {
    this.sql = sql;

    // Create tables (idempotent)
    this.sql.exec(MESSAGES_TABLE_SQL);
    this.sql.exec(REPLICATION_STATE_SQL);

    // Run migrations for existing DOs that may lack newer columns
    for (const migration of MIGRATION_COLUMNS) {
      try { this.sql.exec(migration.sql); } catch { /* column already exists */ }
    }

    // Initialize seq counter from MAX(seq) in messages table
    const maxSeqRows = this.sql.exec('SELECT MAX(seq) as max_seq FROM messages').toArray();
    const maxSeq = maxSeqRows[0]?.max_seq;
    this.nextSeq = typeof maxSeq === 'number' && maxSeq > 0 ? maxSeq + 1 : 1;

    // Initialize replication watermark
    const repRows = this.sql.exec("SELECT value FROM replication_state WHERE key = 'last_replicated_seq'").toArray();
    this.lastReplicatedSeq = repRows.length > 0 && typeof repRows[0].value === 'number'
      ? (repRows[0].value as number)
      : 0;
  }

  // ─── Seq Counter ─────────────────────────────────────────────────────

  /** Consume and return the next sequence number. */
  private bumpSeq(): number {
    return this.nextSeq++;
  }

  /** Current next-seq value (for testing/diagnostics). */
  get currentSeq(): number {
    return this.nextSeq;
  }

  // ─── Task 1: writeMessage ────────────────────────────────────────────

  /**
   * Write a complete message to SQLite. Used for user messages, system messages,
   * and other write-once messages. Returns the assigned seq number.
   */
  writeMessage(params: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    parts?: string | null;
    author?: AuthorInfo;
    channelType?: string | null;
    channelId?: string | null;
    opencodeSessionId?: string | null;
    messageFormat?: string;
    threadId?: string | null;
  }): number {
    const seq = this.bumpSeq();
    this.sql.exec(
      `INSERT INTO messages (id, seq, role, content, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id, message_format, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params.id,
      seq,
      params.role,
      params.content,
      params.parts ?? null,
      params.author?.id ?? null,
      params.author?.email ?? null,
      params.author?.name ?? null,
      params.author?.avatarUrl ?? null,
      params.channelType ?? null,
      params.channelId ?? null,
      params.opencodeSessionId ?? null,
      params.messageFormat ?? 'v2',
      params.threadId ?? null,
    );
    return seq;
  }

  // ─── Task 2: Streaming Turn Lifecycle ────────────────────────────────

  /**
   * Begin a new streaming assistant turn. Inserts a placeholder row in SQLite
   * and tracks the turn in the in-memory activeTurns map.
   */
  // FUTURE: dispatch channel transport lifecycle hook here (onTurnStarted)
  createTurn(turnId: string, metadata: TurnMetadata): number {
    const seq = this.bumpSeq();
    this.sql.exec(
      `INSERT OR IGNORE INTO messages (id, seq, role, content, parts, message_format, channel_type, channel_id, opencode_session_id, thread_id)
       VALUES (?, ?, 'assistant', '', '[]', 'v2', ?, ?, ?, ?)`,
      turnId,
      seq,
      metadata.channelType ?? null,
      metadata.channelId ?? null,
      metadata.opencodeSessionId ?? null,
      metadata.threadId ?? null,
    );
    this.activeTurns.set(turnId, {
      text: '',
      parts: [],
      metadata: { ...metadata },
    });
    return seq;
  }

  /**
   * Append a text delta to an active streaming turn. In-memory only — no SQLite write,
   * no seq bump. Creates a new text part after tool calls (text -> tool-call -> text pattern).
   */
  // FUTURE: dispatch channel transport lifecycle hook here (onTextDelta)
  appendTextDelta(turnId: string, delta: string): boolean {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return false;

    turn.text += delta;

    // Update or create the current streaming text part
    const lastPart = turn.parts[turn.parts.length - 1];
    if (lastPart && lastPart.type === 'text' && lastPart.streaming) {
      lastPart.text = (lastPart.text as string) + delta;
    } else {
      // New text part — starts after a non-text part (e.g., tool-call) or is the first part
      turn.parts.push({ type: 'text', text: delta, streaming: true });
    }

    return true;
  }

  /**
   * Update a tool call within an active turn. Persists to SQLite (survives hibernation)
   * and bumps seq.
   */
  updateToolCall(
    turnId: string,
    callId: string,
    toolName: string,
    status: string,
    args?: unknown,
    result?: unknown,
    error?: unknown,
  ): number | null {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return null;

    // Find existing tool part or create new one
    let toolPart = turn.parts.find(
      (p) => p.type === 'tool-call' && p.callId === callId,
    );

    if (toolPart) {
      toolPart.status = status;
      if (args !== undefined) toolPart.args = args;
      if (result !== undefined) toolPart.result = result;
      if (error !== undefined) toolPart.error = error;
    } else {
      // Mark any trailing streaming text part as not streaming before adding tool
      const lastPart = turn.parts[turn.parts.length - 1];
      if (lastPart && lastPart.type === 'text' && lastPart.streaming) {
        lastPart.streaming = false;
      }
      toolPart = {
        type: 'tool-call',
        callId,
        toolName,
        status,
        ...(args !== undefined ? { args } : {}),
        ...(result !== undefined ? { result } : {}),
        ...(error !== undefined ? { error } : {}),
      };
      turn.parts.push(toolPart);
    }

    // Persist to SQLite — UPDATE existing row (preserves created_at)
    const seq = this.bumpSeq();
    this.sql.exec(
      'UPDATE messages SET parts = ?, content = ?, seq = ? WHERE id = ?',
      JSON.stringify(turn.parts),
      turn.text,
      seq,
      turnId,
    );

    return seq;
  }

  /**
   * Finalize a streaming turn. MUST use UPDATE (not INSERT OR REPLACE) to preserve created_at.
   * Marks text parts as not streaming, applies finalText if single text part, adds finish part.
   * Returns a TurnSnapshot and removes the turn from activeTurns.
   */
  // FUTURE: dispatch channel transport lifecycle hook here (onTurnFinalized)
  finalizeTurn(
    turnId: string,
    finalText?: string,
    reason?: string,
    errorMsg?: string,
  ): TurnSnapshot | null {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return null;

    // Use finalText if provided (may be more complete than streamed chunks)
    const finalContent = finalText ?? turn.text;

    // If turn was recovered from hibernation with empty parts, populate from finalContent
    if (turn.parts.length === 0 && finalContent) {
      turn.parts.push({ type: 'text', text: finalContent });
    }

    // Mark all text parts as not streaming.
    // If there's only one text part and finalText was provided, use it (more complete).
    const textParts = turn.parts.filter((p) => p.type === 'text');
    if (textParts.length === 1 && finalText) {
      textParts[0].text = finalContent;
    }
    for (const part of textParts) {
      part.streaming = false;
    }

    // Add finish part
    turn.parts.push({ type: 'finish', reason: reason || 'end_turn' });

    // If there was an error, add error part
    if (reason === 'error' && errorMsg) {
      turn.parts.push({ type: 'error', message: errorMsg });
    }

    // UPDATE existing row in SQLite — preserves created_at
    const seq = this.bumpSeq();
    this.sql.exec(
      'UPDATE messages SET content = ?, parts = ?, seq = ? WHERE id = ?',
      finalContent,
      JSON.stringify(turn.parts),
      seq,
      turnId,
    );

    const snapshot: TurnSnapshot = {
      turnId,
      content: finalContent,
      parts: [...turn.parts],
      metadata: { ...turn.metadata },
    };

    // Clean up active turn
    this.activeTurns.delete(turnId);

    return snapshot;
  }

  /** Get the in-memory snapshot of an active turn (returns undefined if not active). */
  getTurnSnapshot(turnId: string): TurnSnapshot | undefined {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return undefined;
    return {
      turnId,
      content: turn.text,
      parts: [...turn.parts],
      metadata: { ...turn.metadata },
    };
  }

  /** Set of currently active (streaming) turn IDs. */
  get activeTurnIds(): Set<string> {
    return new Set(this.activeTurns.keys());
  }

  /**
   * Recover a turn from SQLite after DO hibernation wipes in-memory state.
   * Re-adds to activeTurns. Returns the snapshot if found.
   */
  recoverTurn(turnId: string): TurnSnapshot | undefined {
    const rows = this.sql.exec(
      "SELECT content, parts, channel_type, channel_id, opencode_session_id, thread_id FROM messages WHERE id = ? AND role = 'assistant' AND message_format = 'v2'",
      turnId,
    ).toArray();
    if (rows.length === 0) return undefined;

    const row = rows[0];
    let recoveredParts: Array<{ type: string; [key: string]: unknown }> = [];
    try {
      if (row.parts && typeof row.parts === 'string') {
        recoveredParts = JSON.parse(row.parts as string);
      }
    } catch { /* corrupted parts — start fresh */ }

    const metadata: TurnMetadata = {
      channelType: (row.channel_type as string) || undefined,
      channelId: (row.channel_id as string) || undefined,
      opencodeSessionId: (row.opencode_session_id as string) || undefined,
      threadId: (row.thread_id as string) || undefined,
    };

    const turn: ActiveTurn = {
      text: (row.content as string) || '',
      parts: recoveredParts,
      metadata,
    };
    this.activeTurns.set(turnId, turn);

    return {
      turnId,
      content: turn.text,
      parts: [...turn.parts],
      metadata: { ...turn.metadata },
    };
  }

  // ─── Task 3: stampChannelDelivery + Read Methods ─────────────────────

  /**
   * Stamp a message with channel delivery metadata. Bumps seq so the change
   * is picked up by the next D1 flush.
   */
  stampChannelDelivery(messageId: string, channelType: string, channelId: string): number {
    const seq = this.bumpSeq();
    this.sql.exec(
      'UPDATE messages SET channel_type = ?, channel_id = ?, seq = ? WHERE id = ?',
      channelType,
      channelId,
      seq,
      messageId,
    );
    return seq;
  }

  /** Read a single message by ID. */
  getMessage(id: string): MessageRow | undefined {
    const rows = this.sql.exec(
      'SELECT id, seq, role, content, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id, message_format, thread_id, created_at FROM messages WHERE id = ?',
      id,
    ).toArray();
    if (rows.length === 0) return undefined;
    return this.rowToMessageRow(rows[0]);
  }

  /** Read messages, ordered by created_at ASC, seq ASC. Supports optional limit and after-id cursor. */
  getMessages(opts?: { limit?: number; afterId?: string; threadId?: string }): MessageRow[] {
    let query = 'SELECT id, seq, role, content, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id, message_format, thread_id, created_at FROM messages';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (opts?.afterId) {
      conditions.push('(created_at, seq) > (SELECT created_at, seq FROM messages WHERE id = ?)');
      params.push(opts.afterId);
    }

    if (opts?.threadId) {
      conditions.push('thread_id = ?');
      params.push(opts.threadId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at ASC, seq ASC';

    if (opts?.limit) {
      query += ' LIMIT ?';
      params.push(opts.limit);
    }

    const rows = this.sql.exec(query, ...params).toArray();
    return rows.map((r) => this.rowToMessageRow(r));
  }

  /**
   * Update the parts JSON of an existing message. Used by audio-transcript handler.
   * Bumps seq so the change is flushed to D1.
   */
  updateMessageParts(messageId: string, parts: string): number {
    const seq = this.bumpSeq();
    this.sql.exec(
      'UPDATE messages SET parts = ?, seq = ? WHERE id = ?',
      parts,
      seq,
      messageId,
    );
    return seq;
  }

  // ─── Task 4: D1 Flush ───────────────────────────────────────────────

  /**
   * Flush messages with seq > lastReplicatedSeq to D1 via the provided callback.
   * Advances the watermark in replication_state on success.
   */
  async flushToD1<TDb = unknown>(
    db: TDb,
    sessionId: string,
    batchUpsert: (db: TDb, sessionId: string, msgs: Array<{
      id: string;
      role: string;
      content: string;
      parts: string | null;
      authorId: string | null;
      authorEmail: string | null;
      authorName: string | null;
      authorAvatarUrl: string | null;
      channelType: string | null;
      channelId: string | null;
      opencodeSessionId: string | null;
      messageFormat: string;
      threadId: string | null;
    }>) => Promise<void>,
  ): Promise<number> {
    const rows = this.sql.exec(
      'SELECT id, seq, role, content, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id, message_format, thread_id, created_at FROM messages WHERE seq > ? ORDER BY seq ASC LIMIT 200',
      this.lastReplicatedSeq,
    ).toArray();

    if (rows.length === 0) return 0;

    const msgs = rows.map((row) => ({
      id: row.id as string,
      role: row.role as string,
      content: row.content as string,
      parts: row.parts as string | null,
      authorId: row.author_id as string | null,
      authorEmail: row.author_email as string | null,
      authorName: row.author_name as string | null,
      authorAvatarUrl: row.author_avatar_url as string | null,
      channelType: row.channel_type as string | null,
      channelId: row.channel_id as string | null,
      opencodeSessionId: row.opencode_session_id as string | null,
      messageFormat: (row.message_format as string) || 'v2',
      threadId: row.thread_id as string | null,
    }));

    await batchUpsert(db, sessionId, msgs);

    // Advance watermark — but don't advance past active turns so they get re-flushed
    const activeTurnIdSet = this.activeTurnIds;
    const activeSeqs = rows
      .filter((row) => activeTurnIdSet.has(row.id as string))
      .map((row) => row.seq as number);
    const minActiveSeq = activeSeqs.length > 0 ? Math.min(...activeSeqs) : null;
    const maxFlushedSeq = rows[rows.length - 1].seq as number;
    const safeWatermark = minActiveSeq !== null
      ? Math.min(maxFlushedSeq, minActiveSeq - 1)
      : maxFlushedSeq;

    this.lastReplicatedSeq = safeWatermark;
    this.sql.exec(
      "INSERT OR REPLACE INTO replication_state (key, value) VALUES ('last_replicated_seq', ?)",
      safeWatermark,
    );

    return rows.length;
  }

  /** Current replication watermark (for testing/diagnostics). */
  get replicatedSeq(): number {
    return this.lastReplicatedSeq;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private rowToMessageRow(row: Record<string, unknown>): MessageRow {
    return {
      id: row.id as string,
      seq: row.seq as number,
      role: row.role as string,
      content: row.content as string,
      parts: row.parts as string | null,
      authorId: row.author_id as string | null,
      authorEmail: row.author_email as string | null,
      authorName: row.author_name as string | null,
      authorAvatarUrl: row.author_avatar_url as string | null,
      channelType: row.channel_type as string | null,
      channelId: row.channel_id as string | null,
      opencodeSessionId: row.opencode_session_id as string | null,
      messageFormat: (row.message_format as string) || 'v2',
      threadId: row.thread_id as string | null,
      createdAt: row.created_at as number,
    };
  }
}
