# Messaging

> Defines how messages flow between external channels (Slack, Telegram, etc.) and session agents — including inbound reception, identity resolution, thread mapping, prompt dispatch, outbound delivery, interactive prompts, and channel binding.

## Scope

This spec covers:

- Channel transport abstraction and the SDK interface contract
- Inbound message flow: webhook reception → identity resolution → dispatch
- Outbound message flow: session agent → channel transport → external API
- Thread mapping: external threads ↔ orchestrator threads
- Channel bindings: how channels are associated with sessions
- Interactive prompt lifecycle: creation → delivery → callback → resolution → update
- Identity linking: mapping external platform users to internal users
- Per-channel specifics: Slack events, Telegram webhooks, group chat filtering
- Slash command handling

### Boundary Rules

- This spec does NOT cover session lifecycle, prompt queue modes, or sandbox management (see [sessions.md](sessions.md))
- This spec does NOT cover orchestrator identity, memory system, or child session spawning (see [orchestrator.md](orchestrator.md))
- This spec does NOT cover WebSocket/SSE transport for the web UI (see [real-time.md](real-time.md))
- This spec does NOT cover credential storage or OAuth flows (see [integrations.md](integrations.md))

## Data Model

### `channel_thread_mappings` table

Maps external channel threads to orchestrator thread UUIDs. One mapping per user per external thread.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | text PK | — | UUID |
| `sessionId` | text NOT NULL | — | Session that owns this mapping |
| `threadId` | text NOT NULL | — | FK to `session_threads.id` (orchestrator thread UUID) |
| `channelType` | text NOT NULL | — | `'slack'`, `'telegram'`, etc. |
| `channelId` | text NOT NULL | — | External channel identifier |
| `externalThreadId` | text NOT NULL | — | External thread identifier (Slack: `thread_ts`, Telegram: `chatId`) |
| `userId` | text NOT NULL | — | User who initiated this mapping |
| `lastSeenTs` | text | — | Cursor for incremental context fetching (Slack only) |

**Unique index:** `(channelType, channelId, externalThreadId, userId)` — enforces one mapping per user per external thread. Used for race-safe `INSERT OR IGNORE`.

### `channel_bindings` table

Associates a channel with a session so inbound messages route to the correct session agent.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | text PK | — | UUID |
| `sessionId` | text NOT NULL | — | Target session |
| `channelType` | text NOT NULL | — | `'slack'`, `'telegram'`, etc. |
| `channelId` | text NOT NULL | — | External channel identifier |
| `scopeKey` | text NOT NULL | — | `user:{userId}:{channelType}:{channelId}` |
| `userId` | text | — | User-level binding |
| `orgId` | text NOT NULL | — | Organization scope |
| `queueMode` | text NOT NULL | `'followup'` | `'followup'` / `'collect'` / `'steer'` |
| `collectDebounceMs` | integer | `3000` | Debounce for collect mode |
| `slackChannelId` | text | — | Slack-specific: raw channel ID |
| `slackThreadTs` | text | — | Slack-specific: thread timestamp |
| `githubRepoFullName` | text | — | GitHub-specific |
| `githubPrNumber` | integer | — | GitHub-specific |

**Unique index:** `(channelType, channelId)`.

**Scope key format:** `user:{userId}:{channelType}:{channelId}` — used for fast lookup in webhook handlers.

### `user_identity_links` table

Maps external platform user IDs to internal Valet user IDs.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | text PK | — | UUID |
| `userId` | text NOT NULL | — | Internal user ID |
| `provider` | text NOT NULL | — | `'slack'`, `'telegram'`, `'github'`, etc. |
| `externalId` | text NOT NULL | — | External user ID (Slack: `U...`, Telegram: numeric) |
| `externalName` | text | — | Display name |
| `teamId` | text | — | Workspace/org ID |

**Unique index:** `(provider, externalId)`.

### `user_telegram_config` table

Per-user Telegram bot configuration.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | text PK | — | UUID |
| `userId` | text NOT NULL UNIQUE | — | FK to users |
| `botUsername` | text NOT NULL | — | Bot's `@username` |
| `botInfo` | text | — | JSON: `{id, is_bot, first_name, username}` |
| `webhookActive` | boolean NOT NULL | `false` | Whether webhook is registered |
| `ownerTelegramUserId` | text | — | Telegram numeric user ID of the bot owner |
| `createdAt` / `updatedAt` | text | `datetime('now')` | ISO datetime |

### `action_invocations` table (interactive prompt reference)

Approval prompts create a record here with `status='pending'`. Used by callback handlers to resolve `promptId → sessionId`. Question prompts do NOT create records in this table.

