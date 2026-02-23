# Design: Parts-Based Message Pipeline (V2)

## Problem

The current message pipeline explodes a single OpenCode assistant response into multiple separate database rows:

- One `role=assistant` row per text segment (sent at tool boundaries and finalization)
- One `role=tool` row per tool call (upserted by `callID`)
- Streaming chunks are ephemeral (not stored, broadcast as `chunk` events)

The frontend then reconstructs what was originally one coherent response:

1. `groupIntoTurns()` groups consecutive assistant/tool rows into visual blocks
2. `mergeAssistantSegments()` decides whether consecutive text rows should merge
3. `tryMergeSnapshot()` does overlap detection for streaming deduplication

This causes bugs when genuinely separate messages (e.g., sequential prompt queue responses) get lumped into a single turn and concatenated without separation.

## Solution

Adopt OpenCode's parts-based model throughout the stack: **one assistant message = one DB row with a `parts[]` JSON array**. The DO assembles typed parts incrementally as Runner events arrive. The frontend renders each message by iterating its parts. No grouping, no merging, no overlap detection.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parts model | Mirror OpenCode exactly | One message, typed parts (text, tool-call, finish) |
| Migration | New sessions only | Old sessions keep old format + old rendering code |
| Assembly layer | Runner sends typed events, DO assembles parts[] | Minimal Runner complexity, DO owns storage |
| Streaming | Stream via `chunk` events with `messageId`, store in parts[] | High-frequency chunks stay small; parts[] is the source of truth |
| Protocol | New message types for v2 | Avoids v1/v2 branching in existing handlers |
| Format detection | Session-level `messageFormat` flag | Set at creation, immutable, included in init |

---

## Part Types

Defined in `packages/shared/src/types/message-parts.ts`:

```typescript
export interface TextPart {
  type: 'text';
  text: string;
  /** True while the DO is still receiving stream deltas for this part */
  streaming?: boolean;
}

export interface ToolCallPart {
  type: 'tool-call';
  callId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  error?: string;
}

export interface FinishPart {
  type: 'finish';
  reason: 'end_turn' | 'error' | 'canceled';
}

export interface ErrorPart {
  type: 'error';
  message: string;
}

export type MessagePart = TextPart | ToolCallPart | FinishPart | ErrorPart;
```

The `Message` interface in `packages/shared/src/types/index.ts` gets:

```typescript
export interface Message {
  // ... existing fields ...
  parts?: MessagePart[] | unknown; // array = v2, object/null = v1
  messageFormat?: 'v1' | 'v2';    // undefined = v1
}
```

---

## Runner Protocol (New Message Types)

Added to `RunnerToDOMessage` in `packages/runner/src/types.ts`. Old types (`stream`, `result`, `tool`, `complete`) remain for v1 sessions.

### `message.create`

Sent once at the start of each assistant turn. The Runner generates a `turnId` (UUID) that becomes the message's primary key.

```typescript
{
  type: 'message.create';
  turnId: string;            // UUID, becomes the message row ID
  channelType?: string;
  channelId?: string;
  opencodeSessionId?: string;
}
```

**When sent:** On the first `message.part.updated` SSE event (text or tool) for a new assistant message from OpenCode. Not sent preemptively — only when there's actual content.

### `message.part.text-delta`

Append text to the current turn's text part. Content is an incremental delta, not a full snapshot.

```typescript
{
  type: 'message.part.text-delta';
  turnId: string;
  delta: string;
}
```

**When sent:** On each `message.part.updated` SSE event with `part.type === "text"`. The Runner computes the delta from the snapshot (OpenCode sends full snapshots; the Runner strips the already-sent prefix).

### `message.part.tool-update`

Add or update a tool-call part. Sent on each status transition.

```typescript
{
  type: 'message.part.tool-update';
  turnId: string;
  callId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  error?: string;
}
```

**When sent:** On each `message.part.updated` SSE event with `part.type === "tool"` where the status has changed. Maps directly to the existing `handleToolPart()` logic.

### `message.finalize`

Marks the turn as complete. The DO finalizes the parts array (sets text `streaming: false`, appends `FinishPart`, updates `content` column with plain text).

```typescript
{
  type: 'message.finalize';
  turnId: string;
  reason: 'end_turn' | 'error' | 'canceled';
  finalText?: string;      // Final accumulated text (for content column)
}
```

