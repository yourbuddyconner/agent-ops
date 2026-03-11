# Multi-Orchestrator Slack Thread Routing

## Problem

When multiple Valet users communicate in the same public Slack thread, each user's messages are routed to their own orchestrator in isolation. Neither agent sees the full thread — creating fragmented, one-sided conversations where agents are unaware of each other and of other participants. Additionally, orchestrators auto-respond to every message in a tracked thread, even when the user didn't explicitly invoke them.

## Design Summary

Switch public channel Slack threads from single-owner auto-routing to multi-orchestrator shared context with explicit invocation. Each user's orchestrator participates independently in the thread with its own persona identity (name, avatar). Agents only respond when explicitly @mentioned. Thread context is pulled from Slack on each invocation so every agent sees the full conversation — including other agents' responses and other users' messages.

## Routing Rules

### Public Channels (All Thread Contexts)

- Agent only responds to `app_mention` events — no auto-routing on subsequent messages
- Any user can @Valet at any point in any public thread, even threads where Valet hasn't participated before
- The mentioning user's orchestrator handles the message and responds as its persona
- Channel bindings do not apply in public channels; multi-orchestrator rules always govern
- The Valet bot must be a member of the channel to receive events and respond (standard Slack constraint)

**Future (push model):** The message handler should be structured so that it's straightforward to add a push-based path later, where all messages in tracked threads are broadcast to subscribed orchestrators for ambient awareness. Leave comments at the routing decision points indicating where push-based dispatch would hook in.

### DMs

No change. All messages route to the user's orchestrator. No mention needed. DM channel bindings continue to work as-is.

### Identity Resolution

Unchanged. Unlinked Slack users receive the account linking prompt in-thread before any routing occurs.

## Thread Context (Pull Model)

When an orchestrator is invoked in a public thread:

1. **Fetch thread history** — Call Slack `conversations.replies(channel, thread_ts)` to get the thread. Cap at the most recent 200 messages to avoid exceeding model context windows. Paginate via Slack's `cursor` parameter if needed.
2. **Resolve Slack display names** — For every message, resolve the Slack user ID to the user's Slack display name (via `users.info` or cached lookup). Use Slack display names universally — both linked and unlinked users — so the agent builds consistent memories about participants. For bot/agent messages, use the `username` field from the message payload (the persona name set via `chat.postMessage`). Cache resolved names in an in-memory Map scoped to the request to avoid redundant API calls.
3. **Compute delta from cursor** — Look up the orchestrator's `lastSeenTs` in `channel_thread_mappings` for this user + thread. Filter to only messages newer than the cursor. Include the orchestrator's own prior messages in the delta for continuity (the agent needs to see what it previously said).
4. **Inject as context** — Prepend the new messages as a formatted block in the `content` field passed to `dispatchOrchestratorPrompt`. The block is separated from the user's new message by a delimiter (see Context Message Format below).
5. **Advance cursor** — Update `lastSeenTs` to the current message's timestamp.

**First invocation in a thread:** If no `channel_thread_mappings` row exists for this user + thread, create one. The full thread history (up to the 200-message cap) is provided as context. This handles the "invoke Valet deep into an existing thread" case.

### Context Message Format

Context is prepended to the user's message in the `content` field of `dispatchOrchestratorPrompt`:

```
--- Thread context (messages you haven't seen) ---
[2026-03-11 14:32] Sarah Chen: the deploy failed on staging
[2026-03-11 14:33] Friday: I checked the logs and found a timeout in the health check. The pod was OOMKilled.
[2026-03-11 14:35] Alex Kim: [file: error-screenshot.png]
--- End thread context ---

@Valet check if my service is affected too
```

- Timestamps in human-readable format, converted from Slack's epoch-based `ts` field
- Bot/agent messages attributed by their persona name
- File attachments noted as `[file: filename.ext]` for now (see File Handling below)

### File Handling

For this iteration, files and images are noted in context as `[file: filename.ext]` without downloading or attaching the actual content. Code comments should mark where image download (via `url_private` with bot token) and multipart attachment handling would be added later.

## Schema Changes

### `channel_thread_mappings` Table

The `userId` column already exists on this table. Changes needed:

- **Widen unique index** from `(channelType, channelId, externalThreadId)` to `(channelType, channelId, externalThreadId, userId)`. This allows multiple users to each have their own mapping row for the same external Slack thread.
- **Add `lastSeenTs` column** (TEXT, nullable) — Slack message timestamp of the last message this orchestrator has seen in this thread.

