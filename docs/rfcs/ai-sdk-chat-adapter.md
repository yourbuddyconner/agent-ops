# RFC: Vercel AI SDK Chat Adapter

**Status:** Draft  
**Author:** monad (AI subagent)  
**Date:** 2026-02-26  
**Bean ID:** agent-ops-ai5k

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

| WS Event | Shape | Purpose |
|----------|-------|---------|
| `init` | Full session hydration | `messages[]`, models, users, audit log |
| `message` | Complete message object | Full message with all parts |
| `message.updated` | Updated message with parts | Incremental updates during streaming |
| `chunk` | `{ content, messageId? }` | Legacy text delta |
| `status` | Session status change | Session lifecycle events |
| `question` | Agent asking for user input | Approval gates, interactive prompts |
| `agentStatus` | Agent state change | Current agent state |
| `error` | Error message | Error notifications |
| ~10 more event types | Various shapes | git-state, diff, review, child-session, etc. |

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

| SSE Event | JSON Shape | Purpose |
|-----------|-----------|---------|
| `message-start` | `{ type: "start", messageId }` | Begin new assistant message |
| `text-start` | `{ type: "text-start", id }` | Begin text content block |
| `text-delta` | `{ type: "text-delta", id, delta }` | Incremental text token |
| `text-end` | `{ type: "text-end", id }` | Text content complete |
| `tool-input-start` | `{ type: "tool-input-start", toolCallId, toolName }` | Tool call initiated |
| `tool-input-delta` | `{ type: "tool-input-delta", toolCallId, inputTextDelta }` | Tool args streaming |
| `tool-input-available` | `{ type: "tool-input-available", toolCallId, toolName, input }` | Tool args complete |
| `tool-output-available` | `{ type: "tool-output-available", toolCallId, output }` | Tool result ready |
| `start-step` / `finish-step` | Step boundary markers | Multi-step reasoning |
| `message-finish` | `{ type: "finish" }` | Message complete |
| `error` | `{ type: "error", errorText }` | Error condition |

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
| `message.part.tool-update` (status=`pending`) | `tool-input-start` | Tool call initiated |
| `message.part.tool-update` (status=`running`, has `args`) | `tool-input-available` | Tool args ready |
| `message.part.tool-update` (status=`completed`) | `tool-output-available` | Tool execution complete |
| `message.finalize` (reason=`end_turn`) | `text-end` → `finish-step` → `message-finish` | Normal turn completion |
| `message.finalize` (reason=`error`) | `error` → `message-finish` | Error termination |
| `message.finalize` (reason=`canceled`) | `text-end` → `message-finish` | User/system abort |
| `agentStatus` | `data-agent-status` (custom event) | Non-standard; emit as custom data event |
| `question` | `data-question` (custom event) | Non-standard; requires custom client handling |
| `status`, `git-state`, `diff`, etc. | *(no mapping)* | Domain-specific; not emitted in adapter stream |

### Adapter Architecture

```
Browser (useChat from @ai-sdk/react)
    ↓ POST /api/sessions/:id/chat (SSE request)
    ↓
Worker: SSE adapter route handler
    ↓ Open internal WebSocket to SessionAgent DO
    ↓ Translate V2 WS events → AI SDK SSE events
    ↓ Write SSE frames to HTTP response stream
    ↓
SessionAgent DO (unchanged)
    ↓ Existing V2 protocol
    ↓
Runner ↔ OpenCode (unchanged)
```

**Adapter responsibilities:**
1. Accept AI SDK POST body (`{ messages: UIMessage[] }`)
2. Extract latest user message
3. Open internal WebSocket connection to SessionAgent DO (same path as existing client)
4. Send prompt message over WebSocket
5. Read V2 events from WebSocket and translate to SSE frames
6. Stream SSE frames back to HTTP response
7. Handle client disconnect (close SSE → send abort over WS)
8. Close cleanly on `message.finalize` or `complete` event