See [sessions.md](sessions.md) for full schema. Relevant columns for messaging: `id` (= promptId), `sessionId`, `userId`, `status`.

### `interactive_prompts` table (DO-local SQLite)

Stored in the SessionAgent Durable Object's local SQLite, NOT in D1. Tracks prompt state and channel refs for update delivery.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID (same as `action_invocations.id` for approvals) |
| `type` | text NOT NULL | `'approval'` / `'question'` |
| `request_id` | text | Runner request ID to unblock on resolution |
| `title` | text NOT NULL | Prompt title |
| `body` | text | Prompt body |
| `actions` | JSON text | Array of `InteractiveAction` |
| `context` | JSON text | Type-specific context (includes `channelType`, `channelId` for origin) |
| `channel_refs` | JSON text | Array of `{channelType, ref: InteractivePromptRef}` for updates |
| `status` | text NOT NULL | `'pending'` / `'resolved'` / `'expired'` |
| `created_at` | integer | Unix epoch |
| `expires_at` | integer | Unix epoch (nullable) |

## SDK Interface Contract

All channel transports implement `ChannelTransport` from `@valet/sdk`:

```typescript
interface ChannelTransport {
  readonly channelType: string;

  // Required
  verifySignature(headers: Record<string, string>, body: string, secret: string): boolean;
  parseInbound(headers: Record<string, string>, body: string, routing: RoutingMetadata): Promise<InboundMessage | null>;
  scopeKeyParts(message: InboundMessage, userId: string): { channelType: string; channelId: string };
  formatMarkdown(markdown: string): string;
  sendMessage(target: ChannelTarget, message: OutboundMessage, ctx: ChannelContext): Promise<SendResult>;

  // Optional
  editMessage?(target: ChannelTarget, messageId: string, message: OutboundMessage, ctx: ChannelContext): Promise<SendResult>;
  deleteMessage?(target: ChannelTarget, messageId: string, ctx: ChannelContext): Promise<boolean>;
  sendTypingIndicator?(target: ChannelTarget, ctx: ChannelContext): Promise<void>;
  sendInteractivePrompt?(target: ChannelTarget, prompt: InteractivePrompt, ctx: ChannelContext): Promise<InteractivePromptRef | null>;
  updateInteractivePrompt?(target: ChannelTarget, ref: InteractivePromptRef, resolution: InteractiveResolution, ctx: ChannelContext): Promise<void>;
  registerWebhook?(webhookUrl: string, ctx: ChannelContext): Promise<boolean>;
  unregisterWebhook?(ctx: ChannelContext): Promise<boolean>;
}
```

### Key Types

```typescript
interface InboundMessage {
  channelType: string;
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  attachments: InboundAttachment[];
  command?: string;        // Slash command name (without /)
  commandArgs?: string;    // Text after the command
  messageId?: string;
  metadata?: Record<string, unknown>;
}

interface ChannelTarget {
  channelType: string;
  channelId: string;
  threadId?: string;       // Slack: thread_ts; Telegram: unused for outbound
}

interface ChannelContext {
  token: string;           // Bot/API token
  userId: string;          // Internal Valet user ID
}

interface InteractivePrompt {
  id: string;              // Prompt UUID (= invocation ID for approvals)
  sessionId: string;       // Session that created the prompt
  type: 'approval' | 'question' | (string & {});
  title: string;
  body?: string;
  actions: InteractiveAction[];
  expiresAt?: number;      // Epoch milliseconds
  context?: Record<string, unknown>;
}

interface InteractivePromptRef {
  messageId: string;       // Platform message ID for later updates
  channelId: string;       // Channel where prompt was sent
}
```

## Inbound Message Flow

### Universal Webhook Handler

**Endpoint:** `POST /channels/:channelType/webhook/:userId`

All non-Slack channels use this single endpoint. The flow:

1. **Transport lookup:** Get `ChannelTransport` from channel registry by `channelType`.
2. **Credential resolution:** Fetch user's credential for the channel type (bot token).
3. **Channel-specific config:** For Telegram, fetch `userTelegramConfig` (owner ID, bot info).
4. **Telegram pre-parse:** Parse raw body as JSON once. Handle `callback_query` before `parseInbound` (callback queries are structurally different from messages).
5. **Parse inbound:** Call `transport.parseInbound()` to extract `InboundMessage`.
6. **Owner verification (Telegram):** If `ownerTelegramUserId` is set, reject messages from non-owners.
7. **Group filtering (Telegram):** In group/supergroup chats, only process commands and `@bot` mentions. Mention detection uses Telegram entity offsets against the raw text (not the formatted `message.text` from `parseInbound`).
8. **Slash commands:** If `message.command` is set, delegate to `handleChannelCommand`.
9. **Binding lookup:** Build scope key, look up channel binding in D1.
10. **Thread resolution (Telegram):** Call `getOrCreateChannelThread` to map chat ID → orchestrator thread UUID.
11. **Dispatch to bound session:** If binding exists, send `POST http://do/prompt` to the bound session's DO. On failure, re-resolve thread against orchestrator session before falling through.
12. **Dispatch to orchestrator:** Call `dispatchOrchestratorPrompt` which saves the message to D1, ensures a channel binding exists, normalizes thread IDs, and sends to the orchestrator DO.