**Threading model:** Each user gets their own `session_thread` (internal thread) for the same external Slack thread. Jarvis and Friday have separate orchestrator sessions with separate internal threads, but both map to the same external `thread_ts`. Outbound messages from different orchestrators all land in the same Slack thread because they share the same `externalThreadId` / `thread_ts`.

### DB Function Changes (`channel-threads.ts`)

- **`getChannelThreadMapping()`** — Add `userId` parameter. Query becomes `WHERE channel_type = ? AND channel_id = ? AND external_thread_id = ? AND user_id = ?`.
- **`getOrCreateChannelThread()`** — Update the `INSERT OR IGNORE` to work with the widened unique index (which now includes `userId`). The race-safety guarantee is preserved: two concurrent calls for the same user + thread still deduplicate correctly. Two different users creating mappings for the same thread each get their own row (intended behavior).
- **Add `updateThreadCursor()`** — New function to update `lastSeenTs` on a mapping row.
- **Cursor reading** — Done via `getChannelThreadMapping()` which now returns `lastSeenTs` in its result. No separate `getThreadCursor()` function needed.

### `slack_bot_threads` Table

Drop table entirely and remove all references:
- `trackSlackBotThread()` function
- `isSlackBotThread()` function
- Schema definition in `packages/worker/src/lib/schema/slack.ts`
- DB helper functions in `packages/worker/src/lib/db/slack.ts`

### `channel_bindings` Table

No changes to the table itself. Public channel thread lookups skip binding resolution. DM bindings continue to work as-is.

## Message Handler Changes (`slack-events.ts`)

Simplified routing logic:

```
app_mention event (any channel)
├─ Resolve Slack user → Valet user (or send linking prompt)
├─ Pull thread context (conversations.replies + cursor delta)
├─ Dispatch to user's orchestrator with context
└─ // FUTURE: push-model hook — broadcast to subscribed orchestrators

message event (DM / channel_type === 'im')
├─ Route to user's orchestrator (unchanged, including channel binding lookup)

message event (public channel, not app_mention)
├─ 200 OK, no processing
└─ // FUTURE: push-model hook — broadcast to subscribed orchestrators
```

Key changes:
- Remove `isSlackBotThread()` check from routing decisions
- Remove `trackSlackBotThread()` call from mention handling
- Skip `channel_bindings` lookup for public channel contexts
- Add thread context pull before orchestrator dispatch

## Slack API Integration

### Thread History Fetching

- Implement as a new function `fetchThreadContext()` in `packages/worker/src/services/slack-threads.ts` (new file)
- Use `conversations.replies` with `channel` and `ts` (thread root) to get the thread
- Cap at 200 most recent messages to stay within model context limits
- Paginate via Slack's `cursor` parameter if thread exceeds page size
- Reuse existing 429 retry-with-backoff logic from the Slack transport

### Display Name Resolution

- Use `users.info` to resolve Slack user IDs to display names
- Cache resolved names in an in-memory `Map<string, string>` scoped to the request handler (a single thread pull may reference the same user multiple times)
- For bot messages (other agents' responses), use the `username` field from the message payload

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Multi-orchestrator over single-owner | Each agent has distinct identity (name, avatar, persona) making multi-agent threads legible. Each operates with its own user's credentials. |
| Explicit invocation in public channels | Prevents noise. Agents only speak when asked. Natural Slack @mention pattern. |
| Pull model over push | Simpler to implement. Push is the future goal for ambient awareness but adds complexity. Handler structured for easy push addition later. |
| Slack display names for all users | Agents build memories keyed on display names. Slack is the communication layer, so Slack names are the stable identifier. |
| Per-user internal threads | Each orchestrator gets its own `session_thread` for the same external Slack thread. This preserves the 1:1 relationship between orchestrator sessions and their internal threads while allowing shared external context. |
| Drop `slack_bot_threads` | Only purpose was auto-routing in tracked threads, which is removed by the explicit invocation requirement. |
| Skip channel bindings for public threads | Public threads are inherently multi-stakeholder. No single session should own a public thread. |
| 200-message context cap | Balances completeness against model context window limits and API latency. Most active threads won't hit this. |
| Thread context in `content` field | The `content` string in `dispatchOrchestratorPrompt` is the simplest injection point. No new fields or protocol changes needed. |