**When sent:** From `finalizeResponse()` on one of three triggers:
1. `session.idle` — normal end-of-turn
2. Abort handler — with `reason: 'canceled'`
3. `wait_for_event` forced-finalize — when the Runner detects a `wait_for_event` SSE event (e.g., waiting for user input), it must finalize the current turn so the accumulated text and tool results are persisted before the agent pauses. Uses `reason: 'end_turn'`.

### DO→Runner addition

Add `messageFormat?: 'v1' | 'v2'` to the `prompt` message type so the Runner knows which protocol to use:

```typescript
{ type: "prompt"; messageId: string; content: string; messageFormat?: 'v1' | 'v2'; ... }
```

---

## DO Assembly Logic

### State

```typescript
// In SessionAgentDO class
private activeTurns = new Map<string, {
  messageId: string;       // Same as turnId — the DB row ID
  parts: MessagePart[];    // In-memory parts array
  textPartIndex: number;   // Index of current TextPart (-1 if none)
  channelType?: string;    // From message.create, needed for auto-reply
  channelId?: string;      // From message.create, needed for auto-reply
  flushedToD1: boolean;    // Whether this row has been written to D1 yet
}>();
```

The `activeTurns` map is ephemeral (lost on DO hibernation/restart). See **Hibernation recovery** below for handling incomplete turns after restart.

### Handler: `message.create`

```
1. INSERT INTO messages (id=turnId, role='assistant', content='', parts='[]', message_format='v2', ...)
2. Add entry to activeTurns map
3. Broadcast { type: 'message', data: { id: turnId, role: 'assistant', parts: [], messageFormat: 'v2', ... } }
```

The client receives a new (empty) assistant message and can show a thinking indicator.

### Handler: `message.part.text-delta`

```
1. Look up turn in activeTurns
2. Find or create TextPart in parts[] (set streaming: true)
3. Append delta to TextPart.text
4. UPDATE messages SET parts = ? WHERE id = turnId
5. Broadcast { type: 'chunk', content: delta, messageId: turnId, ... }
```

Key design: we broadcast `chunk` (not `message.updated`) for text deltas. The `chunk` event carries only the delta string and is much smaller than a full `message.updated` with the entire parts array. We add a `messageId` field to `chunk` so the client can attribute it to the correct in-progress message.

The DO writes to SQLite on every delta (maintaining crash consistency), but broadcasts the lightweight `chunk` event. Full `message.updated` is only sent on tool updates and finalize.

### Handler: `message.part.tool-update`

```
1. Look up turn in activeTurns
2. Find ToolCallPart by callId, or create new one
3. Update status, args, result, error
4. UPDATE messages SET parts = ? WHERE id = turnId
5. Broadcast { type: 'message.updated', data: { id: turnId, parts: [...], ... } }
```

Tool updates send full `message.updated` because the client needs the complete tool state to render the tool card (collapsible with args/result).

### Handler: `message.finalize`

```
1. Look up turn in activeTurns
2. Set TextPart.streaming = false (if exists)
3. Append FinishPart { type: 'finish', reason }
4. Extract plain text content from all TextParts → plainText
5. UPDATE messages SET parts = ?, content = plainText WHERE id = turnId
6. Broadcast { type: 'message.updated', data: { id: turnId, parts: [...], content: plainText, ... } }
7. Populate pendingChannelReply for auto-reply (see below)
8. Delete from activeTurns
```

**Step 7 detail — pendingChannelReply:** In v1, the `case 'result'` handler populates `pendingChannelReply.resultContent`. In v2, there is no `result` message. The `message.finalize` handler must do this instead:

```typescript
if (turn.channelType && turn.channelId) {
  this.pendingChannelReply = {
    channelType: turn.channelType,
    channelId: turn.channelId,
    resultContent: plainText,  // extracted from TextParts
    messageId: turnId,
  };
}
```

The `channelType` and `channelId` must be stored in the `activeTurns` entry (received from `message.create`).

### Handler: `complete` (unchanged)

The `complete` message continues to trigger `handlePromptComplete()` which manages the prompt queue, D1 flush, and dequeuing. No v1/v2 branching needed — it's a session-level lifecycle event, not a message-level one.

