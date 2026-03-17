# Slack Private Channel Authorization

**Date:** 2026-03-16
**Status:** Approved

## Problem

When the Slack bot is added to a private channel, all Valet users with linked Slack identities can use agent actions (`slack.post_message`, `slack.read_history`, `slack.read_thread`, `slack.list_channels`, `slack.add_reaction`) against that channel — regardless of whether they're actually a member. This breaks the privacy boundary of private channels: the bot's access is not the same as the user's access.

On the inbound side, if an `app_mention` event arrives from a private channel, Valet routes it to the mentioning user's orchestrator without verifying channel membership. While Slack itself prevents non-members from posting, an explicit check provides defense in depth.

## Design

### Approach: Action-handler-level checks

A `checkPrivateChannelAccess()` helper in the Slack plugin. Each channel-targeting action and the inbound webhook handler call it before proceeding.

### The membership check helper

New function in `packages/plugin-slack/src/actions/`:

```typescript
async function checkPrivateChannelAccess(
  token: string,
  channelId: string,
  ownerSlackUserId: string | undefined,
): Promise<{ allowed: boolean; isPrivate: boolean; error?: string }>
```

Logic:
1. Call `conversations.info` to get channel metadata
2. If `is_im` or `is_mpim` (DMs/group DMs) → always allowed, not subject to this check
3. If `is_private === false` → allowed (public channels always pass)
4. If private and no `ownerSlackUserId` → denied ("Owner has not linked their Slack identity")
5. If private, paginate `conversations.members` to check if `ownerSlackUserId` is in the list
6. Found → allowed. Not found → denied ("You don't have access to this private channel")

### Action-level enforcement

Each channel-targeting action calls the helper before proceeding:

| Action | Behavior |
|--------|----------|
| `slack.post_message` | Check resolved channel ID. Deny → error. |
| `slack.read_history` | Check before fetching. Deny → error. |
| `slack.read_thread` | Check before fetching. Deny → error. |
| `slack.add_reaction` | Check before reacting. Deny → error. |
| `slack.list_channels` | After fetching, filter out private channels where the owner isn't a member. Parallelize checks with `Promise.all`. |
| `slack.dm_owner` | No check (DM conversation). |
| `slack.dm_user` | No check (DM conversation). |
| `slack.list_users` | No check (workspace-level). |

Error message for denied actions: `"Access denied: you are not a member of this private channel"`

### Inbound webhook enforcement

In `slack-events.ts`, after identity resolution and before routing, for `app_mention` events from non-DM channels:

1. Call `checkPrivateChannelAccess` with `botToken`, `message.channelId`, and the resolved user's `slackUserId`
2. If denied → silently ignore (200 OK), log the denial
3. No error message back to Slack (this situation shouldn't happen organically — defense in depth only)

The user's Slack ID is already available at this point (`slackUserId` from the event payload).

### Performance

- One `conversations.info` call per action targeting a channel (to determine if private)
- One `conversations.members` call if the channel is private (paginated for large channels)
- For `list_channels`, parallel membership checks for private channels in results
- No caching for now — API calls are cheap and correctness matters more than latency
- Inbound webhook path already makes multiple Slack API calls; one more is negligible

### Future: org orchestrators

Org orchestrators (not yet implemented) will need an exemption from this check since they act as shared automation agents not tied to a single user. Leave a code comment noting this.

## Scope

### In scope
- Slack plugin action handler (`packages/plugin-slack/src/actions/actions.ts`)
- Slack inbound webhook handler (`packages/worker/src/routes/slack-events.ts`)

### Out of scope
- Caching (deferred — can add DO-level cache later if API volume becomes a concern)
- Org orchestrator exemption (not yet implemented)
- Channel transport layer (`packages/plugin-slack/src/channels/transport.ts`) — outbound messages from the transport are system-level (bot replies), not user-initiated actions