### What useChat Gets (Free Features)

With just the adapter endpoint, an AI SDK `useChat` client automatically gets:
- ✅ Streaming text display with proper status transitions
- ✅ Tool call rendering (pending → running → completed)
- ✅ Message history management
- ✅ Stop/abort support (client closes SSE; adapter sends abort over WS)
- ✅ Error handling with retry
- ✅ Optimistic UI updates
- ✅ Reconnection and stream recovery (handled by AI SDK internals)

### What useChat Does NOT Get (Domain Events)

These Agent Ops-specific features have no AI SDK equivalent and are **not exposed** via the adapter:
- ❌ Session status changes (initializing, hibernating, etc.)
- ❌ Git state (branch, PR, commits)
- ❌ Diff / code review results
- ❌ Child session spawning
- ❌ Multiplayer presence (user.joined / user.left)
- ❌ Agent question prompts (approval gates with structured choices)
- ❌ Audit log entries
- ❌ Toast notifications

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

**Authentication:** Bearer token (same as existing routes)

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
1. Extract latest user message from `messages[]`
2. Open internal WebSocket to SessionAgent DO
3. Send prompt over WebSocket
4. Stream V2 events → translate to SSE → write to response
5. Close on `message.finalize` or client disconnect

#### Translator Pseudocode