### Slack Events Handler

**Endpoint:** `POST /channels/slack/events`

Slack uses a dedicated handler because of its unique requirements (org-level bot token, signature verification, event envelope, retry handling).

1. **Retry handling:** Skip retries to prevent duplicate processing — except `http_timeout` retries, where the original request never reached our handler.
2. **Envelope parsing:** Parse JSON body. Handle `url_verification` challenge.
3. **Signature verification:** Look up org Slack install by `team_id`, decrypt signing secret, verify HMAC.
4. **Bot token resolution:** Decrypt org-level bot token from install record.
5. **User info + bot info:** Fetch Slack user profile and bot ID in parallel.
6. **Parse inbound:** Call `transport.parseInbound()` with sender name and mention map.
7. **Assistant thread events:** Handle `assistant_thread_started` (suggested prompts) and `assistant_thread_context_changed` (return early).
8. **Routing decision:** Route DMs and `app_mention` events. Ignore regular channel messages.
9. **Identity resolution:** Call `resolveUserByExternalId('slack', slackUserId)`. If unlinked, send account linking instructions and return.
10. **Binding lookup:** For DMs only, look up binding by scope key.
11. **Thread resolution:** Call `getOrCreateChannelThread` with retry logic (3 attempts, exponential backoff).
12. **Slash commands:** Delegate to `handleChannelCommand`.
13. **Thread context fetching:** Pull recent conversation history from Slack API. Prepend to message content as context (transient — not saved to D1).
14. **Dispatch:** Same two-tier dispatch as the universal handler (bound session → orchestrator fallthrough).

### Slack Interactive Handler

**Endpoint:** `POST /channels/slack/interactive`

Handles `block_actions` payloads from Slack button clicks.

1. **Parse:** Extract `payload` from form-encoded body.
2. **Signature verification:** Same as events handler.
3. **Button value parsing:** Extract `sessionId:promptId` from button value using `lastIndexOf(':')` (handles sessionIds with embedded colons like `orchestrator:userId:uuid`).
4. **Session resolution:** If sessionId encoded in value, use it directly. Otherwise, fall back to D1 `getInvocation` lookup.
5. **Authorization:** Verify Slack user maps to an internal user via identity link, and user owns the session.
6. **Resolution:** Fire-and-forget `POST /prompt-resolved` to session DO via `waitUntil`.

## Thread Mapping

### Purpose

External channels have their own threading models (Slack: `thread_ts`, Telegram: flat chats). The orchestrator needs a unified thread UUID to group related messages regardless of origin channel.

### `getOrCreateChannelThread` Algorithm

1. **Fast path:** Check for existing mapping. If found and session matches, return the thread ID (reactivate if archived).
2. **Stale mapping:** If existing mapping points to a different session (orchestrator was restarted), delete the old mapping.
3. **Optimistic create:** Generate a new UUID, create a `session_threads` row.
4. **Race-safe insert:** `INSERT OR IGNORE` the mapping. Unique index ensures only one writer wins per `(channelType, channelId, externalThreadId, userId)`.
5. **Read back winner:** SELECT the winning mapping.
6. **Cleanup:** If we lost the race, delete our orphaned `session_threads` row.
7. **Null guard:** If winner is null (rare: concurrent delete), return the optimistic thread ID.

### Thread Normalization in `dispatchOrchestratorPrompt`

When `threadId` is present, the dispatch function normalizes:
- `channelType` → `'thread'`
- `channelId` → `threadId` (the UUID)

This ensures D1 message storage uses a stable identifier that the web UI's WebSocket can subscribe to. Without normalization, the same thread's messages would be stored with the external `channelType` (e.g., `'telegram'`), which the web UI doesn't subscribe to.

### Per-Channel Thread Models

