# RFC: Vercel AI SDK Chat Adapter

**Status:** Draft
**Author:** monad (AI subagent)
**Date:** 2026-02-26
**Bean ID:** agent-ops-ai5k [^1]

[^1]: Bean IDs are internal task identifiers used in the Agent Ops task tracking system (`.beans/`).

## Executive Summary

This RFC proposes adding Vercel AI SDK Chat compatibility to Agent Ops via a **thin SSE adapter** that translates the existing V2 WebSocket protocol into AI SDK-compatible Server-Sent Events. The adapter enables ecosystem-standard client integrations (mobile apps, embeddable widgets, third-party tools) while preserving the full-featured custom WebSocket implementation for domain-specific features.

**Recommendation:** Adapter mode (not full migration). The existing V2 protocol carries Agent Ops-specific events (git state, diffs, reviews, child sessions, approval gates) that have no AI SDK equivalent. A translation layer provides AI SDK compatibility without losing specialized functionality.

---

## Problem Statement

Agent Ops currently uses a fully custom WebSocket chat stack:

- **Client:** Bespoke `use-chat.ts` hook with Zustand state management
- **Protocol:** Custom V2 parts-based streaming protocol (Runner → SessionAgent DO → browser)
- **Maintenance burden:** New contributors must learn proprietary protocol; ecosystem features (reconnection, stream recovery, optimistic UI, tool rendering) must be reimplemented manually

### Pain Points

1. **High barrier to entry:** New contributors need to understand custom protocol semantics instead of using standard AI SDK patterns
2. **Feature redundancy:** Capabilities that AI SDK provides (reconnection, stream recovery, message state) require custom implementation
3. **Integration friction:** Each new surface (mobile, widget, third-party) must implement the V2 protocol from scratch
4. **Maintenance island:** Protocol changes require coordinated updates across client, worker, and runner layers

### Desired Outcome

Enable any AI SDK-compatible client to connect to Agent Ops sessions with zero custom code, while preserving the existing full-featured UI for domain-specific workflows.

---

## Current Architecture

### Message Flow

```
OpenCode (agent) → Runner (Bun) → SessionAgent DO (CF Worker) → Browser (React)
                   ─── WebSocket (V2 protocol) ──────────────→ ─── WebSocket ──→
```

### V2 Protocol Events (Runner → DO → Client)

| V2 Event | Payload Shape | Purpose |
|----------|--------------|---------|
| `message.create` | `{ turnId, channelType?, channelId?, opencodeSessionId? }` | Start a new assistant turn |
| `message.part.text-delta` | `{ turnId, delta }` | Incremental text token |
| `message.part.tool-update` | `{ turnId, callId, toolName, status, args?, result?, error? }` | Tool call lifecycle (pending/running/completed/error) |
| `message.finalize` | `{ turnId, reason, finalText?, error? }` | Turn complete (end_turn/error/canceled) |
| `complete` | `{}` | Agent idle, ready for next prompt |
| `agentStatus` | `{ status, detail? }` | Agent state (idle/thinking/streaming/tool_calling/error) |

### Client-Side WebSocket Events (DO → Browser)

The DO broadcasts 20+ distinct event types to connected browser clients. The table below covers events relevant to the adapter:

| WS Event | Shape | Purpose |
|----------|-------|---------|
| `init` | Full session hydration | `messages[]`, models, users, audit log |
| `message` | Complete message object | Full message with all parts |
| `message.updated` | Updated message with parts | Incremental updates during streaming |
| `chunk` | `{ content, messageId }` | Text delta (broadcast alongside `message.part.text-delta`; still active) |
| `status` | Session status change | Session lifecycle events |
| `question` | Agent asking for user input | Approval gates, interactive prompts |
| `agentStatus` | Agent state change | Current agent state |
| `error` | Error message | Error notifications |
| *(12+ more)* | Various shapes | git-state, diff, review-result, child-session, title, audit_log, toast, etc. |

> **Note on `chunk`:** The `chunk` event is still actively emitted by the DO alongside V2 `message.part.text-delta` events. It is not deprecated. The adapter handles both; see translator section.

### Message Part Types (packages/shared)

```typescript
type MessagePart = TextPart | ToolCallPart | FinishPart | ErrorPart;

interface TextPart {
  type: 'text';
  text: string;
  streaming?: boolean;
}

interface ToolCallPart {
  type: 'tool-call';
  callId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  error?: string;
}

interface FinishPart {
  type: 'finish';
  reason: 'end_turn' | 'error' | 'canceled';
}

interface ErrorPart {
  type: 'error';
  message: string;
}
```

### Key Files

