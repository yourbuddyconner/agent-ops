# Slack Reaction-Based Message Deletion

**Date:** 2026-03-23
**Status:** Draft

## Problem

When a user's orchestrator (or any session they own) posts something undesirable in a public Slack channel, the user cannot delete it — only Slack workspace admins and the bot itself can delete bot messages. Users need a lightweight way to remove their own bot messages without admin intervention.

## Design

### Approach: Reaction-triggered deletion with metadata-based ownership

When a user reacts with ❌ (`:x:`) on a message posted by the Valet bot, the system verifies the reacting user owns the session that sent it, deletes the Slack message, and posts an ephemeral confirmation.

### Ownership tracking via Slack message metadata

Slack's `chat.postMessage` supports a `metadata` field — structured JSON attached to the message and retrievable via `conversations.history`. We attach ownership info at send time and read it back on reaction.

**On send** (`SlackTransport.sendMessage`):

Add to the `chat.postMessage` body:

```typescript
metadata: {
  event_type: "valet_bot_message",
  event_payload: {
    userId: ctx.userId,   // Valet user ID of the session owner
  },
}
```

The `userId` is already available on `ChannelContext.userId`. No new data plumbing needed.

**On reaction** (new handler in `slack-events.ts`):

1. Check `event.reaction === "x"` and `event.type === "reaction_added"`
2. Resolve reacting Slack user → Valet user via `resolveUserByExternalId`
3. Fetch the reacted-to message: `conversations.history` with `latest=event.item.ts`, `limit=1`, `inclusive=true`
4. Read `message.metadata.event_payload.userId`
5. If metadata is missing or `userId` doesn't match the reacting user → no-op
6. Call `chat.delete` with bot token + `event.item.ts`
7. Post ephemeral confirmation to the reacting user via `chat.postEphemeral`

### Event flow

```
User reacts ❌ on bot message
        │
        ▼
Slack sends reaction_added event
        │
        ▼
slack-events.ts handler
        │
        ├─ reaction !== "x" → ignore
        │
        ├─ Resolve Slack user → Valet user
        │  └─ Not a Valet user → ignore
        │
        ├─ Fetch message via conversations.history
        │  └─ No valet_bot_message metadata → ignore
        │
        ├─ metadata.userId !== reacting user → ignore
        │
        ├─ chat.delete(channel, ts)
        │
        └─ chat.postEphemeral("Message deleted")
```

### Changes required

| File | Change |
|------|--------|
| `packages/plugin-slack/src/channels/transport.ts` | `sendMessage()`: attach `metadata` with `event_type: "valet_bot_message"` and `event_payload: { userId }` to the `chat.postMessage` body |
| `packages/worker/src/routes/slack-events.ts` | Add early handler for `reaction_added` events before the existing `parseInbound` flow. Extract `event.reaction`, `event.item.channel`, `event.item.ts`, `event.user`. Handler runs after install resolution (line 68) and reuses the already-decrypted `botToken` from `install.botToken` |
| `packages/worker/src/services/slack.ts` | New `handleReactionDeletion(botToken, channel, ts, slackUserId, env)` function: fetch message, check metadata, delete, send ephemeral. Receives `botToken` from the caller in `slack-events.ts` — does not independently resolve tokens |
| Slack App dashboard | Add `reaction_added` to bot event subscriptions under **Event Subscriptions → Subscribe to bot events**. This is a one-time manual step in the Slack API dashboard. |

### Scoping notes

- `ChannelContext.userId` is already populated by both send paths (`handleChannelReply` and `flushPendingChannelReply` via `sendChannelReply`)
- `conversations.history` with `inclusive=true` and `latest=ts` fetches a single message — minimal API cost
- `chat.postEphemeral` is visible only to the reacting user
- `chat:write` scope (already granted) covers `chat.delete` for the bot's own messages

### Edge cases

| Scenario | Behavior |
|----------|----------|
| Reaction on a non-Valet message | No metadata → no-op |
| Reaction on someone else's bot message | `userId` mismatch → no-op |
| Reacting user is not a Valet user | Identity resolution fails → no-op |
| Message already deleted | `chat.delete` returns error → ignore gracefully |
| Reaction with wrong emoji | Filtered out at first check → no-op |
| Old messages sent before metadata was added | No metadata → no-op (graceful degradation) |

### What this does NOT cover

- Deleting messages from the Valet web UI or message store
- Editing messages via reaction
- Any other reaction-triggered behaviors
- Deletion of messages in channels where the bot has been removed
- Interactive prompt messages (`sendInteractivePrompt` — approval buttons, questions) — these use a separate send path and will not receive metadata. Users cannot ❌-delete these.
