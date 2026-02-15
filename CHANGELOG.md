# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased] - 2025-02-15

### New Features

#### Channels & External Integrations
- **Telegram Integration**: Full Telegram bot support with webhook handling, photo receiving, slash commands (`/help`, `/status`, `/stop`, `/clear`, `/refresh`, `/sessions`), and HTML-formatted message delivery
- **Channel System**: New channel bindings architecture with scope keys, queue modes, and channel-aware message routing
- **Channel Reply Tool**: `channel_reply` tool for orchestrator → external channel message delivery with optional image attachments
- **Auto Channel Reply**: Automatic forwarding of agent responses to originating channels with "sent to telegram" badges
- **Channel Follow-up Reminders**: Repeating reminder nudges for external messages requiring responses (5-minute intervals)
- **Channel Discovery Tool**: New tool to discover available channels for integration

#### Workflow & Automation Enhancements
- **Bash Step Type**: First-class `bash` step type with terminal-style command display, validation across the stack, and GH Actions-style runs UI
- **Type-Aware Step Display**: Parallel/conditional child steps are visually indented; bash commands shown in collapsed rows; step-specific renderers for bash, approval, agent, and conditional steps
- **Workflow URL Persistence**: Selected run and tab state now persisted in URL search params (`?tab=runs&run=<id>`)
- **Expand/Collapse Controls**: Added expand/collapse all buttons for step traces and steps panels
- **Automation Tab**: Renamed "Workflows" to "Automation" with top-level triggers UI and sub-tabs for Triggers, Workflows, and Executions
- **Model Preferences for Workflows**: Workflow executions now use user model preferences with failover handling

#### Security & Secrets Management
- **1Password Integration**: Per-user credential storage with encrypted AES-GCM storage, settings UI, and secret resolution via Runner
- **Secret Fill Tool**: `secret_fill` tool to fill browser form fields with 1Password secrets without exposing values in conversation
- **Secret Injection System**: Provider-agnostic secrets system with `secret_list`, `secret_inject`, and `secret_run` tools; automatic masking of secret values in output

#### Messaging & Notifications
- **Notification Queue**: Replaced inbox with notification queue and approval emits system
- **Event-Level Notification Preferences**: Granular notification settings for session lifecycle events
- **Inbox Auto-Dismiss**: Improved inbox behavior with auto-dismiss for certain notification types
- **Message Copy Button**: Added clipboard utility for copying message content

#### Session Management
- **Session Archiving**: Automatic archival of terminated/error sessions after 7 days via nightly cron (3am UTC); GCs Durable Object storage while preserving D1 data
- **Session Concurrency Limits**: Per-user active session limits (default 10 concurrent sessions)
- **Paginated Child Sessions**: Server-side pagination and filtering for orchestrator child sessions
- **Bulk Delete**: Bulk delete functionality with selection checkboxes for session management
- **Session Break Command**: `/new-session` command to reset AI context with visual break divider

#### Voice & Media
- **Audio/Voice Support**: Full audio pipeline with browser mic recording, Telegram voice notes, and auto-transcription via whisper.cpp + ffmpeg
- **Image Sending**: Support for sending images via `channel_reply` tool with base64 encoding through the full stack
- **Transcribe Audio Tool**: `transcribe_audio` OpenCode tool for agent-initiated speech-to-text

#### Slash Commands
- **Slash Command System**: Shared command registry with handler types (local, websocket, api, opencode) and command picker overlay in chat composer
- **Telegram Slash Commands**: Full slash command support in Telegram bot integration

#### Developer Experience
- **Unified Integrations Page**: Wizard dialog and cards for all integrations (1Password, Telegram, GitHub, Linear) with inline token setup
- **Settings Reorganization**: Tabbed layout with General, Agent, and Developer tabs; URL-persisted tab state
- **Git Configuration**: "Use noreply email" toggle and automatic backfill from GitHub profile data
- **Tool-Card Path Display**: Workspace-relative path summaries in tool cards
- **Editor Toolbar Buttons**: Split editor drawer into separate VS Code, Desktop, and Terminal toolbar buttons

