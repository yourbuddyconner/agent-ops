import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageStore, type SqlStorage } from './message-store.js';

// ─── SqlStorage Mock ─────────────────────────────────────────────────────────
//
// Lightweight mock that records all exec() calls for assertion.
// Provides configurable responses for specific queries (MAX(seq), replication_state).

interface ExecCall {
  query: string;
  params: unknown[];
}

function createMockSql(opts?: {
  maxSeq?: number | null;
  lastReplicatedSeq?: number | null;
}): SqlStorage & { calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const maxSeq = opts?.maxSeq ?? null;
  const lastReplicatedSeq = opts?.lastReplicatedSeq ?? null;

  return {
    calls,
    exec(query: string, ...params: unknown[]) {
      calls.push({ query, params });

      // Handle SELECT MAX(seq)
      if (query.includes('MAX(seq)')) {
        return {
          toArray: () => [{ max_seq: maxSeq }],
        };
      }

      // Handle replication_state read
      if (query.includes('SELECT value FROM replication_state')) {
        if (lastReplicatedSeq !== null) {
          return { toArray: () => [{ value: lastReplicatedSeq }] };
        }
        return { toArray: () => [] };
      }

      // Handle SELECT for getMessage / getMessages / recoverTurn
      if (query.startsWith('SELECT') && query.includes('FROM messages')) {
        return { toArray: () => [] };
      }

      // Default: return empty array (CREATE TABLE, ALTER TABLE, INSERT, UPDATE)
      return { toArray: () => [] };
    },
  };
}

/**
 * Create a mock that tracks stored rows so reads return previously written data.
 * This is a more stateful mock for tests that need read-after-write.
 */
