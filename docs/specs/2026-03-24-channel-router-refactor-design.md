# Channel Router Refactor — Design Spec

**Date:** 2026-03-24
**Linear:** TKAI-9
**Status:** Draft

## Problem

The channel router has an auto-reply code path that automatically sends the agent's last response to the originating Slack channel/thread when a prompt cycle completes — even if the agent didn't explicitly call `channel_reply`. This causes:

1. **Internal messages leak to Slack** — orchestrator internal chatter gets posted to user-facing threads
2. **Double-posting** — when the agent calls `channel_reply`, the auto-reply fires too with a slightly different version

Beyond the bug, channel routing logic is scattered across session-agent.ts (~130 lines in `handleChannelReply()`), `channel-router.ts` (pure auto-reply state machine), and `services/channel-reply.ts` (auto-reply dispatch). The `ChannelRouter` class name implies routing but only tracks auto-reply state.

## Goals

1. Remove the auto-reply code path entirely — all channel messages sent exclusively via explicit `channel_reply` tool calls
2. Consolidate channel routing logic into `ChannelRouter` so it owns transport dispatch, token resolution, and message building
3. Move Slack shimmer clearing into the Slack transport where it belongs
4. Keep follow-up reminders as a soft safety net

## Non-Goals

- Treating the web UI as a channel (noted as a future TODO)
- Changing the `channel_reply` OpenCode tool, Runner gateway route, or agent-client WebSocket protocol
- Modifying the follow-up reminder alarm logic
- Consolidating interactive-prompt dispatch (`sendChannelInteractivePrompts` / `updateChannelInteractivePrompts`) — these use their own transport + token resolution and are out of scope. TODO: consolidate into ChannelRouter in a follow-up.

## Design

### ChannelRouter — New Shape

`ChannelRouter` becomes a self-contained channel routing service. It owns: active channel tracking, transport dispatch, token resolution, composite channelId parsing, outbound message building, and follow-up lifecycle notifications.

#### Constructor Dependencies

Injected by the DO at construction to keep ChannelRouter testable without mocking the DO:

```ts
interface ChannelRouterDeps {
  /** Resolve auth token for a channel. Slack uses org-level bot token, others use per-user credentials. */
  resolveToken(channelType: string, userId: string): Promise<string | undefined>;
  /** Resolve persona identity for Slack messages. */
  resolvePersona(userId: string): Promise<Persona | undefined>;
  /** Callback when a reply is successfully sent — DO uses this to resolve follow-up reminders. */
  onReplySent(channelType: string, channelId: string): void;
}
```

#### Public API

| Method | Purpose |
|--------|---------|
| `setActiveChannel(channel: { channelType: string; channelId: string })` | Track which channel the current prompt is associated with. Called at prompt dispatch. |
| `clearActiveChannel()` | Clear on new prompt cycle or dispatch failure. |
| `get activeChannel: { channelType: string; channelId: string } \| null` | Current channel context. Used by agent status broadcasts, approvals, interactive prompts. |
| `recoverActiveChannel(channelType: string, channelId: string)` | Restore tracking state after DO hibernation, from prompt_queue data. |
| `sendReply(opts: SendReplyOpts): Promise<SendReplyResult>` | Explicit channel reply dispatch. See below. |

#### sendReply

```ts
interface SendReplyOpts {
  userId: string;
  channelType: string;
  channelId: string;
  message: string;
  fileBase64?: string;
  fileMimeType?: string;
  fileName?: string;
  /** Legacy image params — sendReply normalizes to file params internally. */
  imageBase64?: string;
  imageMimeType?: string;
  /** Whether this counts as a substantive reply for follow-up resolution. Default true. */
  followUp?: boolean;
}

interface SendReplyResult {
  success: boolean;
  error?: string;
}
```

Internal flow:
1. Resolve transport via `channelRegistry.getTransport(channelType)`
2. Resolve token via `deps.resolveToken(channelType, userId)`
3. Parse composite channelId (Slack encodes `channelId:threadTs`)
4. Build `OutboundMessage` with attachments if present
5. Resolve persona via `deps.resolvePersona(userId)` for Slack
6. Call `transport.sendMessage(target, outbound, ctx)`
7. On success, call `deps.onReplySent(channelType, channelId)` if `followUp !== false`
8. Return result

### What Gets Removed

#### Deleted files
- `packages/worker/src/services/channel-reply.ts` — auto-reply dispatch service, only consumer is `flushPendingChannelReply()`
- `packages/worker/src/durable-objects/channel-router.test.ts` — tests for auto-reply state machine (replaced by new tests)

#### Removed from ChannelRouter
- `PendingReply` interface, `ReplyIntent` interface
- `trackReply()`, `setResult()`, `consumePendingReply()`, `markHandled()`, `recover()`
- `hasPending`, `pendingSnapshot` getters
- `handled` flag, `resultContent`, `resultMessageId` fields

#### Removed from session-agent.ts
- `flushPendingChannelReply()` — entire method (~70 lines)
- `channelRouter.setResult()` call in finalize turn handler
- `channelRouter.markHandled()` call in `handleChannelReply()`
- Auto-reply flush in `complete` handler (`await this.flushPendingChannelReply()`)
- Auto-reply tracking log in `complete` handler
- `channelRouter.clear()` + `channelRouter.trackReply()` blocks in `handlePrompt()` and `sendNextQueuedPrompt()` (replaced by `setActiveChannel()` calls)
- Shimmer clearing code block (~13 lines) in `handleChannelReply()` — moves to Slack transport