### Abort handling

When the Runner sends `aborted`:

```
1. If activeTurns has an entry, finalize it with reason='canceled'
2. Same as message.finalize but with FinishPart { reason: 'canceled' }
```

### Error handling

When the Runner sends `error`:

```
1. If activeTurns has an entry:
   - Append ErrorPart { message: errorText }
   - Append FinishPart { reason: 'error' }
   - Broadcast message.updated
   - Delete from activeTurns
```

### Hibernation recovery

The `activeTurns` map is lost when the DO hibernates or restarts. Any in-progress turns will have partial data in SQLite but no in-memory state to continue assembly. Incoming deltas from the Runner after wake-up would silently fail (no `activeTurns` entry to look up).

**On DO wake (in `webSocketMessage()` or `alarm()`):**

Before processing messages, rebuild `activeTurns` from any incomplete v2 rows:

```sql
SELECT id, parts, channel_type, channel_id FROM messages
WHERE message_format = 'v2'
AND id NOT IN (SELECT id FROM messages WHERE parts LIKE '%"type":"finish"%')
ORDER BY created_at DESC LIMIT 5
```

For each incomplete row, reconstruct the `activeTurns` entry from the persisted `parts[]`. This allows the DO to continue receiving deltas from the Runner after hibernation.

**On client connect (in `upgradeClient()`):**

After the `activeTurns` rebuild above, also clean up any truly orphaned turns (where the Runner connection was also lost):

```
1. For v2 rows with streaming TextParts that are NOT in activeTurns
   (i.e., no Runner is connected to continue them):
   - Set streaming: false on all TextParts
   - Append { type: 'finish', reason: 'canceled' }
   - UPDATE the row
```

This prevents stuck streaming indicators. The check for "no Runner connected" is important — if the Runner *is* connected and the DO just woke from hibernation, we want to rebuild `activeTurns` and continue, not prematurely finalize.

---

## Client Changes

### use-chat.ts

**State additions:**

```typescript
interface ChatState {
  // ... existing ...
  messageFormat: 'v1' | 'v2';  // From init message
}
```

**`init` handler:** Read `messageFormat` from init data, default to `'v1'`.

**`chunk` handler:** Branch on whether `messageId` is present:

```typescript
case 'chunk': {
  if (msg.messageId) {
    // V2: update both message.content AND the active TextPart in parts[]
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (m.id !== msg.messageId) return m;
        // Update content (used for plain-text copies, search, etc.)
        const newContent = (m.content || '') + msg.content;
        // Update the last TextPart in parts[] (the one with streaming: true)
        const newParts = Array.isArray(m.parts)
          ? m.parts.map((p, i, arr) => {
              if (p.type === 'text' && p.streaming) {
                return { ...p, text: (p.text || '') + msg.content };
              }
              return p;
            })
          : m.parts;
        return { ...m, content: newContent, parts: newParts };
      }),
      isAgentThinking: false,
    }));
  } else {
    // V1: accumulate in streamingContent (existing behavior)
    setState(prev => ({
      ...prev,
      streamingContent: prev.streamingContent + msg.content,
      isAgentThinking: false,
    }));
  }
  break;
}
```

**Critical:** The client must update *both* `message.content` and the active `TextPart.text` in `parts[]` on each chunk. The `V2AssistantTurn` component renders from `parts[].text`, so only updating `content` would leave the rendered view empty until `message.updated` arrives.

**`message` handler:** For v2 empty assistant messages (turn start), don't clear `isAgentThinking`:

```typescript
const isV2EmptyTurn = d.role === 'assistant' && d.messageFormat === 'v2'
  && Array.isArray(d.parts) && d.parts.length === 0;
```

**`message.updated` handler:** Merges content and parts by ID. Two important details:

1. **Preserve `messageFormat`** on the merged message object.
2. **Don't let tool-update broadcasts clobber chunk-accumulated content.** During streaming, the DO may broadcast `message.updated` for a tool status change. The `content` field in that broadcast is the DB column value (which lags behind the client's chunk-accumulated content). The client must keep its local `content` if it's longer:

