# Session-Agent Service Extraction — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract domain handler logic from session-agent.ts into plain async service functions, delete legacy GitHub handlers, and clean up folder structure.

**Architecture:** Each domain gets a service file in `services/` with plain async functions taking explicit dependencies (`appDb`, `env`). The DO's runner handler map becomes thin wrappers that call service functions and send results back via `runnerLink`. GitHub-specific code is deleted entirely — the agent uses `call_tool` → `plugin-github` for all GitHub operations.

**Tech Stack:** TypeScript, Cloudflare Workers, Drizzle ORM, Hono

**Spec:** `docs/specs/2026-03-22-session-agent-service-extraction-design.md`

---

## Chunk 1: Utilities & Simple Services

### Task 1: Extract pure utility functions to `lib/utils/`

**Files:**
- Create: `packages/worker/src/lib/utils/prompt-validation.ts`
- Create: `packages/worker/src/lib/utils/runtime.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:51-219`

- [ ] **Step 1: Create `lib/utils/prompt-validation.ts`**

Move these pure functions from the top of session-agent.ts (lines 51-122):
- `parseBase64DataUrl()` (lines 51-56)
- `sanitizePromptAttachments()` (lines 58-88) — also move the constants it depends on: `MAX_PROMPT_ATTACHMENTS`, `MAX_PROMPT_ATTACHMENT_URL_LENGTH`, `MAX_TOTAL_ATTACHMENT_BYTES` (lines 43-46)
- `attachmentPartsForMessage()` (lines 90-113)
- `parseQueuedPromptAttachments()` (lines 115-122)

Copy the functions, their constants, and their type imports. Export all functions and constants. Remove them from session-agent.ts and add an import.

- [ ] **Step 2: Create `lib/utils/runtime.ts`**

Move these pure functions from session-agent.ts (lines 124-219):
- `parseQueuedWorkflowPayload()` (lines 124-136)
- `deriveRuntimeStates()` (lines 163-219) — also move the type aliases it depends on: `SandboxRuntimeState`, `AgentRuntimeState`, `JointRuntimeState` (lines 159-161)

Copy the functions, their type aliases, and their type imports. Export all functions and types. Remove them from session-agent.ts and add an import.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: No new errors (only the pre-existing ones, if any)

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/lib/utils/ packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract pure utility functions to lib/utils"
```

---

### Task 2: Extract memory service

**Files:**
- Create: `packages/worker/src/services/session-memory.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:3294-3363`

- [ ] **Step 1: Create `services/session-memory.ts`**

Extract the following handlers (lines 3294-3363) as plain async functions:
- `memRead(db, envDB, userId, path?)` — from `handleMemRead()`
- `memWrite(db, envDB, userId, path, content)` — from `handleMemWrite()`
- `memPatch(db, envDB, userId, path, operations)` — from `handleMemPatch()`
- `memRm(db, envDB, userId, path)` — from `handleMemRm()`
- `memSearch(db, envDB, userId, query, path?, limit?)` — from `handleMemSearch()`

Each function takes explicit dependencies and returns a typed result object. Import the existing memory DB helpers (`listMemoryFiles`, `readMemoryFile`, etc.).

**DB handle note:** `memRead` uses `appDb` (Drizzle) for `listMemoryFiles`/`readMemoryFile`/`boostMemoryFileRelevance`. The write/patch/rm/search functions use `env.DB` (raw D1 binding). Each function signature should only take the handles it actually needs.

- [ ] **Step 2: Update session-agent.ts runner handlers**

Replace the handler bodies in `buildRunnerHandlers()` at lines 2685-2703 with calls to the service functions. Each handler becomes:
```typescript
'mem-read': async (msg) => {
  const result = await memRead(this.appDb, this.env.DB, userId, msg.path);
  this.runnerLink.send({ type: 'mem-read-result', requestId: msg.requestId!, ...result });
},
```

Remove the private `handleMem*` methods from the DO class.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-memory.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract memory handlers to services/session-memory"
```

---

### Task 3: Extract mailbox service

**Files:**
- Create: `packages/worker/src/services/session-mailbox.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:7528-7585`