| File | Role |
|------|------|
| `packages/client/src/hooks/use-chat.ts` | Custom chat hook (state, WS, send/abort/answer) |
| `packages/client/src/hooks/use-websocket.ts` | Generic WS hook with reconnect |
| `packages/shared/src/types/index.ts` | Message, Session, User types |
| `packages/shared/src/types/message-parts.ts` | MessagePart union |
| `packages/worker/src/durable-objects/session-agent.ts` | DO: WS handling, turn aggregation, broadcast |
| `packages/runner/src/types.ts` | RunnerToDOMessage types |
| `packages/runner/src/prompt.ts` | OpenCode event → V2 message conversion |
| `packages/runner/src/agent-client.ts` | Runner → DO WebSocket client |

---

## AI SDK Stream Protocol (Target)

The Vercel AI SDK v5/v6 data stream protocol uses **Server-Sent Events (SSE)** with the following event types:

### AI SDK SSE Events

| SSE Event (`event:`) | JSON `type` field | Purpose |
|-----------|-----------|---------|
| `message-start` | `"start"` | Begin new assistant message |
| `text-start` | `"text-start"` | Begin text content block |
| `text-delta` | `"text-delta"` | Incremental text token |
| `text-end` | `"text-end"` | Text content complete |
| `tool-input-start` | `"tool-input-start"` | Tool call initiated |
| `tool-input-delta` | `"tool-input-delta"` | Tool args streaming |
| `tool-input-available` | `"tool-input-available"` | Tool args complete |
| `tool-output-available` | `"tool-output-available"` | Tool result ready |
| `start-step` / `finish-step` | `"start-step"` / `"finish-step"` | Multi-step reasoning boundaries |
| `message-finish` | `"finish"` | Message complete |
| `error` | `"error"` | Error condition |

> **SSE naming clarification:** The SSE `event:` name and the JSON `type` field are intentionally different for some events (e.g. `event: message-start` with `data: {"type":"start",...}`). The `event:` label is the full semantic name used for SSE filtering; the JSON `type` is the abbreviated key that AI SDK internals parse from the data payload. The appendix includes a concrete example of this duality.

**Required response header:** `x-vercel-ai-ui-message-stream: v1`

### useChat Contract

- **Request:** `POST` to endpoint (default `/api/chat`) with `{ messages: UIMessage[], ...config }`
- **Response:** SSE stream in AI SDK format
- **State management:** Hook manages `UIMessage[]` with `id`, `role`, `parts[]`
- **Status lifecycle:** `ready → submitted → streaming → ready`
- **Methods:** `sendMessage()`, `stop()`, `regenerate()`, `addToolOutput()`

---

## Design: Protocol Mapping & Adapter Architecture

### Recommendation: Adapter Mode

**Rationale:** Full migration to AI SDK is premature and lossy.

The existing V2 protocol carries domain-specific events that have **no AI SDK equivalent**:
- Git state (branch, PR, commits)
- Code review results (diffs, comments)
- Child session spawning and lifecycle
- Multiplayer presence (user.joined / user.left)
- Agent approval gates (`question` event with structured prompts)
- Audit log entries
- Session status changes (initializing, hibernating, etc.)

**Proposed solution:** Add a **thin SSE adapter endpoint** in the worker that:
1. Accepts AI SDK-compatible POST requests
2. Opens an internal WebSocket connection to the SessionAgent DO
3. Translates V2 WebSocket events into AI SDK SSE events
4. Streams SSE frames back to the client
5. Closes cleanly on turn completion or abort

The existing WebSocket flow remains **completely untouched**. The adapter is a read-only translation layer with no state.

### Protocol Mapping Table: V2 → AI SDK SSE

| V2 Event | AI SDK SSE Event(s) | Notes |
|----------|-------------------|-------|
| `message.create` | `message-start` → `text-start` | Start new assistant turn |
| `message.part.text-delta` | `text-delta` | Incremental text token |
| `chunk` | `text-delta` | Parallel text delta (still active); treated same as `message.part.text-delta` |
| `message.part.tool-update` (status=`pending`) | `tool-input-start` | Tool call initiated |
| `message.part.tool-update` (status=`running`, has `args`) | `tool-input-available` | Tool args ready |
| `message.part.tool-update` (status=`completed`) | `tool-output-available` | Tool execution complete |
| `message.part.tool-update` (status=`error`) | `error` | Tool failed |
| `message.finalize` (reason=`end_turn`) | `text-end` → `finish-step` → `message-finish` | Normal turn completion |
| `message.finalize` (reason=`error`) | `error` → `message-finish` | Error termination |
| `message.finalize` (reason=`canceled`) | `text-end` → `message-finish` | User/system abort |
| `agentStatus` | `data-agent-status` (custom event) | Non-standard; emit as custom data event |
| `question` | `data-question` (custom event) | Non-standard; requires custom client handling |
| `message`, `message.updated`, `init` | *(skip)* | Full message objects used for hydration; not streamed |
| `status`, `git-state`, `diff`, etc. | *(skip)* | Domain-specific; not emitted in adapter stream |

