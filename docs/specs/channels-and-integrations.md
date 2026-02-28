# Channels and Integrations

This document defines Agent‑Ops' channel system, webhook/integration architecture, and an implementation plan for Slack (OAuth install, Events API, interactivity, outbound posting, threads, attachments, rate limiting, multi‑workspace, security, and reliability).

Where to read code: the working implementation for related pieces lives in:
- `packages/worker/src/routes/channels.ts` (channel prompt entrypoint)
- `packages/worker/src/lib/schema/channels.ts` (D1 schema for `channel_bindings`, `user_identity_links`)
- `packages/worker/src/lib/db/channels.ts` (DB helpers)
- `packages/worker/src/durable-objects/session-agent.ts` (DO that owns prompt queue, pending replies, followups)
- `packages/worker/src/routes/telegram.ts` & `packages/worker/src/services/telegram.ts` (Telegram example)
- `packages/runner/src/prompt.ts` (Runner-side ChannelSession)
- `docker/opencode/tools/channel_reply.ts` (tool used by agents to reply to channels)
- `docs/specs/integrations.md` and `V2.md` (design notes)

Summary of intent
-----------------
- Channels are first-class routing primitives mapping an external conversation context to an Agent‑Ops session (SessionAgent DO). Each channel has a `channelType` and `channelId` and is associated with a `scopeKey` used for follow-up routing.
- Channel bindings (`channel_bindings`) persist mapping from scope → sessionId so follow-up messages route directly to the active session and skip the orchestrator. Unbound messages are delivered to the user's orchestrator session for classification.
- The system supports queue modes per-binding (`followup`, `collect`, `steer`) to control how concurrent inbound messages are handled while an agent is busy.

1) Channel System Definition
----------------------------

Concepts
- ChannelType: a transport family (`web`, `telegram`, `slack`, `github`, `api`).
- ChannelId: transport-specific destination id (chatId, combined team:channel:thread key, PR id, etc.).
- ScopeKey: deterministic key used to identify conversation context and enable follow-ups. Helpers: `telegramScopeKey`, `slackScopeKey`, `webManualScopeKey`, `apiScopeKey` (see `packages/shared/src/scope-key.ts`).
- ChannelBinding: D1 row mapping `(channelType, channelId, scopeKey) -> sessionId` with queueMode metadata.
- SessionAgent DO: handles prompt queueing, per-channel pending reply tracking, auto-flush of replies, and channel follow‑up reminders.

Mapping to sessions/executions/messages
- Inbound message processing:
  1. Normalize inbound payload to ChannelMessage.
  2. Resolve internal user identity (if applicable) using `user_identity_links`.
  3. Compute scopeKey.
  4. If `channel_bindings` contains a binding for the scopeKey, POST to that SessionAgent DO (`/do/prompt`) with `channelType` and `channelId`.
  5. Else dispatch to the user's orchestrator via `dispatchOrchestratorPrompt()` which saves the message and routes to the orchestrator DO for classification and session creation.

2) Data model (concrete + proposed)
-----------------------------------

Existing (D1)
- `channel_bindings` (packages/worker/src/lib/schema/channels.ts):
  - id, sessionId, channelType, channelId, scopeKey, userId, orgId, queueMode, collectDebounceMs, slackChannelId, slackThreadTs, slackInitialMessageTs, githubRepoFullName, githubPrNumber, createdAt
  - unique(channelType, channelId), index(scopeKey)
- `user_identity_links`: provider, externalId, teamId, userId

In-DO persistence
- SessionAgent DO stores `prompt_queue` and `channel_followups` in its SQLite state for safe recovery and auto-replies.

Proposed additional D1 tables
- `slack_installations` — (id, orgId, teamId, botTokenEncrypted, botUserId, appId, installedByUserId, status, createdAt)
- `webhook_inbox` — durable webhook envelope: (id, provider, event_type, raw_headers, raw_body, routing_metadata, status, attempts, last_error, claimed_at, created_at)
- `channel_deliveries` — track outbound attempts: (id, sessionId, messageId, channelType, channelId, platformMessageId, status, attempts, last_error, createdAt)

3) API/Worker routes (existing + required)
-----------------------------------------

Existing important routes
- `POST /api/prompt` — channel-agnostic prompt entry (routes to binding or orchestrator) (`routes/channels.ts`).
- `POST /telegram/webhook/:userId` — Telegram inbound handler (per-user webhook) (`routes/telegram.ts`).
- `POST /webhooks/github` + `POST /webhooks/*` — generic webhook routes.
- Runner gateway endpoints: `GET /api/channels`, `POST /api/channel-reply` (used by OpenCode tools).

