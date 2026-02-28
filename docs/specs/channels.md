Channel System & Chat Integrations
=================================

Purpose
-------
This spec describes Agent‑Ops' channel system and how external chat integrations (Slack in particular) should work. It covers the conceptual model, data schema, API routes, inbound and outbound semantics, security, reliability and operational considerations. It is intended to be authoritative documentation living in-repo.

Status
------
- Telegram: implemented (routes + service) — see `/packages/worker/src/routes/telegram.ts` and `/packages/worker/src/services/telegram.ts`.
- GitHub webhooks + API proxy: implemented.
- Slack: schema + env placeholders exist, but the Slack-specific service/routes are NOT implemented. This spec defines the intended implementation and required artifacts.

Key files (current state)
-------------------------
- `packages/worker/src/routes/channels.ts` — `POST /api/prompt`: channel-agnostic prompt entrypoint.
- `packages/worker/src/lib/schema/channels.ts` — D1 tables: `channel_bindings`, `user_identity_links`.
- `packages/worker/src/lib/db/channels.ts` — DB helpers for channel_bindings and identity links.
- `packages/worker/src/durable-objects/session-agent.ts` — SessionAgent DO: prompt queue, pending channel reply, followup reminders, `handleChannelReply` (Telegram implemented), `flushPendingChannelReply`.
- `packages/worker/src/routes/telegram.ts` and `packages/worker/src/services/telegram.ts` — Telegram full flow (setup, webhook, media handling, routing to DO/orchestrator).
- `packages/runner/src/prompt.ts` — per-channel OpenCode session management (ChannelSession).
- `packages/runner/src/gateway.ts` and `docker/opencode/tools/*.ts` — Runner gateway endpoints and OpenCode tools for `list_channels` and `channel_reply`.
- `docs/specs/integrations.md`, `V2.md` — design notes and planned Slack flows.

Concepts & Terminology
----------------------
- ChannelType: transport family (web, telegram, slack, github, api). See `packages/shared/src/types`.
- ChannelId: transport-specific destination identifier (e.g. Telegram chatId, Slack team:channel:thread key).
- ScopeKey: deterministic routing key used to map inbound messages to an existing or new session. Helpers in `packages/shared/src/scope-key.ts` (e.g. `slackScopeKey`, `telegramScopeKey`).
- ChannelBinding: `channel_bindings` D1 row that maps a scopeKey/destination to a SessionAgent sessionId. Used to route follow-ups directly to an active session (bypass orchestrator).
- QueueMode: per-binding behavior for message queuing when the session is busy. Valid values: `followup`, `collect`, `steer`.

Data model (D1) — existing
-------------------------
`channel_bindings` (existing)
- id: text PK
- sessionId: text (FK to sessions)
- channelType: text
- channelId: text
- scopeKey: text
- userId: text (optional)
- orgId: text
- queueMode: text (default 'followup')
- collectDebounceMs: integer (default 3000)
- slackChannelId, slackThreadTs, slackInitialMessageTs: text (Slack-specific; present but not yet used end-to-end)
- githubRepoFullName, githubPrNumber, githubCommentId: optional github metadata
- createdAt: text

Indexes:
- unique(channelType, channelId)
- index(scopeKey)
- index(sessionId)

`user_identity_links` (existing)
- id, userId, provider, externalId, externalName, teamId, createdAt
- maps external identity (provider + externalId) to internal userId

Proposed additions (D1)
-----------------------
- `slack_installations` — store per-org Slack install info (teamId, encrypted bot token, appId, installedBy, status, createdAt).
- `webhook_inbox` — durable webhook ingestion: raw_headers, raw_body, provider, event_type, routing_metadata, status, attempts, last_error, claimed_at, created_at. Enables fast-ack + async processing and DLQ.
- `channel_deliveries` — track outbound attempts, platformMessageId, delivery status, attempts for safe retries and idempotency.

Routing & behavior (current)
----------------------------
- Inbound flows: transports normalize incoming payloads into a ChannelMessage and either route directly to a bound session DO (via `POST http://do/prompt`) or fallback to the user's orchestrator (via `dispatchOrchestratorPrompt`). Example: Telegram webhook checks `telegramScopeKey(userId, chatId)` and routes accordingly (see `routes/telegram.ts`).
- `POST /api/prompt` implements this logic for arbitrary authenticated prompts; it accepts `channelType`, `channelId`, optional `scopeKey`, `attachments` and routes to binding or orchestrator (see `routes/channels.ts`).
- The SessionAgent DO maintains a `pendingChannelReply` per-dispatched prompt. If the agent does not send an explicit channel_reply during generation, the DO may auto-send the assistant's final text to that channel (auto-flush). Currently this auto-send and explicit channel_reply only implement Telegram.