- [ ] **Step 1: Create `services/session-mailbox.ts`**

Extract handlers (lines 7528-7585) as plain async functions:
- `mailboxSend(db, envDB, sessionId, userId, msg)` — from `handleMailboxSend()`
- `mailboxCheck(db, envDB, sessionId, userId, limit?, after?)` — from `handleMailboxCheck()`

- [ ] **Step 2: Update session-agent.ts runner handlers**

Replace handler bodies in `buildRunnerHandlers()` at lines 2817-2823 with service calls. Remove private `handleMailbox*` methods.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-mailbox.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract mailbox handlers to services/session-mailbox"
```

---

### Task 4: Extract task board service

**Files:**
- Create: `packages/worker/src/services/session-tasks.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:7587-7673`

- [ ] **Step 1: Create `services/session-tasks.ts`**

Extract handlers (lines 7587-7673) as plain async functions:
- `taskCreate(db, envDB, sessionId, userId, params)` — from `handleTaskCreate()`
- `taskList(db, envDB, sessionId, status?, limit?)` — from `handleTaskList()`
- `taskUpdate(db, envDB, sessionId, taskId, params)` — from `handleTaskUpdate()`
- `taskMy(db, envDB, userId, status?)` — from `handleTaskMy()`

- [ ] **Step 2: Update session-agent.ts runner handlers**

Replace handler bodies in `buildRunnerHandlers()` at lines 2825-2839 with service calls. Remove private `handleTask*` methods.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-tasks.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract task board handlers to services/session-tasks"
```

---

### Task 5: Extract identity service

**Files:**
- Create: `packages/worker/src/services/session-identity.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:4638-4702`

- [ ] **Step 1: Create `services/session-identity.ts`**

Extract handler (lines 4638-4702) as plain async functions:
- `identityGet(db, userId)` — get orchestrator identity
- `identityUpdate(db, userId, payload)` — update identity fields
- `identitySync(db, userId, payload)` — sync identity from config

- [ ] **Step 2: Update session-agent.ts runner handler**

Replace handler body in `buildRunnerHandlers()` at line 2804-2806 with service call. Remove private `handleIdentityApi` method.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-identity.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract identity handler to services/session-identity"
```

---

## Chunk 2: Medium Services

### Task 6: Extract skills service

**Files:**
- Create: `packages/worker/src/services/session-skills.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:4292-4422`

- [ ] **Step 1: Create `services/session-skills.ts`**

Extract handler (lines 4292-4422) as plain async functions. The `handleSkillApi` dispatches on `action` (search/list/get/create/update/delete). Each action becomes a function:
- `skillSearch(db, envDB, query)` — FTS search
- `skillList(db, userId)` — list user + org skills
- `skillGet(db, skillId)` — get by ID
- `skillCreate(db, userId, params)` — create skill
- `skillUpdate(db, userId, skillId, params)` — update skill
- `skillDelete(db, userId, skillId)` — delete skill

Export a top-level `handleSkillAction(db, envDB, userId, action, payload)` dispatcher.

- [ ] **Step 2: Update session-agent.ts**

Replace handler body at line 2796-2798 with service call. Remove private `handleSkillApi` method.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-skills.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract skill handlers to services/session-skills"
```

---

### Task 7: Extract personas service

**Files:**
- Create: `packages/worker/src/services/session-personas.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:4424-4634,5396-5405`

- [ ] **Step 1: Create `services/session-personas.ts`**

Extract handlers (lines 4424-4634, 5396-5405) as plain async functions. The `handlePersonaApi` dispatches on `action`. Each action becomes a function:
- `personaGet(db, personaId)` — get by ID
- `personaCreate(db, userId, params)` — create persona
- `personaUpdate(db, userId, personaId, params)` — update persona
- `personaDelete(db, userId, personaId)` — delete persona
- `personaListSkills(db, personaId)` — list attached skills
- `personaAttachSkill(db, personaId, skillId)` — attach skill
- `personaDetachSkill(db, personaId, skillId)` — detach skill
- `listPersonas(db, userId)` — from `handleListPersonas()`

