# Session-Agent Service Extraction Design

**Date**: 2026-03-22
**Status**: Proposed
**Scope**: Extract domain handler logic from `session-agent.ts` into services, delete legacy GitHub handlers, clean up folder structure

## Problem

After 6 phases of decomposition, `session-agent.ts` is still ~9100 lines. The DO-coupled subsystems (MessageStore, PromptQueue, RunnerLink, SessionState, SessionLifecycle, ChannelRouter) have been extracted, but ~6000 lines of domain handler logic remain inline. This code is mostly CRUD operations and API wrappers that don't need DO primitives — they just need `appDb` and `env`.

Additionally, GitHub-specific code is hardcoded in the DO (`handleCreatePR`, `handleUpdatePR`, `handleListPullRequests`, `handleInspectPullRequest`, `handleReadRepoFile`) despite `plugin-github` already providing the same operations through the action framework. Dedicated OpenCode tools (`create_pull_request`) bypass the plugin system entirely. This duplication is a code smell.

## Design Principles

1. **Services are plain async functions.** No classes, no state. They take explicit dependencies (`appDb`, `env`, specific bindings) and return typed results. They never call `runnerLink.send()` or `broadcastToClients()`.

2. **The DO is a thin message router.** It receives runner messages, calls the appropriate service function, and sends the result back. Error handling and runner message framing stay in the DO.

3. **No domain-specific code in `durable-objects/`.** Only DO-coupled collaborators (things that need `ctx.storage.sql`, WebSocket primitives, or alarms) live in `durable-objects/`. Everything else goes to `services/` or `lib/`.

4. **GitHub operations use the plugin system.** The agent uses `call_tool` → `plugin-github` actions for all GitHub operations. No special-cased runner message types for GitHub.

5. **Incremental delivery.** Each extraction ships independently. The runner protocol is unchanged — handler names and response shapes stay the same.

## Folder Structure (End State)

```
src/
  durable-objects/           # DO classes + DO-coupled collaborators only
    session-agent.ts         # Thin coordinator (~5000 lines)
    session-state.ts         # Typed state accessors (needs ctx.storage.sql)
    session-lifecycle.ts     # Sandbox HTTP ops + timing (needs ctx.storage)
    runner-link.ts           # WebSocket lifecycle (needs ctx)
    prompt-queue.ts          # Queue state machine (needs ctx.storage.sql)
    message-store.ts         # Message persistence (needs ctx.storage.sql)
    channel-router.ts        # Reply tracking (turn-scoped in-memory state)
    event-bus.ts             # Separate DO
    workflow-executor.ts     # Separate DO

  services/                  # Domain logic — plain async functions
    channel-reply.ts         # (existing)
    persona.ts               # (existing)
    session-workflows.ts     # Workflow + trigger CRUD, execution dispatch
    session-skills.ts        # Skill library CRUD
    session-personas.ts      # Persona CRUD, file ops, skill attachment
    session-identity.ts      # Orchestrator identity get/update/sync
    session-tools.ts         # Tool discovery, action execution, policy
    session-memory.ts        # Memory file CRUD + FTS search
    session-mailbox.ts       # Mailbox send/check
    session-tasks.ts         # Task board CRUD
    session-cross.ts         # Spawn child, messaging, terminate, status

  lib/
    db/                      # (existing) DB query helpers
    schema/                  # (existing) Drizzle schemas
    utils/
      prompt-validation.ts   # Pure functions: attachment parsing, sanitization
      runtime.ts             # Pure functions: state derivation, payload parsing
```

**Naming convention:** New service files use a `session-` prefix to distinguish them from the existing route-backing services (e.g., `services/workflows.ts` already exists for HTTP route handlers). The `session-*` files back runner message handlers from the SessionAgent DO.

## Service Function Pattern

Every service function follows the same contract:

```typescript
// services/session-workflows.ts
import type { AppDb } from '../lib/db.js';

export async function listWorkflows(
  db: AppDb,
  userId: string,
  opts?: { limit?: number }
): Promise<{ workflows: WorkflowRow[] }> {
  // DB queries, validation, formatting
  // NO runner messaging, NO WebSocket, NO broadcast
  return { workflows };
}
```

The DO handler becomes a thin wrapper:

```typescript
// In buildRunnerHandlers()
'workflow-list': async (msg) => {
  try {
    const result = await listWorkflows(this.appDb, userId);
    this.runnerLink.send({
      type: 'workflow-list-result',
      requestId: msg.requestId,
      ...result,
    });
  } catch (err) {
    this.runnerLink.send({
      type: 'workflow-list-result',
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

**Rules:**
- Pure async functions, not classes
- Take `appDb`, `env`, or specific bindings as explicit params
- Return typed result objects
- Throw typed errors (`NotFoundError`, `ValidationError`)
- No `ctx.storage.sql` — that's DO-only
- No `runnerLink.send()` — the DO handles message framing
- Can call other services, `lib/db/` helpers, or external APIs

## Service Extractions

### services/session-workflows.ts

**Source methods:**
- `handleWorkflowList()` — list workflows for user
- `handleWorkflowSync()` — create-or-update workflow by ID
- `handleWorkflowRun()` — dispatch workflow execution
- `handleWorkflowExecutions()` — list executions
- `handleWorkflowApi()` — CRUD (create/read/update/delete)
- `handleTriggerApi()` — trigger CRUD + trigger-run
- `handleExecutionApi()` — execution list/get, step get/update
- `handleWorkflowExecutionResult()` — process workflow turn results
- `handleWorkflowExecuteDispatch()` — dispatch workflow execution to runner

**Dependencies:** `appDb`, `env.DB`, `sessionState` (for userId, sessionId), workflow DB helpers, `validateWorkflowDefinition()`, `enqueueWorkflowExecution()`, `checkWorkflowConcurrency()`

**Helpers that move with it:** `deriveRepoFullName()`, `deriveWorkerOriginFromSpawnRequest()`, `normalizeWorkflowRow()`, `parseJsonOrNull()`, `resolveWorkflowIdForUser()`, `scheduleTargetFromConfig()`, `requiresWorkflowForTriggerConfig()`

**Estimated lines:** ~1600

### services/session-skills.ts

**Source methods:**
- `handleSkillApi()` — search/list/get/create/update/delete skills

**Dependencies:** `appDb`, `env.DB` (for FTS), `sessionState` (for userId)

**Estimated lines:** ~130

### services/session-personas.ts

**Source methods:**
- `handlePersonaApi()` — get/create/update/delete personas, file ops, skill attachment
- `handleListPersonas()` — list available personas for user

**Dependencies:** `appDb`, `sessionState` (for userId, isOrchestrator)

**Estimated lines:** ~220

### services/session-identity.ts

**Source methods:**
- `handleIdentityApi()` — get/update/sync orchestrator identity

**Dependencies:** `appDb`, `sessionState` (for userId)

**Estimated lines:** ~65

### services/session-tools.ts

**Source methods:**
- `listTools()` — enumerate tools from integrations + MCP, resolve credentials, cache risk levels, filter by policy
- `resolveAndExecuteAction()` — resolve action from toolId, invoke via MCP action source, return result
- `resolveActionPolicy()` — check action policy (deny/pending_approval/allowed) for a given tool

**Split boundary:** The service handles tool listing, policy resolution, and action execution. The DO retains the `handleCallTool()` orchestration wrapper that calls the service and, when policy is `pending_approval`, creates `interactive_prompts` entries in `ctx.storage.sql` and broadcasts to clients. The service never touches `ctx.storage.sql` or WebSocket broadcast.

**Dependencies:** `appDb`, `env.DB`, `sessionState` (for userId), integration registry, credential cache, `discoveredToolRiskLevels` cache, action policy helpers (`invokeAction`, `approveInvocation`, `denyInvocation`, `markExecuted`, `markFailed`)

**Helpers that move with it:** `serializeZodSchema()`, `zodTypeToString()`

**Estimated lines:** ~500 (the ~100 lines of approval gating stay in the DO)

### services/session-memory.ts

**Source methods:**
- `handleMemRead()` — read file or list directory
- `handleMemWrite()` — write file
- `handleMemPatch()` — JSON patch operations
- `handleMemRm()` — delete file(s)
- `handleMemSearch()` — FTS search

**Dependencies:** `appDb`, `env.DB`, memory DB helpers (`listMemoryFiles`, `readMemoryFile`, `writeMemoryFile`, `patchMemoryFile`, `deleteMemoryFile`, `deleteMemoryFilesUnderPath`, `searchMemoryFiles`)

**Estimated lines:** ~70

### services/session-mailbox.ts

**Source methods:**
- `handleMailboxSend()` — store message in orchestrator mailbox
- `handleMailboxCheck()` — fetch mailbox messages

**Dependencies:** `appDb`, `env.DB`, `sessionState` (for userId, sessionId), mailbox DB helpers

**Estimated lines:** ~60

### services/session-tasks.ts

**Source methods:**
- `handleTaskCreate()` — create task
- `handleTaskList()` — list tasks by status
- `handleTaskUpdate()` — update task
- `handleTaskMy()` — get tasks assigned to current user

**Dependencies:** `appDb`, `env.DB`, `sessionState` (for userId, sessionId), task DB helpers

**Estimated lines:** ~100

### services/session-cross.ts

**Source methods:**
- `handleSpawnChild()` — spawn child session with parent defaults
- `handleSessionMessage()` — send message to sibling session
- `handleSessionMessages()` — fetch message history from sibling
- `handleForwardMessages()` — relay messages between sessions
- `handleTerminateChild()` — stop child session
- `handleListChildSessions()` — list child sessions for current session
- `handleGetSessionStatus()` — get status of a target session
- `handleListChannels()` — list available channel destinations

**Dependencies:** `appDb`, `env.SESSIONS` (DO binding), `sessionState`, `messageStore` (for forwarding), session DB helpers, credential helpers

**Note:** These use `env.SESSIONS` for inter-DO communication, which makes them more tightly coupled than other services. The service functions take the DO binding as an explicit parameter.

**Estimated lines:** ~430

## GitHub Deletion

### What Gets Deleted

**OpenCode tools:**
- `docker/opencode/tools/create_pull_request.ts`
- Any other GitHub-specific OpenCode tools

**DO handler methods:**
- `handleCreatePR()`
- `handleUpdatePR()`
- `handleListPullRequests()`
- `handleInspectPullRequest()`
- `handleReadRepoFile()`
- `handleListRepos()` (the `source === 'github'` path depends on `getGitHubToken()` which is also deleted; the agent uses `call_tool service=github` instead)

**DO helper methods:**
- `getGitHubToken()`
- `resolveGitHubTokenForUser()`
- `extractOwnerRepo()`
- `resolveOwnerRepo()`

**Runner message handlers in `buildRunnerHandlers()`:**
- `create-pr`
- `update-pr`
- `list-pull-requests`
- `inspect-pull-request`
- `read-repo-file`
- `list-repos`
- `pr-created` (broadcast handler)

**Runner gateway (`packages/runner/src/gateway.ts`):**
- Callbacks: `onCreatePullRequest`, `onUpdatePullRequest`, `onListPullRequests`, `onInspectPullRequest`, `onReadRepoFile`, `onListRepos`
- Type definitions: `CreatePullRequestParams`, `UpdatePullRequestParams`, `ListPullRequestsParams`, `InspectPullRequestParams`

**Runner gateway wiring (`packages/runner/src/bin.ts`):**
- All callback implementations for the above

**Runner agent-client methods (`packages/runner/src/agent-client.ts`):**
- `requestCreatePullRequest()`
- `requestUpdatePullRequest()`
- `requestListPullRequests()`
- `requestInspectPullRequest()`
- `requestReadRepoFile()`
- `requestListRepos()`

### What Stays

- `report_git_state` OpenCode tool — generic, not GitHub-specific
- `git-state` runner message handler — reports branch/commit info
- `repo:refresh-token` handler — generic credential refresh
- `repo:clone-complete` handler — generic clone completion
- Session git state in D1 — the schema stays, just not auto-populated by PR creation
- `plugin-github` actions — these are the canonical way to interact with GitHub

### What Changes

- OpenCode instructions (`docker/opencode/opencode.json`): remove references to `create_pull_request` tool, update to say "use `list_tools service=github` and `call_tool` for GitHub operations"

### Feature Gap

Removing the dedicated `handleCreatePR()` means PR creation through `call_tool` no longer auto-updates session git state (PR number, URL, branch in the session UI). This is a cosmetic loss — the PR is still created on GitHub, the agent still gets the result.

This gap is addressed by the **action effect system** (follow-on design): plugins return typed effect descriptors alongside data, and the DO processes them. See "Future Work" below.

## Utility Extractions

### lib/utils/prompt-validation.ts

Pure functions moved from the top of session-agent.ts:
- `parseBase64DataUrl()` — extract base64 from data: URL
- `sanitizePromptAttachments()` — validate and cap attachments
- `attachmentPartsForMessage()` — convert attachment to message part
- `parseQueuedPromptAttachments()` — parse JSON attachments from queue

### lib/utils/runtime.ts

Pure functions for state derivation:
- `deriveRuntimeStates()` — map lifecycle + queue state to runtime states
- `parseQueuedWorkflowPayload()` — parse workflow execution payload from queue

## What This Does NOT Cover

- **Action effect system** — plugins declaring session state side effects (follow-on design)
- **Runner protocol changes** — all runner message types stay the same; the DO just delegates internally
- **Interactive prompts** — question/approval lifecycle stays in the DO (requires ctx.storage.sql + WebSocket broadcast)
- **Channel reply/followup** — `handleChannelReply()`, `insertChannelFollowup()`, `resolveChannelFollowups()` stay in the DO (requires channelRouter state, persona resolution, WebSocket broadcast, `ctx.storage.sql` for followup table)
- **Prompt orchestration** — handlePrompt, handlePromptComplete stay in the DO (coordinates PromptQueue + RunnerLink)
- **Client message handling** — WebSocket routing stays in the DO
- **Event/audit logging** — stays in the DO (uses ctx.storage.sql + EventBus DO binding)

## Future Work

### Action Effect System

A minimal extension to the action contract that lets plugins declare side effects:

```typescript
interface ActionResult {
  data: unknown;
  effects?: ActionEffect[];
}

type ActionEffect =
  | { type: 'session.gitState'; data: Partial<GitState> }
  | { type: 'session.broadcast'; event: ClientOutbound }
  | { type: 'session.audit'; eventType: string; summary: string }
```

The DO's `executeAction()` processes effects after the action completes. This brings back PR tracking (and enables any plugin to affect session state) without hardcoding domain logic in the DO.

This deserves its own design spec and should not be rushed into this extraction round.