### Adapter Architecture

```
Browser (useChat from @ai-sdk/react)
    ↓ POST /api/sessions/:id/chat (SSE request)
    ↓
Worker: SSE adapter route handler
    ↓ Open ephemeral WebSocket to SessionAgent DO (per request)
    ↓ Translate V2 WS events → AI SDK SSE events
    ↓ Write SSE frames to HTTP response stream (streaming, no buffering)
    ↓
SessionAgent DO (unchanged)
    ↓ Existing V2 protocol
    ↓
Runner ↔ OpenCode (unchanged)
```

**Adapter responsibilities:**
1. Accept AI SDK POST body (`{ messages: UIMessage[] }`)
2. Validate auth and session access (see Authentication section)
3. Extract latest user message
4. Open internal WebSocket connection to SessionAgent DO
5. Send prompt message over WebSocket
6. Read V2 events from WebSocket and translate to SSE frames
7. Write SSE frames directly to HTTP response stream (no intermediate buffering)
8. Handle client disconnect (close SSE → send abort over WS → close WS)
9. Close cleanly on `message.finalize` or `complete` event

### Adapter State Model

**Connection model:** One WebSocket connection per SSE request (ephemeral, not pooled).

```
Client POST → Adapter opens WS to DO → sends prompt → streams SSE → WS closes → SSE closes
```

Each request is fully self-contained:
- No persistent connection between SSE requests
- No shared state between concurrent adapter requests
- Next request repeats connection lifecycle from scratch

**Concurrency:** Multiple concurrent SSE requests to the same session are permitted. Each request opens its own WebSocket to the DO. The DO handles concurrent prompts via its existing turn queue — a second prompt sent while a turn is active will be queued and processed after the current turn completes.

**Abort flow:** Client closes SSE connection → adapter detects client disconnect via `request.signal` → adapter sends abort message over WS → adapter closes WS connection. The DO's existing abort handling cancels the active turn.

**Idle timeout:** If no `message.finalize` or `complete` event is received within 120 seconds after the last activity, the adapter sends abort over WS and closes with an error SSE event. This prevents zombie connections from accumulating.

**Backpressure handling:** SSE frames are written directly to the response stream via streaming writes (no intermediate accumulation). If the SSE client is slow to consume, backpressure propagates to the WebSocket read loop. If the unread buffer exceeds 1 MB, the adapter aborts the WS connection and closes the SSE stream with an error. Cloudflare Workers cap at 128 MB memory; the adapter must never buffer full turn content.

### What useChat Gets (Free Features)

With just the adapter endpoint, an AI SDK `useChat` client automatically gets:
- Streaming text display with proper status transitions
- Tool call rendering (pending → running → completed)
- Message history management
- Stop/abort support (client closes SSE; adapter sends abort over WS)
- Error handling with retry
- Optimistic UI updates
- Reconnection and stream recovery (handled by AI SDK internals)

### What useChat Does NOT Get (Domain Events)

These Agent Ops-specific features have no AI SDK equivalent and are **not exposed** via the adapter:
- Session status changes (initializing, hibernating, etc.)
- Git state (branch, PR, commits)
- Diff / code review results
- Child session spawning
- Multiplayer presence (user.joined / user.left)
- Agent question prompts (approval gates with structured choices) — emitted as custom `data-question` event requiring non-standard client handling
- Audit log entries
- Toast notifications

**Recommendation:** For the full-featured Agent Ops UI, continue using the existing `use-chat.ts` WebSocket hook. The AI SDK adapter is for **simpler surfaces** (embeddable widget, mobile app, third-party integrations) that only need the core chat experience.

---

## Implementation Plan

### Phase 1: Minimal Adapter (Core Implementation)

**Goal:** Ship a working SSE adapter endpoint with V2 → AI SDK translation.

#### New Files

| File | Purpose |
|------|---------|
| `packages/worker/src/routes/chat-adapter.ts` | SSE adapter route: `POST /api/sessions/:id/chat` |
| `packages/worker/src/lib/ai-sdk-stream.ts` | V2 → AI SDK SSE event translator |
| `packages/shared/src/types/ai-sdk.ts` | AI SDK SSE event type definitions |

#### Modified Files

| File | Change |
|------|--------|
| `packages/worker/src/index.ts` | Mount `chatAdapterRouter` |

#### Dependencies

| Package | Where | Why |
|---------|-------|-----|
| None | — | Adapter emits raw SSE text; no `@ai-sdk/*` dependency needed on server |
| `@ai-sdk/react` (optional) | `packages/client` | Only needed for demo/testing useChat in existing client |

#### Route Specification