Export a top-level `handlePersonaAction(db, userId, isOrchestrator, action, payload)` dispatcher.

- [ ] **Step 2: Update session-agent.ts**

Replace handler bodies at lines 2800-2802 (persona-api) and 2728-2730 (list-personas) with service calls. Remove private `handlePersonaApi` and `handleListPersonas` methods.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-personas.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract persona handlers to services/session-personas"
```

---

### Task 8: Extract cross-session service

**Files:**
- Create: `packages/worker/src/services/session-cross.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:2903-3282,5407-5447,5549-5660`

- [ ] **Step 1: Create `services/session-cross.ts`**

Extract handlers as plain async functions. These take `env.SESSIONS` (DO binding) as an explicit parameter:
- `spawnChild(appDb, env, sessionState, params)` — from `handleSpawnChild()` (lines 2903-3075)
- `sendSessionMessage(env, targetSessionId, content, interrupt?)` — from `handleSessionMessage()` (lines 3077-3113)
- `getSessionMessages(env, targetSessionId, limit?, after?)` — from `handleSessionMessages()` (lines 3115-3146)
- `forwardMessages(env, targetSessionId, limit?, after?)` — from `handleForwardMessages()` (lines 3148-3219). Returns fetched messages; the DO handles writing them to its own `messageStore` and broadcasting to clients (those parts stay in the DO handler wrapper).
- `terminateChild(appDb, env, childSessionId)` — from `handleTerminateChild()` (lines 3242-3282)
- `listChildSessions(appDb, sessionId)` — from `handleListChildSessions()` (lines 5438-5447)
- `getSessionStatus(appDb, env, targetSessionId)` — from `handleGetSessionStatus()` (lines 5549-5660)
- `listChannels(appDb, sessionId, userId)` — from `handleListChannels()` (lines 5407-5436)

Also move `fetchMessagesFromDO()` (lines 3222-3240) as a private helper.

**Note:** `handleSpawnChild()` is the most complex — it accesses sessionState for git state, credentials, spawn request. Pass the needed values as explicit params rather than the whole sessionState object.

- [ ] **Step 2: Update session-agent.ts runner handlers**

Replace handler bodies at lines 2561-2577 (spawn-child), 2578-2584 (session-message/messages), 2586-2588 (terminate-child), 2732-2734 (list-channels), 2740-2742 (list-child-sessions), 2736-2738 (get-session-status), 2754-2756 (forward-messages) with service calls.

Remove private methods: `handleSpawnChild`, `handleSessionMessage`, `handleSessionMessages`, `handleForwardMessages`, `fetchMessagesFromDO`, `handleTerminateChild`, `handleListChildSessions`, `handleGetSessionStatus`, `handleListChannels`.

**Note:** `handleSelfTerminate` stays in the DO — it calls `this.handleStop('completed')` which is core DO lifecycle logic, not a cross-session concern.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-cross.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract cross-session handlers to services/session-cross"
```

---

## Chunk 3: Large Services

### Task 9: Extract tools service

**Files:**
- Create: `packages/worker/src/services/session-tools.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:7822-8409,8741-8787`

- [ ] **Step 1: Create `services/session-tools.ts`**

Extract the tool listing and action execution logic as service functions:
- `listTools(appDb, envDB, userId, sessionState, opts?)` — from `handleListTools()` (lines 7822-8043). Handles integration enumeration, credential resolution, MCP listActions, risk level caching, policy/disabled filtering.
- `resolveAndExecuteAction(appDb, envDB, userId, toolId, params, sessionState)` — from the execution path within `handleCallTool()`. Resolves the action, calls `actionSource.callAction()`, returns the result.
- `resolveActionPolicy(appDb, toolId, riskLevel)` — from the policy check within `handleCallTool()`. Returns `'deny' | 'pending_approval' | 'allowed'`.

Also move helper functions:
- `serializeZodSchema()` (lines 8741-8769)
- `zodTypeToString()` (lines 8772-8787)