Queue modes (behavior implemented in DO)
- followup: queue messages, execute sequentially after current prompt.
- collect: debounce and merge rapid messages (collectDebounceMs) into one prompt.
- steer: interrupt current work (abort) and steer to a new prompt.

Inbound delivery semantics
-------------------------
Normalization contract for inbound adapters:
 - provider (e.g. 'slack'|'telegram')
 - orgId (if applicable)
 - externalUserId
 - internalUserId (if resolvable via user_identity_links)
 - channelType, channelId
 - scopeKey
 - content, attachments[], authorName

Mapping rules:
- Compute scopeKey using helper functions. Lookup `channel_bindings` by scopeKey:
  - If binding exists: route to bound session DO quickly.
  - Else: dispatch to orchestrator: the orchestrator handles classification/creation.

Webhook verification & dedupe (general)
- Always verify signatures using the platform-recommended algorithm over the raw HTTP body (not a re-serialized JSON object). Reject if timestamp skew > 5 minutes.
- Persist the raw webhook envelope in `webhook_inbox` (fast-ack) and process asynchronously (ctx.waitUntil + cron safety sweep). Use provider delivery ids (e.g., GitHub delivery id, Slack event_id) as dedupe keys and store them with attempts & status.

Outbound delivery semantics
--------------------------
General rules:
- Provide a per-destination idempotency key: `deliveryKey = channel-delivery:<sessionId>:<turnId>:<channelType>:<channelId>`.
- Persist outbound attempts into `channel_deliveries`. Use the stored platformMessageId to avoid duplicates and to update existing messages.
- For non-threaded platforms (Telegram), send messages directly to chatId. For threaded platforms (Slack), always post into a thread using `thread_ts` and record the initial message `ts` to enable `chat.update` for status cards.

Formatting + files
- Each transport has a formatting adapter: Markdown→transport formatting. Telegram uses HTML parse mode; Slack uses Block Kit where appropriate. Files: prefer remote URLs (R2) + Block Kit `image_url` or use Slack `files.upload` as needed.

Slack App Architecture & Flow
----------------------------
High-level components:
- Slack app (the app in Slack): installed into a workspace, grants scopes to AgentOps.
- Worker endpoints: `/webhooks/slack/events`, `/webhooks/slack/commands`, `/webhooks/slack/interactions`.
- `slack_installations` D1 table: store teamId + encrypted bot token + appId + install metadata.
- `user_identity_links`: map Slack user (teamId + slackUserId) to AgentOps userId.

OAuth install flow (server-side)
1. Org admin clicks "Connect Slack".
2. Worker builds OAuth URL with required scopes and redirects user to Slack.
3. Slack calls back to `GET /auth/slack/callback?code&state`.
4. Worker exchanges code for tokens (`oauth.v2.access`) and saves install row (teamId, appId, bot_token encrypted) in `slack_installations`.

Recommended scopes
- `chat:write` (post messages)
- `commands` (slash commands)
- `app_mentions:read` (app_mention events)
- `channels:read` / `groups:read` / `im:read` (optional: reading channel metadata)
- `channels:history` / `groups:history` / `im:history` (optional: need for context)
- `files:write` (if uploading files)

Signing secret verification
- Use Slack `X-Slack-Signature` and `X-Slack-Request-Timestamp`. Compute HMAC SHA256 over `v0:{timestamp}:{rawBody}`. Reject if timestamp is older than 5 minutes to mitigate replay.

Events API
- Endpoint: `POST /webhooks/slack/events`.
- Handle `url_verification` (return `challenge`).
- For `event_callback`: extract `team_id`, `event.user`, `event.channel`, `event.ts`, `event.thread_ts`.
- Canonical thread key: `threadTs = event.thread_ts || event.ts`. Canonical channelId encoding: `<teamId>:<channelId>:<threadTs>` (recommended). Use `slackScopeKey(userId, teamId, channelId, threadTs)` to compute scope.
- Dedupe via Slack `event_id` (persist in webhook_inbox) before processing.

Interactive components & Slash commands
- Interactions endpoint: `POST /webhooks/slack/interactions` to receive button clicks or Block Kit actions. Verify signature and route the action to DO/orchestrator.
- Slash command endpoint: `POST /webhooks/slack/commands` — ack immediately, then use `response_url` for delayed responses. Slash commands can create sessions or trigger orchestrator flows.