function createStatefulMockSql(opts?: {
  maxSeq?: number | null;
  lastReplicatedSeq?: number | null;
}): SqlStorage & { calls: ExecCall[]; rows: Map<string, Record<string, unknown>> } {
  const calls: ExecCall[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const maxSeq = opts?.maxSeq ?? null;
  const lastReplicatedSeq = opts?.lastReplicatedSeq ?? null;
  let replicatedSeq = lastReplicatedSeq;

  return {
    calls,
    rows,
    exec(query: string, ...params: unknown[]) {
      calls.push({ query, params });

      // Handle CREATE TABLE / ALTER TABLE as no-ops
      if (query.trimStart().startsWith('CREATE TABLE') || query.trimStart().startsWith('ALTER TABLE')) {
        return { toArray: () => [] };
      }

      // Handle SELECT MAX(seq)
      if (query.includes('MAX(seq)')) {
        if (rows.size === 0 && maxSeq !== null) {
          return { toArray: () => [{ max_seq: maxSeq }] };
        }
        let max = maxSeq ?? 0;
        for (const row of rows.values()) {
          if (typeof row.seq === 'number' && row.seq > max) max = row.seq;
        }
        return { toArray: () => [{ max_seq: max || null }] };
      }

      // Handle replication_state read
      if (query.includes('SELECT value FROM replication_state')) {
        if (replicatedSeq !== null) {
          return { toArray: () => [{ value: replicatedSeq }] };
        }
        return { toArray: () => [] };
      }

      // Handle replication_state write
      if (query.includes('INSERT OR REPLACE INTO replication_state')) {
        replicatedSeq = params[0] as number;
        return { toArray: () => [] };
      }

      // Handle INSERT INTO messages
      if (query.includes('INSERT') && query.includes('messages') && !query.includes('replication_state')) {
        // Parse the values from the INSERT
        const id = params[0] as string;
        const isCreateTurn = query.includes("'assistant', '', '[]', 'v2'");
        if (isCreateTurn) {
          rows.set(id, {
            id,
            seq: params[1] as number,
            role: 'assistant',
            content: '',
            parts: '[]',
            author_id: null,
            author_email: null,
            author_name: null,
            author_avatar_url: null,
            channel_type: params[2] ?? null,
            channel_id: params[3] ?? null,
            opencode_session_id: params[4] ?? null,
            message_format: 'v2',
            thread_id: params[5] ?? null,
            created_at: Math.floor(Date.now() / 1000),
          });
        } else {
          // writeMessage INSERT
          rows.set(id, {
            id,
            seq: params[1] as number,
            role: params[2] as string,
            content: params[3] as string,
            parts: params[4] ?? null,
            author_id: params[5] ?? null,
            author_email: params[6] ?? null,
            author_name: params[7] ?? null,
            author_avatar_url: params[8] ?? null,
            channel_type: params[9] ?? null,
            channel_id: params[10] ?? null,
            opencode_session_id: params[11] ?? null,
            message_format: params[12] ?? 'v2',
            thread_id: params[13] ?? null,
            created_at: Math.floor(Date.now() / 1000),
          });
        }
        return { toArray: () => [] };
      }

      // Handle UPDATE messages
      if (query.startsWith('UPDATE messages')) {
        if (query.includes('channel_type = ?') && query.includes('channel_id = ?') && query.includes('seq = ?')) {
          // stampChannelDelivery
          const channelType = params[0] as string;
          const channelId = params[1] as string;
          const seq = params[2] as number;
          const id = params[3] as string;
          const existing = rows.get(id);
          if (existing) {
            existing.channel_type = channelType;
            existing.channel_id = channelId;
            existing.seq = seq;
          }
        } else if (query.includes('parts = ?') && query.includes('content = ?') && query.includes('seq = ?')) {
          // updateToolCall / finalizeTurn
          const partsJson = params[0] as string;
          const content = params[1] as string;
          const seq = params[2] as number;
          const id = params[3] as string;
          const existing = rows.get(id);
          if (existing) {
            existing.parts = partsJson;
            existing.content = content;
            existing.seq = seq;
          }
        } else if (query.includes('content = ?') && query.includes('parts = ?')) {
          // finalizeTurn (content first)
          const content = params[0] as string;
          const partsJson = params[1] as string;
          const seq = params[2] as number;
          const id = params[3] as string;
          const existing = rows.get(id);
          if (existing) {
            existing.content = content;
            existing.parts = partsJson;
            existing.seq = seq;
          }
        } else if (query.includes('parts = ?') && query.includes('seq = ?')) {
          // updateMessageParts
          const partsJson = params[0] as string;
          const seq = params[1] as number;
          const id = params[2] as string;
          const existing = rows.get(id);
          if (existing) {
            existing.parts = partsJson;
            existing.seq = seq;
          }
        }
        return { toArray: () => [] };
      }

      // Handle SELECT for single message
      if (query.startsWith('SELECT') && query.includes('FROM messages WHERE id = ?')) {
        const id = params[0] as string;
        const row = rows.get(id);
        if (row) return { toArray: () => [row] };
        return { toArray: () => [] };
      }

      // Handle SELECT for recoverTurn
      if (query.startsWith('SELECT') && query.includes("role = 'assistant'") && query.includes("message_format = 'v2'")) {
        const id = params[0] as string;
        const row = rows.get(id);
        if (row && row.role === 'assistant' && row.message_format === 'v2') {
          return { toArray: () => [row] };
        }
        return { toArray: () => [] };
      }

      // Handle SELECT for getMessages (all messages)
      if (query.startsWith('SELECT') && query.includes('FROM messages') && !query.includes('WHERE id')) {
        const allRows = Array.from(rows.values());
        // Simple ordering by seq
        allRows.sort((a, b) => (a.seq as number) - (b.seq as number));

        // Handle seq > ? filter for flushToD1
        if (query.includes('seq > ?')) {
          const minSeq = params[0] as number;
          const filtered = allRows.filter(r => (r.seq as number) > minSeq);
          return { toArray: () => filtered };
        }

        return { toArray: () => allRows };
      }

      return { toArray: () => [] };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MessageStore', () => {
  describe('Task 1: Schema + Constructor + Seq Counter + writeMessage', () => {
    it('creates tables on construction', () => {
      const sql = createMockSql();
      new MessageStore(sql);

      const createTableCalls = sql.calls.filter((c) =>
        c.query.includes('CREATE TABLE'),
      );
      expect(createTableCalls.length).toBe(2); // messages + replication_state
    });

    it('runs migration ALTERs on construction', () => {
      const sql = createMockSql();
      new MessageStore(sql);

      const alterCalls = sql.calls.filter((c) =>
        c.query.includes('ALTER TABLE'),
      );
      // 3 migrations: seq, message_format, thread_id
      expect(alterCalls.length).toBe(3);
    });

    it('initializes nextSeq from empty DB (starts at 1)', () => {
      const sql = createMockSql({ maxSeq: null });
      const store = new MessageStore(sql);
      expect(store.currentSeq).toBe(1);
    });

    it('initializes nextSeq from existing data', () => {
      const sql = createMockSql({ maxSeq: 42 });
      const store = new MessageStore(sql);
      expect(store.currentSeq).toBe(43);
    });

    it('initializes lastReplicatedSeq from replication_state', () => {
      const sql = createMockSql({ lastReplicatedSeq: 30 });
      const store = new MessageStore(sql);
      expect(store.replicatedSeq).toBe(30);
    });

    it('initializes lastReplicatedSeq to 0 when no row exists', () => {
      const sql = createMockSql({ lastReplicatedSeq: null });
      const store = new MessageStore(sql);
      expect(store.replicatedSeq).toBe(0);
    });

    it('writeMessage generates correct INSERT with auto-incrementing seq', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      const seq1 = store.writeMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        author: { id: 'u1', email: 'test@test.com', name: 'Test', avatarUrl: 'https://avatar.url' },
        channelType: 'slack',
        channelId: 'C123',
        threadId: 'thread-1',
      });

      expect(seq1).toBe(1);

      // Find the INSERT call
      const insertCalls = sql.calls.filter((c) =>
        c.query.includes('INSERT INTO messages') && c.params.length > 0,
      );
      expect(insertCalls.length).toBe(1);
      const call = insertCalls[0];
      expect(call.params[0]).toBe('msg-1'); // id
      expect(call.params[1]).toBe(1);       // seq
      expect(call.params[2]).toBe('user');   // role
      expect(call.params[3]).toBe('Hello');  // content
      expect(call.params[5]).toBe('u1');     // author_id
      expect(call.params[6]).toBe('test@test.com'); // author_email
      expect(call.params[9]).toBe('slack');  // channel_type
      expect(call.params[10]).toBe('C123');  // channel_id

      // Second message gets seq 2
      const seq2 = store.writeMessage({
        id: 'msg-2',
        role: 'system',
        content: 'System message',
      });
      expect(seq2).toBe(2);
    });

    it('writeMessage uses default values for optional params', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: 'Reply',
      });

      const insertCalls = sql.calls.filter((c) =>
        c.query.includes('INSERT INTO messages') && c.params.length > 0,
      );
      const call = insertCalls[0];
      expect(call.params[4]).toBeNull();  // parts
      expect(call.params[5]).toBeNull();  // author_id
      expect(call.params[9]).toBeNull();  // channel_type
      expect(call.params[12]).toBe('v2'); // message_format default
      expect(call.params[13]).toBeNull(); // thread_id
    });
  });

  describe('Task 2: Streaming Turn Lifecycle', () => {
    it('createTurn inserts placeholder and tracks in activeTurns', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      const seq = store.createTurn('turn-1', {
        channelType: 'slack',
        channelId: 'C123',
        opencodeSessionId: 'oc-1',
        threadId: 'thread-1',
      });

      expect(seq).toBe(1);
      expect(store.activeTurnIds.has('turn-1')).toBe(true);

      // Verify INSERT OR IGNORE was called
      const insertCalls = sql.calls.filter((c) =>
        c.query.includes('INSERT OR IGNORE INTO messages'),
      );
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0].params[0]).toBe('turn-1');
      expect(insertCalls[0].params[1]).toBe(1); // seq
    });

    it('appendTextDelta is in-memory only (no new SQL queries)', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      const callCountBefore = sql.calls.length;

      const result = store.appendTextDelta('turn-1', 'Hello ');
      expect(result).toBe(true);

      const result2 = store.appendTextDelta('turn-1', 'world');
      expect(result2).toBe(true);

      // No new SQL calls after createTurn
      expect(sql.calls.length).toBe(callCountBefore);

      // Verify in-memory state
      const snapshot = store.getTurnSnapshot('turn-1');
      expect(snapshot).toBeDefined();
      expect(snapshot!.content).toBe('Hello world');
      expect(snapshot!.parts).toHaveLength(1);
      expect(snapshot!.parts[0].type).toBe('text');
      expect(snapshot!.parts[0].text).toBe('Hello world');
      expect(snapshot!.parts[0].streaming).toBe(true);
    });

    it('appendTextDelta returns false for unknown turn', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);
      expect(store.appendTextDelta('nonexistent', 'hello')).toBe(false);
    });

    it('appendTextDelta creates new text part after tool call (interleaving)', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'Before tool');
      store.updateToolCall('turn-1', 'call-1', 'readFile', 'running');
      store.appendTextDelta('turn-1', 'After tool');

      const snapshot = store.getTurnSnapshot('turn-1');
      expect(snapshot!.parts).toHaveLength(3);
      expect(snapshot!.parts[0].type).toBe('text');
      expect(snapshot!.parts[0].text).toBe('Before tool');
      expect(snapshot!.parts[0].streaming).toBe(false); // marked not streaming by tool update
      expect(snapshot!.parts[1].type).toBe('tool-call');
      expect(snapshot!.parts[2].type).toBe('text');
      expect(snapshot!.parts[2].text).toBe('After tool');
      expect(snapshot!.parts[2].streaming).toBe(true);
    });

    it('updateToolCall persists to SQLite with seq bump', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      const callCountBefore = sql.calls.length;

      const seq = store.updateToolCall('turn-1', 'call-1', 'readFile', 'running', { path: '/foo' });
      expect(seq).toBe(2); // createTurn used seq 1

      // Should have an UPDATE call
      const updateCalls = sql.calls.slice(callCountBefore).filter((c) =>
        c.query.includes('UPDATE messages'),
      );
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].query).toContain('UPDATE messages SET parts = ?, content = ?, seq = ? WHERE id = ?');
    });

    it('updateToolCall updates existing tool part', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.updateToolCall('turn-1', 'call-1', 'readFile', 'running');
      store.updateToolCall('turn-1', 'call-1', 'readFile', 'complete', undefined, 'file contents');

      const snapshot = store.getTurnSnapshot('turn-1');
      const toolParts = snapshot!.parts.filter((p) => p.type === 'tool-call');
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0].status).toBe('complete');
      expect(toolParts[0].result).toBe('file contents');
    });

    it('updateToolCall returns null for unknown turn', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);
      expect(store.updateToolCall('nonexistent', 'c1', 'tool', 'running')).toBeNull();
    });

    it('finalizeTurn uses UPDATE not INSERT OR REPLACE', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'Hello');
      const callCountBefore = sql.calls.length;

      const snapshot = store.finalizeTurn('turn-1', 'Hello World', 'end_turn');

      // Should NOT have INSERT OR REPLACE
      const callsSinceFinalize = sql.calls.slice(callCountBefore);
      const insertOrReplace = callsSinceFinalize.filter((c) =>
        c.query.includes('INSERT OR REPLACE'),
      );
      expect(insertOrReplace.length).toBe(0);

      // Should have UPDATE
      const updates = callsSinceFinalize.filter((c) =>
        c.query.includes('UPDATE messages SET content'),
      );
      expect(updates.length).toBe(1);
      expect(updates[0].params[0]).toBe('Hello World'); // finalContent
    });

    it('finalizeTurn marks text parts as not streaming', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'streaming text');

      const snapshot = store.finalizeTurn('turn-1')!;
      const textParts = snapshot.parts.filter((p) => p.type === 'text');
      for (const part of textParts) {
        expect(part.streaming).toBe(false);
      }
    });

    it('finalizeTurn adds finish part', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'done');

      const snapshot = store.finalizeTurn('turn-1', undefined, 'end_turn')!;
      const finishParts = snapshot.parts.filter((p) => p.type === 'finish');
      expect(finishParts).toHaveLength(1);
      expect(finishParts[0].reason).toBe('end_turn');
    });

    it('finalizeTurn adds error part when reason is error', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      const snapshot = store.finalizeTurn('turn-1', 'partial', 'error', 'Something broke')!;

      const errorParts = snapshot.parts.filter((p) => p.type === 'error');
      expect(errorParts).toHaveLength(1);
      expect(errorParts[0].message).toBe('Something broke');
    });

    it('finalizeTurn uses finalText for single text part', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'partial');

      const snapshot = store.finalizeTurn('turn-1', 'complete final text')!;
      const textParts = snapshot.parts.filter((p) => p.type === 'text');
      expect(textParts).toHaveLength(1);
      expect(textParts[0].text).toBe('complete final text');
      expect(snapshot.content).toBe('complete final text');
    });

    it('finalizeTurn preserves per-part text when multiple text parts exist', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.appendTextDelta('turn-1', 'Part 1');
      store.updateToolCall('turn-1', 'c1', 'tool', 'complete');
      store.appendTextDelta('turn-1', 'Part 2');

      const snapshot = store.finalizeTurn('turn-1', 'Part 1Part 2')!;
      const textParts = snapshot.parts.filter((p) => p.type === 'text');
      expect(textParts).toHaveLength(2);
      expect(textParts[0].text).toBe('Part 1');
      expect(textParts[1].text).toBe('Part 2');
    });

    it('finalizeTurn populates parts from finalContent when parts are empty', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      // No deltas — simulate hibernation recovery with empty parts

      const snapshot = store.finalizeTurn('turn-1', 'recovered text')!;
      const textParts = snapshot.parts.filter((p) => p.type === 'text');
      expect(textParts).toHaveLength(1);
      expect(textParts[0].text).toBe('recovered text');
    });

    it('finalizeTurn removes turn from activeTurns', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      expect(store.activeTurnIds.has('turn-1')).toBe(true);

      store.finalizeTurn('turn-1');
      expect(store.activeTurnIds.has('turn-1')).toBe(false);
    });

    it('finalizeTurn returns null for unknown turn', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);
      expect(store.finalizeTurn('nonexistent')).toBeNull();
    });

    it('finalizeTurn returns snapshot with metadata', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {
        channelType: 'slack',
        channelId: 'C123',
        opencodeSessionId: 'oc-1',
        threadId: 'thread-1',
      });

      const snapshot = store.finalizeTurn('turn-1', 'done')!;
      expect(snapshot.metadata.channelType).toBe('slack');
      expect(snapshot.metadata.channelId).toBe('C123');
      expect(snapshot.metadata.opencodeSessionId).toBe('oc-1');
      expect(snapshot.metadata.threadId).toBe('thread-1');
    });

    it('getTurnSnapshot returns undefined for non-active turn', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);
      expect(store.getTurnSnapshot('nonexistent')).toBeUndefined();
    });

    it('recoverTurn reconstructs from SQLite', () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      // Create and finalize a turn so it's in SQLite but not in activeTurns
      store.createTurn('turn-1', { channelType: 'web', threadId: 'thread-1' });
      store.appendTextDelta('turn-1', 'Hello');
      store.updateToolCall('turn-1', 'c1', 'tool', 'complete');

      // Simulate hibernation: clear activeTurns by finalizing
      store.finalizeTurn('turn-1', 'Hello');

      // Now the data is in the stateful mock's rows but not in activeTurns
      // Manually put back the pre-finalize state to simulate a non-finalized row
      const row = sql.rows.get('turn-1')!;
      // Reset to v2 assistant format (as it would be mid-stream before finalize)
      row.parts = JSON.stringify([{ type: 'text', text: 'Hello', streaming: true }]);
      row.content = 'Hello';
      row.role = 'assistant';
      row.message_format = 'v2';

      expect(store.activeTurnIds.has('turn-1')).toBe(false);

      const recovered = store.recoverTurn('turn-1');
      expect(recovered).toBeDefined();
      expect(recovered!.content).toBe('Hello');
      expect(recovered!.parts).toHaveLength(1);
      expect(recovered!.metadata.channelType).toBe('web');
      expect(store.activeTurnIds.has('turn-1')).toBe(true);
    });

    it('recoverTurn returns undefined for non-existent turn', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);
      expect(store.recoverTurn('nonexistent')).toBeUndefined();
    });

    it('activeTurnIds returns all active turn IDs', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.createTurn('turn-1', {});
      store.createTurn('turn-2', {});
      store.createTurn('turn-3', {});

      expect(store.activeTurnIds.size).toBe(3);
      expect(store.activeTurnIds.has('turn-1')).toBe(true);
      expect(store.activeTurnIds.has('turn-2')).toBe(true);
      expect(store.activeTurnIds.has('turn-3')).toBe(true);
    });
  });

  describe('Task 3: stampChannelDelivery + Read Methods', () => {
    it('stampChannelDelivery emits UPDATE with seq bump', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'assistant', content: 'Reply' });
      const callCountBefore = sql.calls.length;

      const seq = store.stampChannelDelivery('msg-1', 'slack', 'C456');
      expect(seq).toBe(2); // writeMessage used seq 1

      const updateCalls = sql.calls.slice(callCountBefore).filter((c) =>
        c.query.includes('UPDATE messages'),
      );
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].params).toEqual(['slack', 'C456', 2, 'msg-1']);
    });

    it('getMessage returns a MessageRow for existing message', () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        author: { id: 'u1', email: 'a@b.com' },
      });

      const row = store.getMessage('msg-1');
      expect(row).toBeDefined();
      expect(row!.id).toBe('msg-1');
      expect(row!.role).toBe('user');
      expect(row!.content).toBe('Hello');
      expect(row!.authorId).toBe('u1');
      expect(row!.authorEmail).toBe('a@b.com');
      expect(row!.seq).toBe(1);
    });

    it('getMessage returns undefined for non-existent message', () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);
      expect(store.getMessage('nonexistent')).toBeUndefined();
    });

    it('getMessages returns all messages ordered by seq', () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'user', content: 'First' });
      store.writeMessage({ id: 'msg-2', role: 'assistant', content: 'Second' });
      store.writeMessage({ id: 'msg-3', role: 'system', content: 'Third' });

      const msgs = store.getMessages();
      expect(msgs).toHaveLength(3);
      expect(msgs[0].id).toBe('msg-1');
      expect(msgs[1].id).toBe('msg-2');
      expect(msgs[2].id).toBe('msg-3');
    });

    it('updateMessageParts updates parts with seq bump', () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'user', content: 'Audio', parts: JSON.stringify([{ type: 'audio', data: 'base64' }]) });

      const newParts = JSON.stringify([{ type: 'audio', data: 'base64', transcript: 'hello' }]);
      const seq = store.updateMessageParts('msg-1', newParts);
      expect(seq).toBe(2);

      const row = store.getMessage('msg-1');
      expect(row).toBeDefined();
      expect(row!.parts).toBe(newParts);
      expect(row!.seq).toBe(2);
    });
  });

  describe('Task 4: D1 Flush', () => {
    it('flushToD1 queries messages by seq > lastReplicatedSeq', async () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'user', content: 'First' });
      store.writeMessage({ id: 'msg-2', role: 'assistant', content: 'Second' });

      const flushed: Array<{ id: string }> = [];
      const mockBatchUpsert = vi.fn(async (_db: unknown, _sid: string, msgs: Array<{ id: string }>) => {
        flushed.push(...msgs);
      });

      const count = await store.flushToD1({}, 'session-1', mockBatchUpsert);
      expect(count).toBe(2);
      expect(mockBatchUpsert).toHaveBeenCalledTimes(1);
      expect(flushed).toHaveLength(2);
      expect(flushed[0].id).toBe('msg-1');
      expect(flushed[1].id).toBe('msg-2');
    });

    it('flushToD1 advances watermark', async () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'user', content: 'First' });

      await store.flushToD1({}, 'session-1', vi.fn(async () => {}));
      expect(store.replicatedSeq).toBe(1);

      // Second flush should find nothing new
      const count = await store.flushToD1({}, 'session-1', vi.fn(async () => {}));
      expect(count).toBe(0);
    });

    it('flushToD1 does not advance watermark past active turns', async () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({ id: 'msg-1', role: 'user', content: 'First' }); // seq 1
      store.createTurn('turn-1', {}); // seq 2 — active turn
      store.writeMessage({ id: 'msg-3', role: 'system', content: 'Third' }); // seq 3

      await store.flushToD1({}, 'session-1', vi.fn(async () => {}));

      // Watermark should stop at seq 1 (minActiveSeq - 1 = 2 - 1 = 1)
      expect(store.replicatedSeq).toBe(1);
    });

    it('flushToD1 returns 0 when no messages to flush', async () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      const count = await store.flushToD1({}, 'session-1', vi.fn(async () => {}));
      expect(count).toBe(0);
    });

    it('flushToD1 passes correct data shape to batchUpsert', async () => {
      const sql = createStatefulMockSql();
      const store = new MessageStore(sql);

      store.writeMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        parts: JSON.stringify([{ type: 'text', text: 'Hello' }]),
        author: { id: 'u1', email: 'a@b.com', name: 'Alice', avatarUrl: 'https://img.url' },
        channelType: 'slack',
        channelId: 'C123',
        opencodeSessionId: 'oc-1',
        threadId: 'thread-1',
      });

      let capturedMsgs: Array<Record<string, unknown>> = [];
      await store.flushToD1({}, 'session-1', vi.fn(async (_db, _sid, msgs) => {
        capturedMsgs = msgs;
      }));

      expect(capturedMsgs).toHaveLength(1);
      const msg = capturedMsgs[0];
      expect(msg.id).toBe('msg-1');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.authorId).toBe('u1');
      expect(msg.authorEmail).toBe('a@b.com');
      expect(msg.authorName).toBe('Alice');
      expect(msg.authorAvatarUrl).toBe('https://img.url');
      expect(msg.channelType).toBe('slack');
      expect(msg.channelId).toBe('C123');
      expect(msg.opencodeSessionId).toBe('oc-1');
      expect(msg.messageFormat).toBe('v2');
      expect(msg.threadId).toBe('thread-1');
    });

    it('seq counter monotonically increases across all operations', () => {
      const sql = createMockSql();
      const store = new MessageStore(sql);

      const s1 = store.writeMessage({ id: 'm1', role: 'user', content: 'a' });
      const s2 = store.createTurn('t1', {});
      const s3 = store.updateToolCall('t1', 'c1', 'tool', 'running')!;
      const s4 = store.finalizeTurn('t1', 'done')!;
      const s5 = store.writeMessage({ id: 'm2', role: 'system', content: 'b' });
      const s6 = store.stampChannelDelivery('m1', 'slack', 'C1');

      expect(s1).toBe(1);
      expect(s2).toBe(2);
      expect(s3).toBe(3);
      // finalizeTurn returns snapshot, not seq directly — but it bumped seq
      expect(s5).toBe(5);
      expect(s6).toBe(6);
    });
  });
});