**Split boundary:** The service handles tool listing, policy resolution, and action execution. The DO retains the `handleCallTool()` orchestration wrapper that:
1. Calls `resolveActionPolicy()` from the service
2. If `pending_approval`: creates `interactive_prompts` entry in `ctx.storage.sql`, broadcasts to clients, notifies EventBus (this stays in DO)
3. If `allowed`: calls `resolveAndExecuteAction()` from the service
4. Sends result to runner

- [ ] **Step 2: Update session-agent.ts**

Replace handler bodies at lines 2851-2857 with service calls. The `handleCallTool()` method stays but becomes a thin orchestrator calling service functions. Remove `handleListTools()`, `executeAction()`, `serializeZodSchema()`, `zodTypeToString()` private methods.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-tools.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract tool discovery and execution to services/session-tools"
```

---

### Task 10: Extract workflows service

**Files:**
- Create: `packages/worker/src/services/session-workflows.ts`
- Modify: `packages/worker/src/durable-objects/session-agent.ts:3407-3871,4704-5027,6170-6429`

- [ ] **Step 1: Create `services/session-workflows.ts`**

This is the largest extraction (~1600 lines). Extract as plain async functions:

**Workflow CRUD:**
- `workflowList(db, userId)` — from `handleWorkflowList()` (lines 3407-3436)
- `workflowSync(db, envDB, userId, params)` — from `handleWorkflowSync()` (lines 3438-3501)
- `workflowRun(db, envDB, userId, params)` — from `handleWorkflowRun()` (lines 3527-3647)
- `workflowExecutions(db, userId, workflowId?, limit?)` — from `handleWorkflowExecutions()` (lines 3649-3698)
- `handleWorkflowAction(db, envDB, userId, action, payload)` — dispatcher for `handleWorkflowApi()` (lines 3735-3862)

**Trigger CRUD:**
- `handleTriggerAction(db, envDB, env, userId, action, payload)` — dispatcher for `handleTriggerApi()` (lines 3873-4290)

**Execution API:**
- `handleExecutionAction(db, userId, action, payload)` — dispatcher for `handleExecutionApi()` (lines 4704-4920)

**Workflow execution result processing:**
- `processWorkflowExecutionResult(db, envDB, msg)` — from `handleWorkflowExecutionResult()` (lines 4922-5027)

**Workflow dispatch:**
- `buildWorkflowDispatch(db, envDB, userId, sessionId, params)` — from `handleWorkflowExecuteDispatch()` (lines 6170-6429). Returns the dispatch payload; the DO handles the actual `sendToRunner()` call.

**Helpers that move with it:**
- `deriveRepoFullName()` (lines 3503-3512)
- `deriveWorkerOriginFromSpawnRequest()` (lines 3514-3525)
- `parseJsonOrNull()` (lines 3700-3707)
- `normalizeWorkflowRow()` (lines 3709-3726)
- `resolveWorkflowIdForUser()` (lines 3728-3733)
- `scheduleTargetFromConfig()` (lines 3864-3867)
- `requiresWorkflowForTriggerConfig()` (lines 3869-3871)

- [ ] **Step 2: Update session-agent.ts runner handlers**

Replace handler bodies at lines 2758-2810 (workflow-list, workflow-sync, workflow-run, workflow-executions, workflow-api, trigger-api, execution-api, workflow-execution-result) with service calls.

Remove private methods: `handleWorkflowList`, `handleWorkflowSync`, `handleWorkflowRun`, `handleWorkflowExecutions`, `handleWorkflowApi`, `handleTriggerApi`, `handleExecutionApi`, `handleWorkflowExecutionResult`, and their helpers (`deriveRepoFullName`, `deriveWorkerOriginFromSpawnRequest`, `parseJsonOrNull`, `normalizeWorkflowRow`, `resolveWorkflowIdForUser`, `scheduleTargetFromConfig`, `requiresWorkflowForTriggerConfig`).

`handleWorkflowExecuteDispatch` stays in the DO as a thin wrapper — it calls `buildWorkflowDispatch()` from the service, then calls `this.sendToRunner()` with the result. The `sendToRunner` call cannot be in the service.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/services/session-workflows.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: extract workflow/trigger/execution handlers to services/session-workflows"
```

---

## Chunk 4: GitHub Deletion