**Endpoint:** `POST /api/sessions/:id/chat`

**Authentication:**
- Header: `Authorization: Bearer <token>`
- Token: Same session auth JWT used for all existing API routes
- Validation: Token must resolve to a valid user; returns `401 Unauthorized` if missing or invalid
- Access control: User must have at least `collaborator` access on the session (same minimum role required to send a prompt via existing routes). Returns `404 Not Found` if session doesn't exist or user lacks access, consistent with `assertSessionAccess` behavior.
- Orchestrator sessions are never accessible to non-owners (same as existing access control).

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    { "role": "user", "content": "What's 2+2?" }
  ]
}
```

**Response:**
- `Content-Type: text/event-stream`
- `x-vercel-ai-ui-message-stream: v1`
- SSE frames per AI SDK data stream protocol

**Behavior:**
1. Validate auth and session access
2. Extract latest user message from `messages[]` (adapter is not the source of truth for history)
3. Open internal WebSocket to SessionAgent DO
4. Send prompt over WebSocket
5. Stream V2 events → translate to SSE → write to response
6. Close on `message.finalize` or `complete`, or on client disconnect

**Message history handling:** The SessionAgent DO is the canonical source of message history. The adapter ignores prior messages in the POST body (except to extract the latest user message). This prevents client-provided history from diverging from the DO's canonical state.

#### Translator Pseudocode

```typescript
function translateV2ToAISDK(v2Event: WSEvent): SSEFrame[] {
  switch (v2Event.type) {
    case 'message':
    case 'message.updated':
    case 'init':
      // Full message objects — used for init hydration, skip during streaming
      return [];

    case 'chunk':
      // Actively-emitted text delta (parallel to message.part.text-delta)
      return [{
        type: 'text-delta',
        id: v2Event.messageId,
        delta: v2Event.content
      }];

    case 'message.create':
      return [
        { type: 'start', messageId: v2Event.turnId },
        { type: 'text-start', id: v2Event.turnId }
      ];

    case 'message.part.text-delta':
      return [{
        type: 'text-delta',
        id: v2Event.turnId,
        delta: v2Event.delta
      }];

    case 'message.part.tool-update':
      return translateToolUpdate(v2Event);

    case 'message.finalize':
      return translateFinalize(v2Event);

    case 'agentStatus':
      // Custom event; emit as data-agent-status
      return [{
        type: 'data-agent-status',
        status: v2Event.status,
        detail: v2Event.detail
      }];

    case 'question':
      // Custom event; emit as data-question for clients that need approval gates
      return [{
        type: 'data-question',
        question: v2Event
      }];

    default:
      // Domain events (git-state, diff, etc.) — skip
      return [];
  }
}

function translateToolUpdate(event: ToolUpdateEvent): SSEFrame[] {
  switch (event.status) {
    case 'pending':
      return [{
        type: 'tool-input-start',
        toolCallId: event.callId,
        toolName: event.toolName
      }];

    case 'running':
      if (event.args) {
        return [{
          type: 'tool-input-available',
          toolCallId: event.callId,
          toolName: event.toolName,
          input: event.args
        }];
      }
      return [];

    case 'completed':
      return [{
        type: 'tool-output-available',
        toolCallId: event.callId,
        output: event.result
      }];

    case 'error':
      return [{
        type: 'error',
        errorText: event.error || 'Tool execution failed'
      }];

    default:
      return [];
  }
}