| Channel | External Thread ID | Notes |
|---------|-------------------|-------|
| Slack (threaded DM) | `thread_ts` | Each message starts a thread in Agents & AI Apps mode |
| Slack (unthreaded DM) | `channelId` | Legacy: entire DM channel = one thread |
| Slack (channel thread) | `thread_ts` | Standard Slack thread behavior |
| Telegram (DM) | `chatId` | Flat chat; entire conversation = one thread |
| Telegram (group) | `chatId` | Same: group chat ID = one thread |

## Outbound Message Flow

### Session Agent → Channel

When the session agent (DO) needs to send a message back to a channel:

1. **Trigger:** Runner sends `channel-reply` message to the DO.
2. **Transport lookup:** Get transport from channel registry.
3. **Token resolution:**
   - Slack: org-level bot token (single bot serves all users)
   - All others: per-user credential from `getCredential`
4. **Slack channel ID parsing:** Slack uses composite `channelId:threadTs` format. The DO parses this to extract `channelId` and `threadId` for the `ChannelTarget`.
5. **Message building:** Construct `OutboundMessage` with markdown and optional image attachment.
6. **Send:** Call `transport.sendMessage(target, outbound, ctx)`.
7. **Post-send:** Clear Slack shimmer status, mark auto-reply handled, resolve followup reminders.

### Interactive Prompt Delivery

When the DO creates an interactive prompt (approval or question):

1. **Collect targets** from multiple sources (deduplicated):
   - Prompt's origin channel (from `context.channelType`/`context.channelId`)
   - User-level channel bindings (`listUserChannelBindings`)
   - Session-scoped bindings (`getSessionChannelBindings`)
   - Currently active channel
2. **Per-target send:** For each target with `sendInteractivePrompt` capability:
   - Resolve token
   - Call `transport.sendInteractivePrompt(target, prompt, ctx)`
   - Collect `InteractivePromptRef` results
3. **Store refs:** Save channel refs as JSON in the DO's `interactive_prompts` table for later updates.

### Interactive Prompt Resolution

When a prompt is resolved (button click, text reply, expiry):

1. **Callback arrives** at the interactive handler (Slack or Telegram webhook).
2. **Session resolution:**
   - Slack: sessionId encoded in button value, or D1 `getInvocation` fallback
   - Telegram: D1 `getInvocation` for approvals, `getOrchestratorSession` for questions
3. **DO notification:** `POST /prompt-resolved` with `{promptId, actionId, resolvedBy}`.
4. **DO processes:** Updates prompt status, unblocks runner, sends `updateInteractivePrompt` to all channels.
5. **Channel update:** For each stored channel ref, call `transport.updateInteractivePrompt(target, ref, resolution, ctx)`.

## Channel Bindings

### Purpose

Bindings route inbound messages from a channel to a specific session. Without a binding, messages fall through to the orchestrator.

### Binding Lifecycle

1. **Auto-creation:** `dispatchOrchestratorPrompt` calls `ensureChannelBinding` for every non-web channel message. This creates a D1 record via `ON CONFLICT DO NOTHING` so interactive prompts can discover which channels to send to.
2. **Explicit creation:** The orchestrator can create bindings to route a specific channel to a child session.
3. **Lookup:** Webhook handlers call `getChannelBindingByScopeKey(db, scopeKey)` to check if a channel is bound.
4. **Scope key format:** `user:{userId}:{channelType}:{channelId}`.

### Routing Priority

1. If binding exists → route to bound session
2. If bound session fails → fall through to orchestrator (re-resolve thread if needed)
3. If no binding → route to orchestrator directly

## Per-Channel Specifics

### Slack

**Authentication model:** Org-level bot install. Single bot token serves all users in a workspace. Identity linking maps Slack user → Valet user via verification code flow.

**Scope key format:** `user:{userId}:slack:{teamId}:{channelId}` or `user:{userId}:slack:{teamId}:{channelId}:{threadTs}`.

**Composite channel IDs:** The DO stores Slack channels as `channelId:threadTs` so outbound replies thread correctly. The transport's `scopeKeyParts` method constructs these composites.

**Supported inbound types:** Text, files (via `files` array in event), slash commands, `app_mention` events, assistant thread events.

**Interactive prompts:** Button values encode `sessionId:promptId`. Slack has no size limit on button values, so full session IDs are included.

**Thread context:** On each inbound message, recent conversation history is fetched from the Slack API and prepended to the message. A cursor (`lastSeenTs`) prevents re-fetching previously seen messages.

### Telegram

**Authentication model:** Per-user bot token. Each user creates their own bot via BotFather and provides the token. Owner identity is captured on `/start` and verified on every message.

**Scope key format:** `user:{userId}:telegram:{chatId}`.

