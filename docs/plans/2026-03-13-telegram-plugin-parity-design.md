# Telegram Plugin Parity Design

**Date:** 2026-03-13
**Goal:** Bring the Telegram channel plugin to feature parity with Slack: thread mapping (fixes web UI visibility), owner identity, group chat support, and interactive prompts.

---

## 1. Owner Identity

**Problem:** Telegram has no identity linking system. In group chats, the bot must only respond to its owner.

**Solution:**
- Add `ownerTelegramUserId TEXT` column to `userTelegramConfig` table (new D1 migration).
- Auto-capture `from.id` when the owner sends `/start` in a DM. Store on the config row.
- Editable in the web UI Telegram integration card (pre-populated from auto-capture).
- All message processing (DMs, groups, callback queries) verifies `from.id` matches the stored `ownerTelegramUserId`. Non-owner messages are silently ignored.

---

## 2. Thread Mapping (Fixes Web UI Visibility)

**Problem:** Messages from Telegram DMs don't appear in the web UI. The Telegram webhook handler dispatches to the orchestrator without a `threadId`. Without a `threadId`, `dispatchOrchestratorPrompt` saves messages with `channelType: 'telegram'` instead of `channelType: 'thread'`, and the web UI's WebSocket subscription never picks them up.

**Solution:**
- In `channel-webhooks.ts`, after parsing the inbound message, resolve the orchestrator session (from binding or `getOrchestratorSession`).
- Call `getOrCreateChannelThread` with:
  - `channelType: 'telegram'`
  - `channelId: chatId`
  - `externalThreadId: chatId` (each Telegram chat = one orchestrator thread; no sub-threading)
  - `sessionId`, `userId`
- Pass the returned `orchestratorThreadId` to `dispatchOrchestratorPrompt` as `threadId`.
- With `threadId` present, `dispatchOrchestratorPrompt` normalizes to `channelType: 'thread'` and `channelId: <uuid>`, which the web UI subscribes to.

**Thread-per-chat model:** Each Telegram chat (DM or group) maps to exactly one orchestrator thread. If the owner talks to the bot in 3 groups + 1 DM, they get 4 orchestrator threads.

---

## 3. Group Chat Support

**Problem:** The Telegram plugin only handles DMs. The bot can be added to group chats but has no filtering or routing logic for them.

**Solution:**
- Determine chat type from `chat.type` (`private` vs `group`/`supergroup`).
- For all messages (DM and group): verify `from.id` matches `ownerTelegramUserId`. Ignore non-owner messages.
- The bot receives messages based on Telegram's privacy mode:
  - **Privacy mode ON (default):** Bot receives `/commands` directed at it and replies to the bot's own messages. This is the primary interaction model.
  - **Privacy mode OFF (bot is group admin):** Bot receives all messages. We additionally check for `@botname` in the message `entities` array (entity type `mention`). Process mentions, commands, and replies to bot.
- No configuration toggle needed — we handle whatever Telegram sends. If the user makes the bot admin, the mention path activates automatically.
- Telegram Topics (forum-style supergroups) are ignored. All messages in a group map to one thread regardless of topic.
- Same command set registered for DMs and groups (owner-only enforcement makes a separate set unnecessary).

---

## 4. Interactive Prompts

**Problem:** The Telegram transport doesn't implement `sendInteractivePrompt` or `updateInteractivePrompt`. The orchestrator's approval/question prompts can't reach the user via Telegram.

### sendInteractivePrompt

- **No actions (text question):** Send a plain text message with title + body + "Reply with your answer." Same pattern as Slack's text-only prompt.
- **With actions (buttons):** Send a message with `reply_markup: { inline_keyboard: [[...buttons]] }`. Each button uses:
  - `text`: emoji-prefixed label (e.g., "✅ Approve", "❌ Deny") since Telegram has no button styling/colors.
  - `callback_data`: encoded as `sessionId:promptId` (same encoding as Slack).
- Expiry line appended to message text if `expiresAt` is set.
- Returns `{ messageId, channelId }` as `InteractivePromptRef`.

### updateInteractivePrompt

- Uses `editMessageText` to replace the original message with resolution status text:
  - "✅ Approved by X"
  - "❌ Denied by X: reason"
  - "⏰ Expired"
- Removes inline keyboard by passing `reply_markup: { inline_keyboard: [] }`.

### callback_query Handling

Handled in `channel-webhooks.ts`, before `parseInbound` (since `callback_query` is structurally different from a regular message):

1. Detect `update.callback_query`.
2. Verify `from.id` matches `ownerTelegramUserId`.
3. Call `answerCallbackQuery` to dismiss the loading spinner in Telegram.
4. Parse `sessionId:promptId` from `callback_data` (using `lastIndexOf(':')` since sessionId may contain colons).
5. Fire-and-forget: POST `prompt-resolved` to the session DO with `{ promptId, actionId, resolvedBy: userId }`.
6. Return 200.

---

## 5. Files to Modify

| File | Change |
|------|--------|
| New migration | Add `ownerTelegramUserId` column to `userTelegramConfig` |
| `plugin-telegram/src/channels/transport.ts` | Add `sendInteractivePrompt`, `updateInteractivePrompt` |
| `worker/src/routes/channel-webhooks.ts` | Owner verification, group chat filtering, thread resolution, `callback_query` handling |
| `worker/src/services/telegram.ts` | Capture owner `from.id` on `/start` |
| `client/src/components/integrations/integration-list.tsx` | Editable owner field on Telegram card |

---

## 6. Not In Scope

- Telegram Topics support (forum-style supergroups)
- Identity linking (Slack-style verification code flow)
- Thread context pulling (conversation history injection)
- Different command sets for DMs vs groups
- Telegram Web Apps
