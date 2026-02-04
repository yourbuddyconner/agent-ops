---
# agent-ops-vn3t
title: Claude Code runtime support (Max plan)
status: todo
type: epic
priority: high
tags:
    - runner
    - worker
    - frontend
    - sandbox
created_at: 2026-02-03T23:30:45Z
updated_at: 2026-02-03T23:30:45Z
---

Add Claude Code as an alternative agent runtime alongside OpenCode, primarily to leverage the Max plan's significantly higher token allowances vs API pricing.

## Context

Currently all sessions run OpenCode as the agent runtime inside Modal sandboxes. Claude Code with a Max plan subscription offers ~20x the token budget at flat monthly cost ($200/mo for Max vs potentially thousands in API credits for equivalent usage). This makes it the most cost-effective way to run heavy agent workloads.

## Key Findings from Investigation

### Authentication Discovery
Claude Code stores OAuth credentials in the OS keychain (macOS Keychain under service `Claude Code-credentials`, keyed by OS username). The credential format is standard OAuth2 JSON — not encrypted, not machine-bound:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": <epoch_ms>,
    "scopes": [
      "user:inference",
      "user:mcp_servers", 
      "user:profile",
      "user:sessions:claude_code"
    ],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

- Access tokens are short-lived (~24h), refresh tokens are long-lived
- Tokens are portable — no machine fingerprint or hardware binding
- Token refresh happens transparently; we need to implement the refresh endpoint call ourselves server-side

### Runner Architecture
- `packages/runner/src/prompt.ts` is tightly coupled to OpenCode's HTTP API (session CRUD, prompt_async, SSE /event stream, permissions, diff)
- `packages/runner/src/agent-client.ts` (WebSocket to SessionAgent DO) is already agent-agnostic — it just sends/receives typed messages
- Need an `AgentRuntime` interface extracted from `prompt.ts` that both runtimes implement

### Claude Code Integration Approach
Use the **Claude Agent SDK** (TypeScript) for programmatic control:
- Typed async iterator for streaming responses (text chunks, tool calls, completions)
- Session management with resume/fork semantics
- Model selection, permission modes, MCP server configuration
- Same auth mechanism as CLI (reads from keychain or env vars)

Alternative considered and rejected: hooks + CLI print mode. Hooks are fire-and-forget (not request-response), no persistent sessions, no mid-stream abort/revert. Fine for policy enforcement but wrong primitive for a bidirectional bridge.

## Implementation Sub-tasks

### 1. Abstract AgentRuntime interface
Extract from current OpenCode coupling in `prompt.ts`:
```typescript
interface AgentRuntime {
  createSession(config?: SessionConfig): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  submitPrompt(sessionId: string, content: string, model?: ModelSpec): Promise<void>;
  abort(sessionId: string): Promise<void>;
  revert(sessionId: string, messageId: string): Promise<void>;
  getDiff(sessionId: string): Promise<DiffFile[]>;
  getAvailableModels(): Promise<ModelInfo[]>;
  onEvent(handler: (event: AgentRuntimeEvent) => Promise<void>): void;
  dispose(): Promise<void>;
}
```
Refactor `prompt.ts` into:
- `PromptCoordinator` — agent-agnostic orchestration (message ID mapping, tool state tracking, DO message forwarding)
- `OpenCodeRuntime` — current OpenCode HTTP/SSE implementation behind the interface

### 2. Build ClaudeCodeRuntime adapter  
Implement `AgentRuntime` using Claude Agent SDK:
- Map SDK streaming messages to `AgentRuntimeEvent` union type
- Handle session resume/fork for multi-turn conversations
- Map tool execution events to runner's `tool` message format (callID, toolName, status, args, result)
- Implement abort via SDK cancellation
- Git-based diff generation (Claude Code doesn't expose a diff API like OpenCode)
- Model list from SDK capabilities

### 3. OAuth credential provisioning (MVP)
Simplest path first: CLI-assisted credential upload.
- User runs local CLI tool (or curl command) that reads `Claude Code-credentials` from keychain and POSTs refresh token to agent-ops API
- Worker stores encrypted refresh token in D1 (per-user `claude_credentials` table)
- On sandbox boot, backend fetches credential from worker API, injects into sandbox credential store
- Worker handles token refresh server-side (call Anthropic's token endpoint with refresh token, cache new access token)

### 4. OAuth credential provisioning (Full — see research bean)
Proxy the OAuth flow through the agent-ops web UI so users never touch tokens directly:
- "Connect Claude Max" button in settings
- Redirects through Anthropic's OAuth authorize endpoint
- Callback captures tokens server-side
- See research bean for feasibility investigation

### 5. Sandbox Claude Code installation
- Add Claude Code (`@anthropic-ai/claude-code` npm package or standalone binary) to sandbox Docker image
- Credential injection in `start.sh`: write credential JSON to appropriate store (Linux keyring via `secret-tool`, or file-based fallback)
- Environment variable `AGENT_RUNTIME=opencode|claude-code` controls which runtime the runner initializes
- Bump `IMAGE_BUILD_VERSION` in `backend/images/base.py`

### 6. Session runtime selection
- Add `runtime` column to sessions D1 table (default: `opencode`)
- Add `runtime` field to shared Session type
- Pass runtime choice through session creation → sandbox boot → runner initialization
- API: accept `runtime` param on `POST /api/sessions`

### 7. Frontend runtime selection & display
- Runtime selector on session creation (dropdown or toggle)
- Runtime badge/indicator on session cards and session detail page
- Handle model list differences between runtimes
- Credential connection status indicator ("Claude Max connected" / "Not connected")

## Risks

- **ToS risk**: Max plan ToS may prohibit automated/server-side usage of consumer OAuth tokens. Needs review before shipping broadly.
- **Credential format changes**: Anthropic could add machine binding, change storage format, or rotate the keychain service name in future CLI updates.
- **Rate limiting**: Behavior under `default_claude_max_20x` tier with concurrent sandbox sessions is unknown. May hit per-account concurrency limits.
- **Agent SDK stability**: Relatively new, API surface may change.
- **Scope limitations**: The `user:inference` scope may be revocable or auditable by Anthropic. Running inference from cloud IPs (Modal) instead of user's local machine could trigger fraud detection.

## Acceptance Criteria

- [ ] `AgentRuntime` interface exists and OpenCode uses it (no behavior change)
- [ ] Sessions can be created with either OpenCode or Claude Code runtime
- [ ] Claude Code sessions authenticate via Max plan OAuth tokens
- [ ] Credential provisioning works end-to-end (local upload → server storage → sandbox injection)
- [ ] Token refresh happens automatically server-side
- [ ] Streaming text, tool calls, abort, and revert work through Claude Code runtime
- [ ] Runtime selection persisted in DB and visible in UI
- [ ] Model list reflects the selected runtime's available models