### Task 11: Delete GitHub runner message handlers from session-agent

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts`

- [ ] **Step 1: Delete runner handler map entries**

Remove these entries from `buildRunnerHandlers()`:
- `'create-pr'` handler (lines 2349-2358)
- `'update-pr'` handler (lines 2360-2370)
- `'list-repos'` handler (lines 2705-2707)
- `'list-pull-requests'` handler (lines 2709-2716)
- `'inspect-pull-request'` handler (lines 2718-2726)
- `'read-repo-file'` handler (lines 2744-2752)
- `'pr-created'` broadcast handler (lines 2488-2510) — **Keep this handler.** It is a passive listener that updates session git state in D1 and broadcasts to clients. It does not depend on any GitHub-specific helper code and provides forward compatibility for the future action effect system.

- [ ] **Step 2: Delete private handler methods**

Remove these methods from the DO class:
- `handleCreatePR()` (lines 6648-6777)
- `handleUpdatePR()` (lines 6781-6890)
- `handleListPullRequests()` (lines 5029-5101)
- `handleInspectPullRequest()` (lines 5102-5394)
- `handleReadRepoFile()` (lines 5449-5547)
- `handleListRepos()` (lines 3364-3406) — **Note:** this handler has two code paths. The `source === 'github'` path calls `getGitHubToken()` and the GitHub API (delete this). The `else` path calls `listOrgRepositories(this.env.DB)` which is non-GitHub (keep this). Rewrite the `'list-repos'` runner handler entry to only call `listOrgRepositories()` directly. The GitHub repos path is subsumed by `call_tool service=github`.

- [ ] **Step 3: Delete GitHub helper methods**

Remove these methods from the DO class:
- `getGitHubToken()` (lines 6530-6553)
- `resolveGitHubTokenForUser()` (lines 6560-6614)
- `extractOwnerRepo()` (lines 6620-6624)
- `resolveOwnerRepo()` (lines 6626-6644)

- [ ] **Step 4: Clean up unused imports**

Remove any imports that are now unused after the GitHub code deletion (GitHub-related type imports, etc.).

- [ ] **Step 5: Run typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean (may surface unused variables that were only referenced by deleted code)

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: delete GitHub-specific handlers from session-agent DO"
```

---

### Task 12: Delete GitHub runner gateway and agent-client code

**Files:**
- Modify: `packages/runner/src/gateway.ts:542-584,635-651,904-1016,1123-1135,1377-1398`
- Modify: `packages/runner/src/agent-client.ts:254-266,457-476,513-518`
- Modify: `packages/runner/src/bin.ts:177-188,207-209,225-227`

- [ ] **Step 1: Delete runner gateway types and routes**

In `packages/runner/src/gateway.ts`:
- Delete type definitions: `CreatePullRequestParams`, `CreatePullRequestResult`, `UpdatePullRequestParams`, `UpdatePullRequestResult`, `ListPullRequestsParams`, `InspectPullRequestParams` (lines 542-584)
- Delete callback signatures from `GatewayCallbacks`: `onCreatePullRequest`, `onUpdatePullRequest`, `onListPullRequests`, `onInspectPullRequest`, `onListRepos`, `onReadRepoFile` (lines 635-651)
- Delete route handlers: POST `/api/create-pull-request`, POST `/api/update-pull-request`, GET `/api/pull-requests`, GET `/api/pull-request`, GET `/api/org-repos`, POST `/api/read-repo-file` (lines 904-1016, 1123-1135, 1377-1398)

- [ ] **Step 2: Delete runner agent-client methods**

In `packages/runner/src/agent-client.ts`:
- Delete `requestCreatePullRequest()` (lines 254-259)
- Delete `requestUpdatePullRequest()` (lines 261-266)
- Delete `requestListRepos()` (lines 457-462)
- Delete `requestListPullRequests()` (lines 464-469)
- Delete `requestInspectPullRequest()` (lines 471-476)
- Delete `requestReadRepoFile()` (lines 513-518)

- [ ] **Step 3: Delete runner bin.ts callback wiring**