function translateFinalize(event: FinalizeEvent): SSEFrame[] {
  switch (event.reason) {
    case 'end_turn':
      return [
        { type: 'text-end', id: event.turnId },
        { type: 'finish-step' },
        { type: 'finish' }
      ];

    case 'error':
      return [
        { type: 'error', errorText: event.error || 'Turn failed' },
        { type: 'finish' }
      ];

    case 'canceled':
      return [
        { type: 'text-end', id: event.turnId },
        { type: 'finish' }
      ];

    default:
      return [{ type: 'finish' }];
  }
}
```

#### Translator Edge Cases

- **Empty turn** (`message.create` immediately followed by `message.finalize` with no deltas):
  Emit `start` → `text-start` → `text-end` → `finish`. The AI SDK client receives an empty assistant message, which is valid.

- **Out-of-order tool results:** SSE events are emitted in the order received from the WS. The AI SDK client correlates tool input and output events by `toolCallId`, not by position, so arrival order does not affect correctness.

- **Mid-stream agentStatus:** Emit `data-agent-status` interleaved with text/tool events. Standard AI SDK clients ignore unrecognized event types; custom clients can subscribe to `data-agent-status` for progress indicators.

- **Duplicate text deltas from `chunk` and `message.part.text-delta`:** Both events are currently broadcast by the DO for the same delta. The adapter must deduplicate — prefer `message.part.text-delta` (V2 canonical) and drop `chunk` for the same `turnId`/`messageId`. If only `chunk` is received (e.g. before V2 migration is complete), emit it. Implementation detail: track `seenTurnIds` and emit from whichever arrives first.

### Phase 2: Client Experiment (Feature Flag)

**Goal:** Test AI SDK `useChat` hook in the existing client behind a feature flag.

#### New Files

| File | Purpose |
|------|---------|
| `packages/client/src/hooks/use-ai-chat.ts` | Thin wrapper around `useChat` from `@ai-sdk/react`, configured with adapter endpoint |
| `packages/client/src/components/sessions/ai-chat-panel.tsx` | Experimental chat panel using AI SDK hook |

#### Modified Files

| File | Change |
|------|--------|
| `packages/client/package.json` | Add `@ai-sdk/react` dependency |
| Session editor page | Feature flag to swap between custom hook and AI SDK hook |

**Multi-channel extension (Phase 2+):** AI SDK has no native channel concept. If multi-channel support is needed, the adapter can accept an optional query parameter:

```
POST /api/sessions/:id/chat?channelId=slack-123
```

The adapter would include `channelType` and `channelId` when sending the prompt over WS, scoping the SSE stream to that channel's messages. Channel discovery for AI SDK clients is an open design question (response header or separate `GET /api/sessions/:id/channels` endpoint).

### Phase 3: Hardening & Documentation

**Goal:** Production-ready adapter with comprehensive tests and documentation.

- Unit test suite for V2 → AI SDK translator (every event mapping)
- Integration test: send prompt through adapter, verify SSE stream matches AI SDK expectations
- Test stream recovery and reconnection behavior
- Test abort flow (client disconnect → agent abort)
- Document adapter architecture and limitations (no domain events)
- Create GitHub issues for follow-up implementation work

---

## Error Handling & Recovery

### Error Scenario Matrix

| Error Scenario | Adapter Behavior |
|----------------|------------------|
| WS connection to DO fails to open | Emit `error` SSE event with "Connection failed", close stream |
| WS closes unexpectedly mid-stream | Emit `error` SSE event with "Stream interrupted", close stream |
| DO sends `error` WS event | Translate to `error` SSE event, emit `finish`, close stream |
| `message.finalize` with reason=`error` | Translate to `error` SSE event, emit `finish`, close stream |
| Client disconnects SSE | Detect via `request.signal` abort, send abort over WS, close WS |
| Idle timeout (>120s no activity) | Send abort over WS, emit `error` SSE event, close stream |
| Backpressure buffer exceeds 1 MB | Abort WS connection, emit `error` SSE event, close stream |
| Auth failure | Return `401` HTTP error before opening WS (no SSE stream) |
| Session not found or access denied | Return `404` HTTP error before opening WS |

**No automatic retry:** The adapter does not retry failed WS connections. The AI SDK client is responsible for retry logic via the `useChat` hook's built-in reconnection behavior.

**SSE error format:**
```
event: error
data: {"type":"error","errorText":"Stream interrupted"}