### Bug Fixes

#### Session & Runtime
- **Orchestrator Session Hang**: Fixed idle session abort causing subsequent prompts to be silently dropped; added status checks before aborting and 90s first-response timeout
- **Session Restoration**: Removed cold start session restoration logic (unnecessary with fresh OpenCode instances on cold starts)
- **Runner State Persistence**: Fixed session state persistence across Durable Object hibernation
- **Orchestrator Credentials**: Fixed missing user credentials injection into orchestrator sandbox sessions
- **Child Termination Notifications**: Deduplicated child termination notifications with idempotency guards

#### Browser & Automation
- **Browser Session Persistence**: Fixed `AGENT_BROWSER_PROFILE` environment variable for persistent browser sessions (PR #5)
- **Browser Hangs**: Prevented agent-browser hangs with timeout wrapping and networkidle warning removal
- **Playwright Chromium**: Preinstalled Playwright Chromium in sandbox images

#### UI/UX
- **Activity Chart**: Fixed Y-axis labels clipped by negative margins; single Y-axis for true scale representation
- **Dashboard Filtering**: Fixed recent/active sessions to show only user-accessible sessions (not org-wide)
- **Mobile Chat Composer**: Redesigned to ChatGPT-inspired layout with circular send button
- **Forwarded Message Styling**: Fixed Telegram forwarded message visibility (bold text and blockquote contrast)
- **Tab Panel Layout**: Constrained tab content panels to max-w-3xl and centered for better readability

#### Workflow & Triggers
- **Schedule Trigger Upsert**: Fixed model persistence and fallback for schedule trigger upserts
- **Sync Trigger Response**: Fixed trigger ID parsing from response level
- **DELETE Tools**: Switched to curl for DELETE operations to avoid Bun fetch connection reuse issues

#### Notifications
- **Lifecycle Noise**: Suppressed lifecycle notifications for orchestrator sessions (start/complete notifications were noise)
- **Channel Follow-ups**: Fixed channel follow-up reminder timer behavior

### API Changes

#### New Tools
- `channel_reply` - Send messages to external channels with optional image attachments
- `secret_fill` - Fill browser fields with 1Password secrets
- `secret_list` - List available secrets from 1Password
- `secret_inject` - Inject secrets into template files
- `secret_run` - Run commands with secrets as environment variables
- `transcribe_audio` - Transcribe audio files using whisper.cpp

#### Modified Tools
- `sync_workflow` - Added validation for step types; rejects `type: "tool" + tool: "bash"` in favor of `type: "bash"`

#### New API Endpoints
- `POST /api/secrets/fill` - Fill browser fields with secrets
- `GET|POST /api/secrets/list` - List available secrets
- `POST /api/secrets/inject` - Inject secrets into templates
- `POST /api/secrets/run` - Run commands with secret env vars
- `GET /api/auth/me/credentials/:provider` - CRUD for user credentials

### Documentation

- **README Enhancement**: Comprehensive documentation overhaul with table of contents, detailed installation instructions, usage examples, contributing guidelines, and full MIT license text (PR #7)
- **Workflow Skill Docs**: Rewrote SKILL.md with detailed per-type documentation, examples, and guidance for bash steps
- **Orchestrator Guidance**: Added persona guidance for channel acknowledgments and periodic check-ins

### Integrations (Research & Planning)

- **Supabase Integration Bean**: Added research bean for database management and authentication integration (PR #6)
- **Notion Integration Bean**: Added research bean for documentation and knowledge management integration (PR #6)

### Infrastructure & Operations

- **Session Archive GC**: Nightly cleanup job for archived session volumes
- **Memory Pruning Tools**: Added tools for memory cleanup and management
- **Sandbox Image**: Bumped to version v107 with various improvements

### Breaking Changes

None

### Deprecations

None

## Previous Releases

For changes prior to 2025-02-08, please refer to the git history.