**Webhook URL:** `POST /channels/telegram/webhook/:userId`.

**Owner verification:** `ownerTelegramUserId` (stored in `user_telegram_config`) is checked against `message.from.id`. Non-owner messages are silently dropped.

**Group chat support:** In group/supergroup chats:
- Commands are always processed (Telegram delivers them regardless of privacy mode)
- Non-command messages require an `@bot` mention (detected via Telegram `entities` array, NOT string matching)
- Privacy mode ON (default): bot only receives commands and replies to its messages
- Privacy mode OFF (bot is admin): bot receives all messages; mention filtering applies

**Supported inbound types:** Text, photos, voice notes, audio, documents (PDFs, ZIPs, etc.), slash commands. Forwarded messages include attribution formatting.

**Interactive prompts:** Uses Telegram inline keyboards. Button `callback_data` uses `actionId|promptId` format (no sessionId) to stay within Telegram's 64-byte limit. Session resolution falls back to D1 `getInvocation` for approvals, then `getOrchestratorSession` for questions.

**Callback query handling:** Intercepted before `parseInbound` because callback queries are structurally different from messages. The handler: answers the query (dismisses loading spinner), verifies owner, parses `callback_data`, and fires `prompt-resolved` to the session DO.

## Slash Commands

The `handleChannelCommand` function processes commands from any channel. Available commands are defined in `SLASH_COMMANDS` (shared package) and filtered by channel type.

**Session resolution:** Commands target the orchestrator session via `getOrchestratorSession(env.DB, userId)`. Falls back to `orchestrator:{userId}` if no session record exists.

| Command | Description |
|---------|------------|
| `/start` | Telegram only: captures owner's user ID, sends welcome message |
| `/help` | Lists available commands for the channel |
| `/status` | Shows orchestrator status (running, runner connected, queue depth) |
| `/stop` | Interrupts current work and clears the prompt queue |
| `/clear` | Clears the prompt queue without interrupting |
| `/refresh` | Stops and restarts the orchestrator session |
| `/sessions` | Lists child sessions with status |

## Edge Cases & Failure Modes

### Thread Resolution Failures

- **Race condition:** Concurrent webhook calls for the same thread. Handled by `INSERT OR IGNORE` + winner read-back. Losers' orphaned threads are cleaned up.
- **Stale mapping:** Orchestrator session rotated. Old mapping is deleted and a new one is created for the current session.
- **All retries fail:** Thread resolution is retried 3 times with exponential backoff. If all fail, dispatch proceeds without a thread ID (messages won't appear in web UI thread view).

### Bound Session Dispatch Failures

When a bound session's DO is unreachable or returns non-200, the handler falls through to the orchestrator. For Telegram, the thread mapping is re-resolved against the orchestrator session to prevent cross-session thread confusion.

### Interactive Prompt Callback Failures

- **Telegram question prompts:** No D1 `action_invocations` record exists. The callback handler falls back to `getOrchestratorSession` to find the session. If the prompt was from a child session (not the orchestrator), this fallback may route to the wrong session.
- **Expired prompts:** The DO rejects resolution with a non-200 response. The button click is silently dropped.
- **Duplicate clicks:** The DO validates prompt status; re-resolution of an already-resolved prompt is a no-op.

### Identity Resolution Failures

- **Slack unlinked user:** If `resolveUserByExternalId` returns null, the handler sends a "link your account" message and returns without processing the message.
- **Telegram unverified owner:** Messages from non-owners are silently dropped (200 OK, no response).

## Implementation Status

### Fully Implemented

- Universal webhook handler with all dispatch paths
- Slack events handler with thread context, assistant threads, identity linking
- Telegram transport: text, photos, voice, audio, documents, commands, groups
- Interactive prompts: Slack (Block Kit buttons), Telegram (inline keyboards)
- Thread mapping with race-safe creation and stale mapping cleanup
- Channel binding auto-creation and lookup
- Slash command handling for both channels
- Owner verification and group chat filtering for Telegram

### Known Gaps

- **Telegram question prompt callbacks:** Fall back to orchestrator session, which may miss prompts from child sessions. A more robust solution would encode sessionId in a D1 lookup table.
- **Slack scope key inconsistency:** `scopeKeyParts` produces different keys for threaded vs. unthreaded messages in the same DM channel, potentially orphaning bindings when DMs transition to threaded mode.
- **No Telegram document size limit check:** Telegram's `getFile` API only works for files up to 20MB. Larger files will silently fail to download.
- **No web UI notification for rerouted messages:** When a bound session dispatch fails and falls through to the orchestrator, the user receives no indication of the reroute.