event: message-finish
data: {"type":"finish"}
```

---

## Test Plan

### Unit Tests (`packages/worker/src/lib/ai-sdk-stream.test.ts`)

| Test Case | Assertion |
|-----------|-----------|
| `message.create` → `start` + `text-start` | Correct SSE event types and IDs |
| `message.part.text-delta` → `text-delta` | Delta content preserved exactly |
| `chunk` → `text-delta` | Content and messageId mapped correctly |
| `message.part.tool-update` (pending) → `tool-input-start` | `toolCallId` and `toolName` correct |
| `message.part.tool-update` (running+args) → `tool-input-available` | Input object matches args |
| `message.part.tool-update` (completed) → `tool-output-available` | Output object matches result |
| `message.part.tool-update` (error) → `error` | Error text preserved |
| `message.finalize` (end_turn) → `text-end` + `finish-step` + `message-finish` | Correct event sequence |
| `message.finalize` (error) → `error` + `message-finish` | Error text preserved |
| `message.finalize` (canceled) → `text-end` + `message-finish` | Clean termination without error |
| Empty turn (create → finalize, no deltas) | `start` → `text-start` → `text-end` → `finish` |
| Unknown V2 event → empty array | No crash, no output |
| Full turn lifecycle | Create → deltas → tool → finalize produces valid SSE stream |
| Multiple tool calls in single turn | Each tool gets unique `toolCallId` |
| Concurrent text and tool updates | Correct interleaving of SSE events |
| `agentStatus` → `data-agent-status` | Status and detail fields preserved |
| `question` → `data-question` | Full question payload preserved |
| Skipped events (`message`, `init`, domain events) | Returns empty array |

### Integration Tests (Phase 3)

1. **Round-trip test:**
   - POST to adapter with user message
   - Verify SSE stream is parseable by `@ai-sdk/react` internals
   - Validate message-start → text-delta → message-finish sequence

2. **Abort test:**
   - Client closes SSE connection mid-stream
   - Verify SessionAgent DO receives abort signal
   - Verify turn is properly canceled

3. **Auth test:**
   - Unauthenticated request → `401 Unauthorized`
   - Invalid session ID → `404 Not Found`
   - Viewer-only user attempting to send prompt → `404 Not Found` (consistent with `assertSessionAccess`)

4. **Tool execution test:**
   - Prompt that triggers tool call
   - Verify `tool-input-start` → `tool-input-available` → `tool-output-available` sequence
   - Validate tool output is correctly formatted

5. **Error handling test:**
   - Trigger agent error
   - Verify `error` event with correct error text
   - Verify stream closes cleanly

6. **Long-running turn test:**
   - Prompt that generates 1000+ text deltas
   - Verify no SSE frame is dropped
   - Verify correct final message assembly

7. **Performance test:**
   - Measure adapter overhead vs. direct WebSocket latency (target: <5ms added latency per frame)
   - Test 100 concurrent SSE streams to the same session
   - Run 1000 sequential requests, verify heap does not grow (no memory leak)
   - Measure max sustainable request rate at p99 < 200ms time-to-first-byte

### Manual Testing Checklist

- [ ] Adapter endpoint returns correct `Content-Type` and `x-vercel-ai-ui-message-stream` header
- [ ] SSE stream is readable by AI SDK client libraries
- [ ] Tool calls render correctly in `useChat` UI
- [ ] Stop button (client disconnect) properly aborts agent turn
- [ ] Error messages display correctly
- [ ] Multiple rapid prompts don't cause state corruption
- [ ] Adapter works with different session types (OpenCode, gemini, etc.)

---

## Open Questions & Recommended Resolutions

### 1. SSE vs WebSocket for Adapter Connection

**Question:** The adapter bridges SSE (client-facing) to WebSocket (DO-facing). This adds one extra hop. Is the latency acceptable?

**Recommendation:** Yes, proceed with SSE → WS bridge.
- All hops are within the same Cloudflare edge network (sub-millisecond latency)
- AI SDK expects SSE; changing client protocol would lose ecosystem compatibility
- Alternative (pure WebSocket) would require custom client, defeating the purpose

### 2. Message History Handling

**Question:** AI SDK `useChat` sends full message history on each POST. SessionAgent DO already maintains its own history. Should the adapter ignore the AI SDK history and just extract the latest user message?

**Recommendation:** Yes, treat the DO as the source of truth.
- DO already has complete message history (from init hydration)
- Trusting client-provided history risks state divergence
- Adapter extracts only the latest user message and sends it as a prompt
- If client history is stale, rely on DO's canonical state

### 3. Tool Execution Model

**Question:** AI SDK supports `addToolOutput()` for client-side tool execution. Agent Ops tools run server-side (in sandbox). Should the adapter expose `addToolOutput()`?

**Recommendation:** No, do not expose `addToolOutput()`.
- Agent Ops tools are executed server-side by the agent in the sandbox
- Client should treat tools as read-only (display status, args, results only)
- `useChat` hook should **not** pass a `tools` config; tool definitions live in the agent's server-side registry
- If the client calls `addToolOutput()`, it has no effect — the adapter ignores any tool output sent by the client
- The adapter does not forward client-provided tool results to the DO

**Phase 2+ extension:** The adapter could expose tool schemas in response headers for client-side rendering (e.g. to show tool descriptions in the UI), while tool execution remains server-side.

### 4. Multi-Channel Support

**Question:** The existing protocol supports channel-scoped turns (`channelType` + `channelId`). Should the adapter expose multi-channel functionality?

**Recommendation:** Out of scope for Phase 1. Default to single channel.
- AI SDK has no native concept of channels
- Adapter should route all messages to the default channel
- Phase 2+ design: accept `?channelId=` query param (see Phase 2 section above)

### 5. Question/Approval Gate Handling

**Question:** When the agent asks a question (`question` event), the custom UI shows a structured prompt. How should the adapter represent this?

**Recommendation:** **Emit as custom `data-question` SSE event.**
- Option A: Emit as assistant text message ("Do you want to proceed? [yes/no]") — loses structure
- Option B: Emit as custom `data-question` SSE event — requires custom client handling
- **Choose Option B:** Clients that need approval gates can listen for `data-question` events; simple clients can ignore them. Losing the structured prompt in the SSE stream would degrade the experience for clients that need it.

Clients using standard `useChat` will not see question prompts. Full approval gate support requires custom client handling outside AI SDK.

### 6. Streaming Delta Granularity

**Question:** V2 protocol emits per-token deltas. AI SDK clients may batch deltas for performance. Should the adapter batch or emit every delta?

**Recommendation:** Emit every delta (no batching).
- Preserve real-time streaming feel
- AI SDK client can batch on its end if needed
- Batching adds complexity and latency

---

## Non-Goals

Explicitly **out of scope** for this RFC and Phase 1 implementation:

- No removal or deprecation of existing `use-chat.ts` WebSocket hook
- No changes to Runner ↔ DO protocol
- No changes to SessionAgent DO internals (adapter is read-only layer)
- No AI SDK dependency on the server side (pure SSE text output)
- No Slack/Telegram/channel transport changes
- No migration of existing client to AI SDK (feature flag experiment only)
- No support for client-side tool execution
- No support for domain events (git, diffs, reviews, etc.) in adapter stream

---

## Production Risks & Mitigations

### Critical Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **DO WebSocket connection limits** | Each SSE request opens one WS to the DO. Cloudflare limits concurrent WS connections per DO instance. At high scale, 100+ concurrent SSE clients could exhaust this limit. | Phase 1: document limit and monitor. Phase 2: implement connection pooling or a fan-out multiplexer WS connection shared across SSE clients for the same session. |
| **SSE idle timeout (CF Workers Streams)** | Cloudflare Workers cap CPU time at 30s for standard mode but extend to 15 minutes for Streams mode. Long agent turns (e.g., a 5-minute code review) may approach this limit. | Confirm Workers Streams mode is enabled for the adapter route. Add keepalive SSE comments (`: keepalive\n\n`) every 15s to prevent premature timeout. |
| **AI SDK version compatibility** | The AI SDK data stream protocol is not formally versioned; breaking changes between v5, v6, and future versions could silently break the adapter. | Pin to a specific AI SDK version in `packages/client`. Add CI test that parses adapter SSE output against the expected event schema. Pin `x-vercel-ai-ui-message-stream: v1` header and document what version of the protocol it corresponds to. |
| **Memory leak in long-lived adapter connections** | If the adapter buffers events while waiting for client consumption, heap can grow unbounded over the lifetime of a long turn. | Use streaming writes (no intermediate accumulation). Apply the 1 MB backpressure limit described in the State Model section. |
| **chunk + text-delta deduplication** | Both events are emitted by the DO for the same delta. Without deduplication, the AI SDK client receives doubled text output. | Adapter tracks active turn IDs and deduplicates as described in the translator edge cases section. Unit tested explicitly. |

---

## Rollout Plan

### Deployment Strategy

1. **Phase 1 (adapter endpoint):** Deploy behind a worker-level feature flag (`ENABLE_AI_SDK_ADAPTER=true` env var). Disabled by default in production until integration tests pass.
2. **Phase 2 (client experiment):** Enable via per-session feature flag in the existing session settings. Users opt in manually.
3. **Phase 3 (general availability):** Remove feature flags after performance tests pass and no regressions observed in Phase 2 experiment.

### Rollback

The adapter endpoint is additive — it does not modify existing routes or DO behavior. Rollback is as simple as setting `ENABLE_AI_SDK_ADAPTER=false` or removing the route mount in `index.ts`.

---

## Observability Plan

### Metrics to Track

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `adapter.request.count` | Total SSE requests to adapter | — |
| `adapter.request.error_rate` | % of requests ending in error SSE event | > 5% |
| `adapter.latency.ttfb_p99` | Time to first SSE byte (p99) | > 500ms |
| `adapter.latency.turn_duration_p99` | Time from request to `message-finish` (p99) | — |
| `adapter.ws.open_failures` | WS connections to DO that failed to open | > 0 in 5 min |
| `adapter.stream.aborts.client` | Streams closed by client before `message-finish` | — |
| `adapter.stream.aborts.server` | Streams closed by adapter due to error/timeout | > 1% |
| `adapter.translation.unknown_events` | V2 events not matched by translator | > 0 (indicates protocol drift) |

These metrics should be emitted via Cloudflare Analytics Engine or a lightweight telemetry sink accessible from Workers.

---

## Follow-Up Tickets

Create these GitHub issues after RFC approval:

1. **`feat(worker): add AI SDK SSE adapter endpoint`** (Phase 1)
   - Implement `POST /api/sessions/:id/chat` route
   - Implement V2 → AI SDK translator with deduplication
   - Add SSE streaming logic with backpressure handling
   - Add abort handling via `request.signal`
   - Add idle timeout (120s)

2. **`feat(client): add experimental useChat path behind feature flag`** (Phase 2)
   - Add `@ai-sdk/react` dependency
   - Create `use-ai-chat.ts` wrapper
   - Create experimental chat panel component
   - Add feature flag to session editor

3. **`test(worker): V2 → AI SDK stream translator test suite`** (Phase 3)
   - Unit tests for every event mapping (including edge cases and deduplication)
   - Full turn lifecycle tests
   - Tool call tests
   - Error handling tests

4. **`test(worker): AI SDK adapter integration tests`** (Phase 3)
   - Round-trip SSE stream tests
   - Abort flow tests
   - Auth tests
   - Tool execution tests
   - Performance tests (latency, concurrency, memory)

5. **`docs(architecture): AI SDK adapter design and limitations`** (Phase 3)
   - Document adapter architecture
   - Document protocol mapping
   - Document limitations (no domain events)
   - Add usage examples

---

## Acceptance Criteria

This RFC is considered complete when:

- [x] RFC document committed at `docs/rfcs/ai-sdk-chat-adapter.md`
- [x] Clear recommendation: adapter mode (not full migration), with rationale
- [x] Complete V2 → AI SDK protocol mapping table (including `chunk` event)
- [x] Adapter state model documented (connection lifecycle, concurrency, abort)
- [x] Auth and RBAC requirements specified
- [x] Error handling and recovery matrix defined
- [x] Production risks and mitigations identified
- [x] Rollout plan defined
- [x] Observability plan defined
- [x] Identified list of files to create/modify for Phase 1
- [x] Test plan defined for stream/message parity (unit + integration + performance)
- [x] Follow-up implementation tickets outlined
- [x] Open questions documented with recommended resolutions

---

## Appendix A: AI SDK SSE Example Stream

For reference, here's what a typical AI SDK SSE stream looks like for a turn that includes tool use:

```
event: message-start
data: {"type":"start","messageId":"msg-123"}