Outbound posting (`chat.postMessage` / `chat.update`)
- Posting a new thread response: `chat.postMessage(channel=<channelId>, text, thread_ts=<threadTs>)`.
- When creating a new session in response to a message, create a status message and persist returned `ts` into `channel_bindings.slackInitialMessageTs` so subsequent updates can use `chat.update`.
- For large attachments prefer Slack file upload APIs or host content in R2 and reference via `image_url` in Block Kit.

Rate limiting
- Observe `429` responses and `Retry-After` header. Queue updates per team and back off. Consolidate frequent updates into status card updates rather than many small posts.

Multi-workspace & multi-channel support
--------------------------------------
- Store installations keyed by `teamId` and associate them with an AgentOps `orgId`.
- Identity links must include workspace context: `user_identity_links` should be resolved by `(provider, teamId, externalId)` or encode `externalId` as `teamId:externalId` to avoid ambiguity.
- `channel_bindings` has unique(channelType, channelId) so a destination maps to a single sessionId; to allow multiple orgs per workspace is a policy decision — recommended: one AgentOps org per Slack workspace.

Security & privacy
------------------
- Credentials encrypted at rest (use existing ENCRYPTION_KEY pattern). For Slack store bot tokens encrypted in `slack_installations`.
- Signature verification uses raw body. Do not compute signatures over re-serialized JSON.
- Limit retention of raw webhook payloads in `webhook_inbox` (e.g., TTL 30 days). Provide admin UI to inspect/replay.
- Audit log entries for inbound events, binding creation/deletion, installation/uninstallation, outbound send failures.

Reliability, retries & idempotency
---------------------------------
- Inbound: use `webhook_inbox` for fast-ack ingestion. Claim-and-process pattern with attempts and dead-letter after configurable retries. Cron sweep to pick up stale claims.
- Deduplicate by provider event ids (GitHub delivery id, Slack `event_id`). Persist event ids in `webhook_inbox` or a dedicated dedupe table.
- Outbound: persist delivery attempts in `channel_deliveries`. Use idempotency keys and store platform message ids to prevent duplicates and to support update semantics.

Sequence diagrams (ASCII)
-------------------------
Slack install (OAuth)
---------------------
User -> AgentOps UI -> Worker: request install URL
Worker -> Slack: redirect to oauth.v2.authorize
Slack -> Worker: oauth callback
Worker -> Slack API: oauth.v2.access(code)
Worker -> D1: save slack_installations(teamId, botTokenEncrypted,...)

Slack inbound -> orchestrator -> create session -> bound child
------------------------------------------------------------
User -> Slack: @agent do X
Slack -> Worker: POST /webhooks/slack/events
Worker: verify signature, persist envelope to webhook_inbox, ack
Async processor -> Worker: process inbox row → compute scopeKey
Worker -> Orchestrator DO: dispatchOrchestratorPrompt(channelType=slack, channelId=team:chan:ts)
Orchestrator -> Worker: create_session(repo, persona, initial prompt)
Worker -> D1: create channel_binding(scopeKey -> childSessionId)
Child session -> Slack: chat.postMessage(thread_ts=initial_ts, "Starting...")

Slack thread follow-up -> direct child session
-------------------------------------------
User -> Slack: reply in thread
Slack -> Worker: POST /webhooks/slack/events
Worker -> D1: find channel_binding(scopeKey) -> childSession
Worker -> SessionAgentDO(child): POST /do/prompt (queueMode)
Child -> Slack: chat.postMessage(thread_ts=initial_ts, "Done")

Open questions / decisions
-------------------------
1. Org-scoped installs vs per-user installs for Slack — recommend org-scoped only.
2. Slack canonical channelId encoding: confirm `<teamId>:<channelId>:<threadTs>`.
3. Identity uniqueness: should `user_identity_links` unique include `teamId`? (recommended yes.)
4. Which Slack events to subscribe by default beyond `app_mention`? (app_mention, message.channels, im, mpim?)
5. Retention policy for `webhook_inbox` and inbound raw payloads.

Implementation plan (high level)
--------------------------------
1. Add D1 migrations for `slack_installations`, `webhook_inbox`, `channel_deliveries`.
2. Implement `packages/worker/src/routes/slack.ts` and `packages/worker/src/services/slack.ts` for inbound/outbound handling and OAuth.
3. Update `user_identity_links` resolution to properly consider `teamId` for Slack.
4. Use `webhook_inbox` for Telegram/GitHub/Slack ingestion (fast-ack) and implement claim/processing worker + cron safety sweep.
5. Implement `channel_deliveries` persistence with retry/backoff for outbound Slack posts.

Where this lives
---------------
This file: `docs/specs/channels.md` — add it to your PR to capture the proposed design and to drive implementation.