```typescript
case 'message.updated': {
  setState(prev => ({
    ...prev,
    messages: prev.messages.map(m => {
      if (m.id !== msg.data.id) return m;
      // Keep the longer content — the client's chunk-accumulated content
      // is ahead of the DB column value during streaming
      const keepContent = (m.content || '').length > (msg.data.content || '').length
        ? m.content
        : msg.data.content;
      return { ...m, ...msg.data, content: keepContent };
    }),
  }));
  break;
}
```

When the `message.finalize` broadcast arrives, the server's `content` field contains the final text, which will be >= the client's accumulated content, so the final state is always correct.

### message-list.tsx

**`groupIntoTurns()` modification:** V2 assistant messages are self-contained turns:

```typescript
if (msg.role === 'assistant' && Array.isArray(msg.parts)) {
  // Flush any pending v1 turn
  if (currentTurn.length > 0) {
    turns.push({ type: 'assistant-turn', messages: currentTurn });
    currentTurn = [];
  }
  turns.push({ type: 'v2-turn', messages: [msg] });
  continue;
}
```

**New `V2AssistantTurn` component:** Renders a single message by iterating its `parts[]`:

```
<div className="group relative flex gap-3 py-3">
  <BotIcon />
  <div className="min-w-0 flex-1">
    <header: Agent, timestamp, copy button>
    <div className="space-y-1.5 border-l ...">
      {parts.map(part => {
        if (part.type === 'text')      → <MarkdownContent content={part.text} isStreaming={part.streaming} />
        if (part.type === 'tool-call') → <ToolCard tool={part} />
        if (part.type === 'finish' && part.reason === 'canceled') → <StoppedIndicator />
        if (part.type === 'error')     → <ErrorBanner message={part.message} />
      })}
    </div>
  </div>
</div>
```

The existing `AssistantTurn` component (with `groupIntoTurns`, `mergeAssistantSegments`, `tryMergeSnapshot`) remains for v1 sessions. It becomes a dead code path once all sessions are v2.

**`StreamingMessage` component:** Only rendered for v1 sessions. V2 streaming is shown inline in the `V2AssistantTurn` via the TextPart's `streaming: true` flag.

---

## D1 Schema

### Migration: `NNNN_message_format_v2.sql`

```sql
ALTER TABLE messages ADD COLUMN message_format TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE sessions ADD COLUMN message_format TEXT NOT NULL DEFAULT 'v1';
```

No structural changes needed — the `parts` column already exists as `TEXT`.

### D1 Flush Changes

V2 message rows are written incrementally to DO SQLite (parts[] grows during a turn), but **should only be flushed to D1 after finalization**. The current `flushMessagesToD1()` runs on a timer and selects rows by `created_at` — this means a v2 row created at turn start could get flushed to D1 mid-turn with empty or partial `parts=[]`, and then never re-flushed because its `created_at` hasn't changed.

**Fix:** Use the `flushedToD1` flag on `activeTurns` entries. The flush query should exclude v2 rows that have active (unfinalized) turns:

```sql
-- When selecting rows to flush, skip v2 rows that are still being assembled.
-- After message.finalize completes, the turn is removed from activeTurns and
-- the row becomes eligible for the next flush cycle.

-- V2 rows (use UPSERT since they may have been partially flushed on a previous cycle):
INSERT INTO messages (id, session_id, role, content, parts, message_format, ...)
VALUES (?, ?, ?, ?, ?, 'v2', ...)
ON CONFLICT(id) DO UPDATE SET content = excluded.content, parts = excluded.parts;

-- V1 rows (unchanged):
INSERT OR IGNORE INTO messages (id, session_id, ...) VALUES (?, ?, ...);
```

**Implementation in `flushMessagesToD1()`:**

```typescript
// Collect IDs of still-active v2 turns to exclude from flush
const activeTurnIds = new Set([...this.activeTurns.keys()]);

// When building the batch, skip rows whose ID is in activeTurnIds
const rows = this.db.prepare(
  `SELECT * FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at LIMIT 50`
).all(sessionId, lastFlushedAt);

const toFlush = rows.filter(r => !activeTurnIds.has(r.id));
```

This ensures v2 rows are only flushed once finalized (with complete `parts[]` and `content`). The UPSERT is still needed as a safety net for edge cases (DO restart mid-turn where the row was flushed partially before hibernation).

---

## Session Creation

When a new session is created:

1. Set `messageFormat = 'v2'` in the DO's `state` table (via `handleStart()`)
2. Set `message_format = 'v2'` in the D1 `sessions` row
3. Include `messageFormat: 'v2'` in the `init` WebSocket message to clients

The format flag is immutable after session creation.

---

## Data Flow (End to End)

```
User sends prompt
  → Client: { type: 'prompt', content }
  → DO: enqueue, dispatch to Runner with messageFormat='v2'

Runner receives prompt
  → Sends to OpenCode: POST /session/:id/prompt_async
  → Subscribes to SSE stream

OpenCode SSE: text delta arrives
  → Runner: first event? → sendTurnCreate(turnId, channelType, channelId)
                           → sendTextDelta(turnId, delta)
  → DO: message.create → INSERT row (id=turnId, parts=[])
                         → broadcast { type: 'message', parts: [] }
  → DO: text-delta → append to TextPart, UPDATE row
                     → broadcast { type: 'chunk', content: delta, messageId: turnId }
  → Client: updates message.content += delta (in-place)
            V2AssistantTurn re-renders with growing text

OpenCode SSE: tool call starts
  → Runner: sendToolUpdate(turnId, callId, toolName, 'running', args)
  → DO: upsert ToolCallPart in parts[], UPDATE row
        → broadcast { type: 'message.updated', parts: [...] }
  → Client: V2AssistantTurn shows running ToolCard

OpenCode SSE: tool call completes
  → Runner: sendToolUpdate(turnId, callId, toolName, 'completed', args, result)
  → DO: update ToolCallPart status, UPDATE row
        → broadcast { type: 'message.updated', parts: [...] }

OpenCode SSE: more text after tool
  → Runner: reset currentTextAccumulated, sendTextDelta(turnId, delta)
  → DO: create NEW TextPart (previous was closed at tool boundary), UPDATE row
        → broadcast { type: 'chunk', content: delta, messageId: turnId }

OpenCode SSE: session.idle
  → Runner: sendTurnFinalize(turnId, 'end_turn', finalText)
            sendComplete()
  → DO: message.finalize → set streaming=false, append FinishPart
                           UPDATE row (parts + content)
                           → broadcast { type: 'message.updated', parts: [...], content: finalText }
  → DO: complete → handlePromptComplete() → flush to D1 → dequeue next
  → Client: V2AssistantTurn renders final state (no streaming cursor)

Queue processes next prompt
  → DO dispatches next queued prompt to Runner
  → Runner creates new turnId, sends message.create
  → New assistant message row — completely separate from previous turn
```

---

## Edge Cases

### Multiple text segments (text → tool → text)

OpenCode can produce text before a tool call and more text after. In the current system, this creates multiple `result` messages. In v2, there's a single TextPart that accumulates all text across the turn.

However, looking at the Runner's current behavior: it sends a `result` segment at each tool boundary (flushing `streamedContent`), then a final `result` at finalize. In v2, these become `text-delta` events that all append to the same TextPart. The text flows naturally: `"I'll search for that..." + [tool card] + "The results show..."`.

**Design choice:** Should we have one TextPart that accumulates all text, or split into multiple TextParts at tool boundaries?

**Answer: Multiple TextParts.** When a tool-call part is added and there's an active streaming TextPart, close the current TextPart (set `streaming: false`) and start a new one after the tool. This preserves the visual ordering: text → tool card → text. A single TextPart with all text concatenated would render text before the tool card.

**Updated logic for `message.part.text-delta`:**
- If the most recent part in `parts[]` is a TextPart with `streaming: true`, append to it
- Otherwise, create a new TextPart (happens after a tool-call part was inserted)

**Updated logic for `message.part.tool-update` (new tool, not update):**
- If the current TextPart has content, set its `streaming: false` (close it)
- Reset `textPartIndex` to -1 so the next text-delta creates a new TextPart

### Prompt queue with multiple sequential turns

Each queued prompt creates its own `message.create` → `message.finalize` cycle. Each turn is a separate message row with its own `turnId`. The frontend renders them as separate `V2AssistantTurn` components. No grouping needed. The bug that prompted this work is structurally impossible.

### Model failover

When the Runner detects a retriable error and switches models:

1. Runner sends `message.finalize(turnId, 'error')` for the failed attempt
2. Runner sends `message.create(newTurnId)` for the retry
3. The failed turn's message row stays in the DB with an ErrorPart — client renders it with an error indicator
4. The retry turn is a new message row