event: text-start
data: {"type":"text-start","id":"msg-123"}

event: text-delta
data: {"type":"text-delta","id":"msg-123","delta":"The"}

event: text-delta
data: {"type":"text-delta","id":"msg-123","delta":" answer"}

event: text-delta
data: {"type":"text-delta","id":"msg-123","delta":" is"}

event: tool-input-start
data: {"type":"tool-input-start","toolCallId":"call-456","toolName":"calculator"}

event: tool-input-available
data: {"type":"tool-input-available","toolCallId":"call-456","toolName":"calculator","input":{"expression":"2+2"}}

event: tool-output-available
data: {"type":"tool-output-available","toolCallId":"call-456","output":{"result":4}}

event: text-delta
data: {"type":"text-delta","id":"msg-123","delta":" 4."}

event: text-end
data: {"type":"text-end","id":"msg-123"}

event: finish-step
data: {"type":"finish-step"}

event: message-finish
data: {"type":"finish"}
```

> **SSE `event:` vs JSON `type`:** The `event:` line is the full semantic name used for SSE event filtering (e.g., in `addEventListener('message-start', ...)`). The JSON `type` field is the key AI SDK internals parse from the `data:` payload. For most events they match (e.g., `event: text-delta` / `"type":"text-delta"`), but for the message boundary events they differ: `event: message-start` has `"type":"start"`, and `event: message-finish` has `"type":"finish"`. This is intentional in the AI SDK data stream v1 protocol. The adapter must emit both the `event:` line and the correct JSON `type` field for every frame.

---

## Appendix B: Client Example Code

Minimal `useChat` integration against the adapter endpoint:

```tsx
import { useChat } from '@ai-sdk/react';