```typescript
function translateV2ToAISDK(v2Event: WSEvent): SSEFrame[] {
  switch (v2Event.type) {
    case 'message':
    case 'message.updated':
      // Full message — used for init hydration, skip during streaming
      return [];

    case 'chunk':
      // Legacy text delta — map to text-delta
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

### Phase 3: Hardening & Documentation

**Goal:** Production-ready adapter with comprehensive tests and documentation.

- ✅ Unit test suite for V2 → AI SDK translator (every event mapping)
- ✅ Integration test: send prompt through adapter, verify SSE stream matches AI SDK expectations
- ✅ Test stream recovery and reconnection behavior
- ✅ Test abort flow (client disconnect → agent abort)
- ✅ Document adapter architecture and limitations (no domain events)
- ✅ Create GitHub issues for follow-up implementation work

---

## Test Plan

### Unit Tests (`packages/worker/src/lib/ai-sdk-stream.test.ts`)

| Test Case | Assertion |
|-----------|-----------|
| `message.create` → `start` + `text-start` | Correct SSE event types and IDs |
| `message.part.text-delta` → `text-delta` | Delta content preserved exactly |
| `message.part.tool-update` (pending) → `tool-input-start` | `toolCallId` and `toolName` correct |
| `message.part.tool-update` (running+args) → `tool-input-available` | Input object matches args |
| `message.part.tool-update` (completed) → `tool-output-available` | Output object matches result |
| `message.finalize` (end_turn) → `text-end` + `finish-step` + `message-finish` | Correct event sequence |
| `message.finalize` (error) → `error` + `message-finish` | Error text preserved |
| `message.finalize` (canceled) → `text-end` + `message-finish` | Clean termination without error |
| Unknown V2 event → empty array | No crash, no output |
| Full turn lifecycle | Create → deltas → tool → finalize produces valid SSE stream |
| Multiple tool calls in single turn | Each tool gets unique `toolCallId` |
| Concurrent text and tool updates | Correct interleaving of SSE events |

### Integration Tests (Phase 3)

**Test Scenarios:**

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
   - Wrong user (different owner) → `403 Forbidden`

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
- Adapter should extract only the latest user message and send it as a prompt
- If client history is stale, rely on DO's canonical state

### 3. Tool Execution Model

**Question:** AI SDK supports `addToolOutput()` for client-side tool execution. Agent Ops tools run server-side (in sandbox). Should the adapter expose `addToolOutput()`?

**Recommendation:** No, do not expose `addToolOutput()`.
- Agent Ops tools are executed server-side by the agent
- Client should treat tools as read-only (display status, args, results)
- AI SDK's `tools` config should indicate server-executed tools (no client-side execution)
- If AI SDK client tries to send tool output, adapter should reject with error

### 4. Multi-Channel Support

**Question:** The existing protocol supports channel-scoped turns (`channelType` + `channelId`). Should the adapter expose multi-channel functionality?

**Recommendation:** Out of scope for Phase 1. Default to single channel.
- AI SDK has no native concept of channels
- Adapter should route all messages to the default channel
- Multi-channel support could be added in Phase 2+ with custom query params (e.g., `?channelId=slack-123`)

### 5. Question/Approval Gate Handling

**Question:** When the agent asks a question (`question` event), the custom UI shows a structured prompt. How should the adapter represent this?

**Recommendation:** Emit as custom `data-question` event.
- Option A: Emit as assistant text message ("Do you want to proceed? [yes/no]") — loses structure
- Option B: Emit as custom `data-question` SSE event — requires custom client handling
- **Choose Option B:** Clients that need approval gates can listen for `data-question` events; simple clients can ignore them

**Follow-up:** Document that full approval gate support requires custom client handling outside AI SDK.

### 6. Streaming Delta Granularity

**Question:** V2 protocol emits per-token deltas. AI SDK clients may batch deltas for performance. Should the adapter batch or emit every delta?

**Recommendation:** Emit every delta (no batching).
- Preserve real-time streaming feel
- AI SDK client can batch on its end if needed
- Batching adds complexity and latency

---

## Non-Goals

Explicitly **out of scope** for this RFC and Phase 1 implementation:

- ❌ No removal or deprecation of existing `use-chat.ts` WebSocket hook
- ❌ No changes to Runner ↔ DO protocol
- ❌ No changes to SessionAgent DO internals (adapter is read-only layer)
- ❌ No AI SDK dependency on the server side (pure SSE text output)
- ❌ No Slack/Telegram/channel transport changes
- ❌ No migration of existing client to AI SDK (feature flag experiment only)
- ❌ No support for client-side tool execution
- ❌ No support for domain events (git, diffs, reviews, etc.) in adapter stream

---

## Follow-Up Tickets

Create these GitHub issues after RFC approval:

1. **`feat(worker): add AI SDK SSE adapter endpoint`** (Phase 1)
   - Implement `POST /api/sessions/:id/chat` route
   - Implement V2 → AI SDK translator
   - Add SSE streaming logic
   - Add abort handling

2. **`feat(client): add experimental useChat path behind feature flag`** (Phase 2)
   - Add `@ai-sdk/react` dependency
   - Create `use-ai-chat.ts` wrapper
   - Create experimental chat panel component
   - Add feature flag to session editor

3. **`test(worker): V2 → AI SDK stream translator test suite`** (Phase 3)
   - Unit tests for every event mapping
   - Full turn lifecycle tests
   - Tool call tests
   - Error handling tests

4. **`test(worker): AI SDK adapter integration tests`** (Phase 3)
   - Round-trip SSE stream tests
   - Abort flow tests
   - Auth tests
   - Tool execution tests

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
- [x] Complete V2 → AI SDK protocol mapping table
- [x] Identified list of files to create/modify for Phase 1
- [x] Test plan defined for stream/message parity (unit + integration)
- [x] Follow-up implementation tickets outlined
- [x] Open questions documented with recommended resolutions

---

## Appendix: AI SDK SSE Example Stream

For reference, here's what a typical AI SDK SSE stream looks like:

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

---

## Conclusion

The SSE adapter approach provides a clean separation of concerns:

- **AI SDK clients** get ecosystem-standard integration with zero custom code
- **Full-featured UI** keeps domain-specific features via existing WebSocket protocol
- **No breaking changes** to existing architecture
- **Minimal implementation risk** (adapter is stateless translation layer)

This RFC recommends proceeding with Phase 1 implementation as the next step.