Alternatively, if we don't want failed attempts visible:
1. Runner sends `message.finalize(turnId, 'canceled')` for the failed attempt
2. DO could optionally delete or hide the failed row
3. Runner sends `message.create(newTurnId)` for the retry

**Recommendation:** Keep failed attempts visible with a "Retrying with different model..." indicator. This is more transparent.

### Revert

The Runner sends `reverted: { messageIds: string[] }`. Currently `messageIds` contains the user message IDs that were reverted. The DO deletes those rows plus all subsequent rows.

For v2, the same logic works: delete the user message row and the v2 assistant message row(s) that follow it. Since v2 assistant messages are single rows (not fragmented across tool+text rows), the delete is simpler — just delete by `created_at >= revertTarget.created_at`.

### Workflow messages

`workflow-chat-message` inserts standalone messages (not part of a v2 turn). These continue to use the existing path with `parts` as an object (not array). `Array.isArray(msg.parts)` returns false, so `groupIntoTurns` routes them through the v1 path. No changes needed.

### Forwarded messages

Same as workflow messages — `parts.forwarded === true` with a flat object. V1 rendering path handles them. No changes needed.

### Child sessions

`child-session` events are separate from the message list. No changes needed.

---

## Performance Considerations

### SQLite write amplification

V2 turns write to DO SQLite on every text delta and tool status change. For a 2000-token response with ~50 SSE events, that's ~50 UPDATE statements. Each is a synchronous in-process SQLite write (microseconds). This is acceptable.

### Broadcast frequency

**Text deltas:** Broadcast as `chunk` events (small payload: `{type, content, messageId}`). Same frequency as current v1 streaming. No increase.

**Tool updates:** Broadcast as `message.updated` with full parts[]. Same frequency as current v1 tool upserts. Each tool typically has 2-3 status transitions (pending → running → completed).

**Not sending** full `message.updated` on every text delta is critical. The parts array grows throughout the turn and could be large (many tool calls with results). Sending it 50 times per response would be wasteful. The `chunk` event keeps streaming lightweight.

### Client re-render frequency

The client updates `message.content` on every chunk (string concatenation). `V2AssistantTurn` re-renders on every update. This is the same frequency as current v1 streaming (which re-renders `StreamingMessage` on every chunk). React's reconciliation handles this efficiently since only the last TextPart's text changes.

---

## Implementation Phases

### Phase 1: Type System (no runtime impact)

Files:
- Create `packages/shared/src/types/message-parts.ts` — part types, `MessagePart` union
- Update `packages/shared/src/types/index.ts`:
  - Add `messageFormat?: 'v1' | 'v2'` to `Message` interface
  - Add `parts?: MessagePart[]` (typed array, replacing `unknown`)
- Update `packages/shared/src/index.ts` — re-export message-parts types
- Add new message types to `packages/runner/src/types.ts` — `RunnerToDOMessage` additions (`message.create`, `message.part.text-delta`, `message.part.tool-update`, `message.finalize`)
- Add `messageFormat?: 'v1' | 'v2'` to `DOToRunnerMessage` prompt variant
- Update WebSocket message types in shared types:
  - `WebSocketChunkMessage`: add `messageId?: string` field
  - `WebSocketMessageMessage.data`: add `messageFormat?: 'v1' | 'v2'` field
  - `WebSocketInitMessage`: add `messageFormat?: 'v1' | 'v2'` field

Verification: `pnpm typecheck` passes.

### Phase 2: Runner (additive, non-breaking)