interface Props {
  sessionId: string;
  token: string;
}

export function SimpleChat({ sessionId, token }: Props) {
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: `/api/sessions/${sessionId}/chat`,
    headers: { Authorization: `Bearer ${token}` },
    // Do NOT pass `tools` — all tools are server-side
  });

  return (
    <div>
      <div>
        {messages.map(m => (
          <div key={m.id} data-role={m.role}>
            {m.parts.map((part, i) => {
              if (part.type === 'text') return <span key={i}>{part.text}</span>;
              if (part.type === 'tool-invocation') {
                return (
                  <div key={i}>
                    <strong>{part.toolName}</strong>: {JSON.stringify(part.result)}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message..."
          disabled={status !== 'ready'}
        />
        <button type="submit" disabled={status !== 'ready'}>Send</button>
      </form>
    </div>
  );
}
```

This component has no knowledge of V2 protocol, WebSocket connections, or Agent Ops-specific event types. Domain-specific features (git state, approval gates, child sessions) require the full `use-chat.ts` hook.

---

## Conclusion

The SSE adapter approach provides a clean separation of concerns:

- **AI SDK clients** get ecosystem-standard integration with zero custom code
- **Full-featured UI** keeps domain-specific features via existing WebSocket protocol
- **No breaking changes** to existing architecture
- **Minimal implementation risk** (adapter is stateless translation layer)

This RFC recommends proceeding with Phase 1 implementation as the next step.