Routes to add (Slack)
- `POST /webhooks/slack/events` — Events API (url_verification + event_callback).
- `POST /webhooks/slack/commands` — Slash commands.
- `POST /webhooks/slack/interactions` — interactive components payloads.
- `GET /auth/slack/install` & callback `GET /auth/slack/callback` — OAuth install flow.
- Admin/UX routes: `GET /api/me/slack` (status), `POST /api/me/slack/disconnect`.

4) Inbound receive semantics
----------------------------

Normalization
- Every inbound adapter must produce a normalized ChannelMessage with: provider, orgId (if applicable), externalUserId, internalUserId (if resolvable), channelType, channelId, scopeKey, content, attachments[], authorName, raw metadata.

Webhook verification
- Verify provider signatures using raw HTTP body and provider-recommended signing algorithm. Do NOT re-serialize JSON before verifying. Examples:
  - Slack: `v0={hex_hmac(SLACK_SIGNING_SECRET, 'v0:' + timestamp + ':' + rawBody)}` vs `X-Slack-Signature`, ensure `X-Slack-Request-Timestamp` within 5 minutes.
  - GitHub: `X-Hub-Signature-256` HMAC-SHA256 over the raw body.

Deduplication + idempotency
- Persist each inbound webhook to `webhook_inbox` as the first step (fast-ack). Use provider event/delivery IDs as dedupe keys (e.g. GitHub delivery-id, Slack event_id). Workers / cron will claim and process inbox rows with attempts counting.

Mapping rules
- Compute `scopeKey` using provider helpers. Lookup `channel_bindings` by `scopeKey`. If binding exists route direct to DO; if not dispatch to orchestrator.

5) Outbound delivery semantics
--------------------------------

General
- All agent-initiated external messages use a delivery pipeline:
  1. Agent calls `channel_reply` tool (or DO auto-flush triggers) → gateway → SessionAgent DO `handleChannelReply()` → service adapter sends to platform.
  2. Persist delivery attempt to `channel_deliveries` with idempotency key.
  3. On success store `platformMessageId` so future updates use `chat.update` instead of creating duplicates.

Threading semantics
- Slack: thread-based — use `thread_ts` for replies. Canonical channelId: `<teamId>:<channelId>:<threadTs>` (recommended). The first agent post in response to a message should be recorded (initial `ts`) in `channel_bindings.slackInitialMessageTs` for later updates.
- Telegram: no native threads — use `chatId` to identify destination.

Idempotency
- Use consistent `deliveryKey` for each assistant turn: `channel-delivery:<sessionId>:<turnId>:<channelType>:<channelId>`. Skip duplicate posts if `channel_deliveries` already has a successful record.

Formatting & attachments
- Each adapter converts the agent's content into the platform's preferred payload:
  - Slack: Block Kit preferred; fallback to `text` with `mrkdwn`.
  - Telegram: HTML parse mode for basic formatting.
- For images/files: prefer hosting in R2 and referencing via `image_url` if possible. Use Slack file upload APIs only if necessary (respect rate limits and size limits).

6) Slack app architecture (full details)
--------------------------------------

Install (OAuth)
- Flow:
  1. Org admin starts install → Worker builds Slack OAuth URL with `client_id`, `scopes`, `redirect_uri`, `state`.
  2. Slack redirects to Worker callback with `code` and `state`.
  3. Worker exchanges code (`oauth.v2.access`) and stores installation row in `slack_installations` with encrypted bot token and `team_id`.
- Storage: encrypted bot token (AES-256-GCM using `ENCRYPTION_KEY`), `teamId`, `appId`, `botUserId`, `installedByUserId`, `orgId`.

Scopes (recommended)
- Minimal:
  - `chat:write` (post messages)
  - `app_mentions:read` (app mentions)
  - `commands` (slash commands)
- Optional (based on features):
  - `channels:history` / `groups:history` / `im:history` (if full message context required)
  - `channels:read` / `groups:read` / `im:read` (list & introspect)
  - `files:write` (upload files)

Events API
- Endpoint: `POST /webhooks/slack/events`.
- Verify signature, persist to `webhook_inbox`, ack 200.
- For `event_callback` handle relevant events (e.g. `app_mention`, `message` in threads where bot participates). Compute `threadTs = event.thread_ts || event.ts` and canonical `channelId = teamId:channel:threadTs`.

Interactive components + slash commands
- `POST /webhooks/slack/interactions` for Block Kit actions: verify signature and route action to DO/orchestrator.
- `POST /webhooks/slack/commands` for slash commands: immediate 200; use `response_url` to send delayed messages or create sessions.

chat.postMessage + thread_ts mapping
- Use `chat.postMessage(channel=<channelId>, text=<...>, thread_ts=<threadTs>)`.
- For session-created status messages, save returned `ts` in `channel_bindings.slackInitialMessageTs` so subsequent updates use `chat.update`.