Files:
- `packages/runner/src/agent-client.ts` — add `sendTurnCreate`, `sendTextDelta`, `sendToolUpdate`, `sendTurnFinalize` methods
- `packages/runner/src/prompt.ts`:
  - Add `isV2Session`, `currentTurnId`, `currentTextAccumulated` to `ChannelSession`
  - In `handlePartUpdated()` text handler: v2 branch computes delta from `currentTextAccumulated`, sends `sendTurnCreate` (first time) + `sendTextDelta`
  - In `handleToolPart()`: v2 branch sends `sendToolUpdate` instead of `sendToolCall`. **Critical: reset `currentTextAccumulated = ''`** when a tool boundary is hit, because the DO will close the current TextPart and start a new one — the next text delta must be computed relative to a fresh accumulator, not the pre-tool text.
  - In `finalizeResponse()`: v2 branch sends `sendTurnFinalize` instead of `sendResult`
  - In abort handler: v2 branch sends `sendTurnFinalize(reason='canceled')`
  - In `handlePrompt()`: read `messageFormat` from prompt message, set `channel.isV2Session`

  **Delta computation detail:** OpenCode sends full text snapshots per `message.part.updated`. The Runner must track how much text it has already sent to compute the delta:
  ```
  delta = snapshot.slice(currentTextAccumulated.length)
  currentTextAccumulated = snapshot
  ```
  When a tool boundary is hit (`handleToolPart()`), the Runner resets `currentTextAccumulated = ''` because the next text from OpenCode starts a new TextPart on the DO side. The next snapshot from OpenCode will be relative to the new text block, so the delta computation remains correct.

Verification: `cd packages/runner && pnpm typecheck`.

### Phase 3: DO Assembly

Files:
- `packages/worker/src/durable-objects/session-agent.ts`:
  - Add `activeTurns` Map and `extractTextContent()` helper
  - Add `message.create` case to `handleRunnerMessage()`
  - Add `message.part.text-delta` case
  - Add `message.part.tool-update` case
  - Add `message.finalize` case
  - Modify `aborted` case — finalize active v2 turn if exists
  - Modify `error` case — finalize active v2 turn with error if exists
  - Modify `sendNextQueuedPrompt()` — include `messageFormat` in prompt dispatch
  - Modify `handleStart()` — set `messageFormat = 'v2'` in state table
  - Modify `upgradeClient()` — include `messageFormat` in init message
  - Add `activeTurns` rebuild from SQLite on DO wake (for hibernation recovery)
  - Add orphaned turn cleanup in `upgradeClient()` (finalize turns with no active Runner)
  - Add `chunk` event broadcast with `messageId` field (additive — existing `chunk` events for v1 don't have this field)

Verification: `cd packages/worker && pnpm typecheck`.

### Phase 4: D1 Migration

Files:
- Create `packages/worker/migrations/NNNN_message_format_v2.sql`
- Update `flushMessagesToD1()` — UPSERT for v2 rows

### Phase 5: Client State

Files:
- `packages/client/src/hooks/use-chat.ts`:
  - Add `messageFormat` to `ChatState`
  - Read from init message
  - Update `chunk` handler for v2 (in-place content update when `messageId` present)
  - Update `message` handler for v2 empty turn-start
  - Update `message.updated` handler to preserve `messageFormat`

### Phase 6: Client Rendering

Files:
- `packages/client/src/components/chat/message-list.tsx`:
  - Add `v2-turn` type to `MessageTurn`
  - Update `groupIntoTurns()` — v2 assistant messages as self-contained turns
  - Add `V2AssistantTurn` component
  - Add `V2PartRenderer` component
  - Update render loop
  - Conditionally render `StreamingMessage` for v1 only

### Phase 7: Enable for New Sessions

Files:
- `packages/worker/src/routes/sessions.ts` — set `message_format: 'v2'` on session creation
- D1 session insert includes `message_format = 'v2'`

### Phase 8: Cleanup (after v2 is stable)

- Remove `tryMergeSnapshot()`, `mergeAssistantSegments()`, `mergeWithOverlap()` (once all v1 sessions aged out)
- Deprecate v1 Runner send methods (`sendStreamChunk`, `sendResult`, `sendToolCall`)
- Remove `streamingContent` from `ChatState` (once v1 dead)
- Remove `StreamingMessage` component

---

## What Does NOT Change

- User messages (role='user') — stored as single rows with content + optional attachment parts
- System messages (role='system') — stored as single rows (model-switched, errors, session-breaks)
- Prompt queue mechanism — still queues and dequeues prompts the same way
- `complete` message — still signals end of turn for queue processing
- `agentStatus` messages — still broadcast for UI indicators
- Channel auto-reply — still reads from `pendingChannelReply`
- D1 as cold storage with async flush — same pattern, just UPSERT for v2 rows
- Workflow messages — continue using v1 path
- Forwarded messages — continue using v1 path
- Child session events — separate mechanism, unchanged