Note: `parseSlackChannelId()` stays on session-agent.ts — it is still used by `sendChannelInteractivePrompts()` and `updateChannelInteractivePrompts()` (out of scope). ChannelRouter uses its own internal composite channelId parsing (extracted from `services/channel-reply.ts`).

#### Removed from session-agent.ts imports
- `sendChannelReply` import removed
- `channelRegistry` import stays — still used by interactive-prompt dispatch (out of scope)

### What Moves Into ChannelRouter

From `handleChannelReply()` in session-agent.ts:
- Transport resolution (`channelRegistry.getTransport`)
- Composite channelId parsing (Slack `channel:thread_ts` encoding)
- Outbound message building (markdown + file/image attachments)
- Persona resolution for Slack (via injected `resolvePersona` callback)
- Token resolution (via injected `resolveToken` callback)
- `transport.sendMessage()` call

### What Stays on session-agent.ts

- **Wiring:** Constructing ChannelRouter with deps, calling `setActiveChannel()` at prompt dispatch time
- **Runner communication:** Receiving `channel-reply` WebSocket message, calling `channelRouter.sendReply()`, forwarding result back via `runnerLink.send()`
- **Image message store write + broadcast:** After successful reply with image, writes system message to messageStore and broadcasts to web clients
  - `// TODO: Treat web UI as a channel so this goes through normal channel routing`
- **Follow-up SQLite writes:** `insertChannelFollowup()` at prompt dispatch, `resolveChannelFollowups()` triggered by `onReplySent` callback
- **Alarm-based follow-up reminders:** Reads pending followups from SQLite, injects system messages to nudge the agent
- **Credential imports:** `getSlackBotToken` and `getCredential` stay on session-agent.ts — used to implement the `resolveToken` callback passed to ChannelRouter. The callback branches on `channelType === 'slack'` internally.

### Slack Shimmer Clearing

Shimmer clearing moves into `SlackTransport.sendMessage()` — after a successful `chat.postMessage`, if the target has a `threadId`, it calls `this.setThreadStatus(target, '', ctx)`. Failure to clear shimmer is logged but does not fail the send.

This means any `sendMessage` to a threaded target clears shimmer. This is correct behavior: shimmer means "agent is working", and posting a reply means the agent has produced output. If the agent sends multiple replies in one cycle, shimmer clears after the first — acceptable since the user already sees a response. Other `sendMessage` callers (e.g., future interactive-prompt dispatch) would also clear shimmer, which is the right default.

### activeChannel Getter — Simplified

The current `activeChannel` getter checks `channelRouter.pendingSnapshot` then falls back to `promptQueue.getProcessingChannelContext()`. After the refactor:

- `channelRouter.activeChannel` is the primary source (set via `setActiveChannel()` or `recoverActiveChannel()`)
- The DO's `activeChannel` getter keeps the lazy fallback pattern: checks `channelRouter.activeChannel` first, then falls back to `promptQueue.getProcessingChannelContext()` and calls `channelRouter.recoverActiveChannel()` if found. This ensures correctness across all wake-up paths (alarm, WebSocket reconnect, HTTP fetch) without requiring eager recovery at a specific point in the wake-up sequence.

### Channel Delivery Stamping

The auto-reply path stamped assistant messages with channel metadata (`stampChannelDelivery`) so the web UI could show a "sent to Slack" badge. The explicit `handleChannelReply()` path does not do this stamping. With auto-reply removed, this stamping is intentionally dropped — it was only relevant for auto-replies where the agent didn't explicitly call `channel_reply`. When the agent explicitly replies, the web UI already shows the channel_reply tool call.

### Telegram and Other Channels

The Telegram transport uses the same `ChannelTransport.sendMessage()` contract. It does not use composite channelIds, shimmer, or persona resolution. The refactor is transparent to it — `ChannelRouter.sendReply()` resolves the transport generically and only applies Slack-specific behavior (persona) when `channelType === 'slack'`.

### Files Changed

| File | Change |
|------|--------|
| `packages/worker/src/durable-objects/channel-router.ts` | Rewrite: new ChannelRouter class with deps injection, sendReply, active channel tracking |
| `packages/worker/src/durable-objects/session-agent.ts` | Remove auto-reply code, slim down handleChannelReply to delegate to channelRouter.sendReply(), update activeChannel getter |
| `packages/plugin-slack/src/channels/transport.ts` | Add shimmer clear after successful sendMessage |
| `packages/plugin-slack/src/channels/transport.test.ts` | Update tests for shimmer-on-send behavior |
| `packages/worker/src/services/channel-reply.ts` | Delete |
| `packages/worker/src/durable-objects/channel-router.test.ts` | Rewrite for new ChannelRouter API |

### Acceptance Criteria

- [ ] Auto-reply path completely removed
- [ ] All channel routing logic consolidated in ChannelRouter
- [ ] ChannelRouter owns transport dispatch, token resolution, message building
- [ ] Explicit `channel_reply` tool continues to work for all channels (Slack, Telegram)
- [ ] No internal/orchestrator messages leak to Slack
- [ ] No double-posting of replies
- [ ] Slack shimmer cleared by transport, not by DO
- [ ] Follow-up reminders still function as a soft safety net
- [ ] ChannelRouter is unit-testable with injected deps
- [ ] TODO added for treating web UI as a channel
- [ ] Build passes