Files / attachments
- Preferred: host artifacts in R2 and reference via `image_url` in Slack blocks.
- If file upload needed: use `files.upload` (respect token scopes and size limits). Store `file_id` mapping in `channel_deliveries` if future updates must reference it.

Rate limiting
- Slack responds with 429 and `Retry-After`. Implement per-team rate-limiting queues and exponential backoff. Consolidate frequent updates as `chat.update` to avoid many `chat.postMessage` calls.

7) Multi-workspace & per-org installs
-----------------------------------
- Each Slack installation row is tied to an AgentOps `orgId` and a Slack `teamId`. Worker should prevent multiple orgs claiming the same Slack `teamId` (recommend 1:1 mapping).
- Identity linking: `user_identity_links` must include `teamId` to disambiguate users across workspaces. When processing a Slack event, resolve internal userId by `(provider='slack', teamId, slackUserId)`.

8) Security & privacy
----------------------
- Signatures verified against raw request body.
- Store bot tokens & credentials encrypted with `ENCRYPTION_KEY` (re-use existing credential storage patterns).
- Minimal retention of raw inbound payloads (configurable TTL) and strict access control for admin inspection.
- Audit log: write entries for inbound event receipt, binding creation/deletion, install/uninstall events, outbound failures.

9) Reliability: webhook_inbox, retries & DLQ
-----------------------------------------
- Ingest webhooks via `webhook_inbox` (persist raw headers + body). Return 200 immediately (fast-ack).
- Processing: claim-and-process pattern with attempts counter. Use ctx.waitUntil for immediate processing + scheduled cron sweep for orphaned rows.
- On repeated failure move to `dead_letter` status and surface in admin UI for manual inspection and replay.
- Outbound sends: persist attempts in `channel_deliveries`; retry on transient errors (429, 5xx) with exponential backoff and idempotency keys to prevent duplicates.

10) ASCII sequence diagrams
---------------------------
Install + initial message
-------------------------
User -> AgentOps UI -> Worker: Start Slack install
Worker -> Slack: OAuth redirect (client_id, scopes, state)
Slack -> Worker: OAuth callback (code)
Worker -> Slack API: oauth.v2.access(code)
Worker -> D1: create slack_installations(teamId, botTokenEncrypted...)

Inbound app_mention -> orchestrator -> create child -> bind
----------------------------------------------------------
User -> Slack: "@agent do X"
Slack -> Worker: POST /webhooks/slack/events
Worker: verify signature, write to webhook_inbox, return 200
Worker (async) -> compute scopeKey, find no binding
Worker -> Orchestrator DO: dispatch message
Orchestrator -> Worker: create_session(...) -> returns childSessionId
Worker -> D1: create channel_binding(scopeKey -> childSessionId)
Child session -> Slack: chat.postMessage(thread_ts=initial_ts, "Starting...")

Thread follow-up -> child
-------------------------
User -> Slack: reply in thread
Slack -> Worker: POST /webhooks/slack/events
Worker -> D1: find channel_binding(scopeKey) -> childSession
Worker -> SessionAgentDO(child): POST /do/prompt (queueMode from binding)
Child -> Slack: chat.postMessage(thread_ts=initial_ts, "Done")

11) Open questions / decisions
-----------------------------
- Org-scoped install vs per-user installs: recommend org-scoped only (simpler security model).
- Slack canonical channelId encoding: adopt `<teamId>:<channelId>:<threadTs>`.
- Identity mapping: update `user_identity_links` uniqueness to include `teamId` for Slack.
- Which Slack events should be subscribed to by default (app_mention only or broader message scopes)?
- Retention policy for `webhook_inbox` and inbound raw bodies (suggest 30 days configurable).

12) Implementation checklist (recommended order)
------------------------------------------------
1. Add D1 migrations for `slack_installations`, `webhook_inbox`, `channel_deliveries`.
2. Implement `routes/slack.ts` + `services/slack.ts` for verification, inbox ingestion, and OAuth callback handling.
3. Update `user_identity_links` resolution to accept (provider, teamId, externalId).
4. Implement `channel_deliveries` delivery + retry queue for Slack outbound posts.
5. Migrate Telegram/GitHub webhook handlers to write to `webhook_inbox` (fast-ack) and process asynchronously.
6. Add admin UI to view `webhook_inbox` and dead-letter items and to manually replay.

References
- packages/worker/src/routes/telegram.ts — working model for bot webhooks and direct routing.
- packages/worker/src/durable-objects/session-agent.ts — prompt queue, pendingChannelReply, followups, and example of how to persist auto-replies.
- docs/specs/integrations.md and V2.md for additional design context.

If you want I can implement the migrations and the Slack route skeleton in a follow-up PR. This doc should be reviewed and merged into `main` before or alongside code changes.