In `packages/runner/src/bin.ts`:
- Delete `onCreatePullRequest` callback (lines 177-179)
- Delete `onUpdatePullRequest` callback (lines 180-182)
- Delete `onListPullRequests` callback (lines 183-185)
- Delete `onInspectPullRequest` callback (lines 186-188)
- Delete `onListRepos` callback (lines 207-209)
- Delete `onReadRepoFile` callback (lines 225-227)

- [ ] **Step 4: Run typecheck for runner**

Run: `cd packages/runner && pnpm typecheck`
Expected: Clean (may have pre-existing errors unrelated to this change)

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/gateway.ts packages/runner/src/agent-client.ts packages/runner/src/bin.ts
git commit -m "refactor: delete GitHub-specific gateway, agent-client, and bin code from runner"
```

---

### Task 13: Delete OpenCode GitHub tool and update instructions

**Files:**
- Delete: `docker/opencode/tools/create_pull_request.ts`
- Modify: `docker/opencode/opencode.json:26`

- [ ] **Step 1: Delete the OpenCode tool**

```bash
rm docker/opencode/tools/create_pull_request.ts
```

- [ ] **Step 2: Update OpenCode instructions**

In `docker/opencode/opencode.json`, replace the GitHub-specific instructions (line 26) that reference `create_pull_request`:

Replace:
```
"For GitHub operations, use platform tools and integration actions instead of `gh` CLI:",
"- Use `create_pull_request` instead of `gh pr create` — this tracks the PR in the session UI.",
"- Use `report_git_state` after checking out branches or making commits to keep the session UI up to date.",
"- For listing PRs, inspecting PRs, updating PRs, reading repo files, and other GitHub API operations, use `list_tools service=github` to discover available actions and `call_tool` to invoke them.",
"- Continue using git CLI directly for `checkout`, `add`, `commit`, `push`, `pull`, and other local git operations.",
```

With:
```
"For GitHub operations, use integration actions instead of `gh` CLI:",
"- Use `list_tools service=github` to discover available GitHub actions (create PR, list PRs, inspect PRs, read files, etc.).",
"- Use `call_tool` to invoke any GitHub action.",
"- Use `report_git_state` after checking out branches or making commits to keep the session UI up to date.",
"- Continue using git CLI directly for `checkout`, `add`, `commit`, `push`, `pull`, and other local git operations.",
```

- [ ] **Step 3: Commit**

```bash
git add -u docker/opencode/tools/ docker/opencode/opencode.json
git commit -m "refactor: delete OpenCode create_pull_request tool, update instructions for plugin-github"
```

---

## Chunk 5: Final Verification

### Task 14: Full typecheck and verification

**Files:** None (verification only)

- [ ] **Step 1: Run full worker typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: Clean (no new errors)

- [ ] **Step 2: Run full runner typecheck**

Run: `cd packages/runner && pnpm typecheck`
Expected: Clean (no new errors)

- [ ] **Step 3: Run root-level typecheck**

Run: `pnpm typecheck`
Expected: Clean across all packages (catches cross-package import issues)

- [ ] **Step 4: Verify session-agent.ts line count**

Run: `wc -l packages/worker/src/durable-objects/session-agent.ts`
Expected: ~5000-5500 lines (down from 9105)

- [ ] **Step 5: Verify folder structure**

Run: `ls packages/worker/src/services/session-*.ts`
Expected: 9 new files:
- `session-cross.ts`
- `session-identity.ts`
- `session-mailbox.ts`
- `session-memory.ts`
- `session-personas.ts`
- `session-skills.ts`
- `session-tasks.ts`
- `session-tools.ts`
- `session-workflows.ts`

Run: `ls packages/worker/src/lib/utils/`
Expected: 2 new files:
- `prompt-validation.ts`
- `runtime.ts`

Run: `ls docker/opencode/tools/create_pull_request.ts 2>&1`
Expected: "No such file or directory"

- [ ] **Step 6: Verify no remaining GitHub handler references**

Run: `grep -n 'handleCreatePR\|handleUpdatePR\|handleListPullRequests\|handleInspectPullRequest\|handleReadRepoFile\|getGitHubToken\|resolveGitHubTokenForUser' packages/worker/src/durable-objects/session-agent.ts`
Expected: No matches
