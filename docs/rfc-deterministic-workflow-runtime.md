# RFC: Deterministic Workflow Runtime and Controlled Self-Modification

Date: 2026-02-07
Status: Draft
Owner: Agent-Ops

## 1. Summary

Agent-Ops currently stores workflow definitions and trigger metadata, but does not execute workflow steps end-to-end. This RFC proposes a deterministic workflow runtime in the existing sandboxed session environment, plus a controlled self-modification loop so agents can propose and evolve workflows safely.

Execution will run in a dedicated `workflow` session type. The platform Worker is a dispatcher/control plane, not the step execution runtime.

The design borrows execution semantics from OpenClaw Lobster (single-call pipeline execution, explicit approval gates, resumable tokens, structured envelopes) while keeping Agent-Ops runtime boundaries (Worker, Durable Objects, Runner, OpenCode). This RFC is inspiration-driven, not compatibility-driven.

## 2. Problem Statement

Today:

- Workflow runs are recorded but not executed (`pending` only).
- Trigger routes return queued placeholders, not step results.
- Schedule triggers are modeled but not dispatched.
- Approval status exists in schema but has no runtime state machine.
- Workflow editing is metadata-first; there is no deterministic execution contract.

Consequences:

- No replayable determinism.
- No true human-in-the-loop workflow pauses/resumes.
- No safe path for agent-authored workflow upgrades.

## 3. Goals

1. Deterministic execution model for workflow runs.
2. Explicit approval checkpoints with resumable state.
3. First-class schedule, webhook, and manual trigger dispatch.
4. Step-level auditability and replay diagnostics.
5. Controlled self-modification: propose, review, apply, rollback.
6. Full workflow tool capability inside the provided session sandbox/repo environment.

## 4. Non-Goals

1. Replacing OpenCode runtime.
2. Replacing Modal sandbox infrastructure.
3. Implementing OpenClaw Gateway or plugin framework wholesale.
4. Cross-org distributed workflow sharding in v1.

## 5. External Reference Model (OpenClaw / Lobster)

Lobster is a separate repository and runtime (`openclaw/lobster`). We use it as a design reference only.

OpenClaw Lobster establishes useful semantics:

- One workflow tool call orchestrates many steps.
- Output envelope status: `ok`, `needs_approval`, `cancelled`.
- Approval pauses return a `resumeToken`; continuation uses explicit approve/deny.
- Runtime-level safety constraints (timeouts, stdout caps, path checks).
- Pipelines as data for audit/replay/diff.

This RFC adopts selected semantics, but does not target Lobster compatibility or direct runtime embedding. In Agent-Ops, all workflow execution happens inside sandboxed session environments with native Worker/DO/Runner orchestration.

## 6. Proposed Architecture

### 6.1 Components

1. Worker Trigger Dispatcher
- Converts manual/webhook/schedule trigger events into workflow execution jobs.
- Persists immutable run input snapshot before execution starts.
- Does not execute workflow steps directly.

2. Workflow Session Type (new session purpose)
- New session purpose: `workflow` (alongside interactive and orchestrator sessions).
- Headless by default: no share links, no end-user tunnels/panels, and hidden from normal session lists.
- Pinned workspace/repo context for deterministic execution of a single execution or execution queue policy.

3. Workflow Executor DO (new)
- Deterministic, single-writer state machine per execution.
- Owns step progression, approval pause/resume, retries, terminal states.
- Binds each execution to a `workflow` session and coordinates resume/retry.

4. Runner Workflow CLI + Engine (new)
- A native `workflow` CLI runs inside each sandbox session.
- CLI commands (`run`, `resume`, `validate`, `propose`) call the engine.
- Engine executes normalized step plans with full sandbox tool access and emits structured runtime events.

5. Existing SessionAgent DO Integration
- Routes execution commands and progress events between Worker and Runner.
- Enforces workflow-session-only execution paths.

### 6.2 Execution Contract

All runs use a Lobster-like envelope:

```json
{
  "ok": true,
  "status": "ok | needs_approval | cancelled | failed",
  "executionId": "uuid",
  "output": {},
  "requiresApproval": {
    "stepId": "approve_deploy",
    "prompt": "Deploy to production?",
    "items": [],
    "resumeToken": "wrf_rt_..."
  },
  "error": null
}
```

### 6.3 Native `workflow` CLI Contract

The runner exposes one executable in the sandbox: `workflow`.

Command shape:

```bash
workflow <command> [flags]
```

Supported commands:

1. `run`
2. `resume`
3. `validate`
4. `propose`

Transport:

1. Request payload is passed as JSON via stdin.
2. Final result envelope is written to stdout as JSON.
3. Progress events are written as NDJSON lines to stderr.

### 6.4 CLI Commands and Flags

1. `workflow run`
- Purpose: execute a workflow from the first runnable step.
- Required flags:
  - `--execution-id <id>`
  - `--workflow-hash <sha256>`
  - `--workspace <path>`
- Optional flags:
  - `--timeout-ms <n>`
  - `--max-steps <n>`
  - `--max-parallel <n>`

2. `workflow resume`
- Purpose: continue a paused execution at an approval boundary.
- Required flags:
  - `--execution-id <id>`
  - `--resume-token <token>`
- Optional flags:
  - `--decision approve|deny` (default `approve`)

3. `workflow validate`
- Purpose: static schema + compile validation without execution.
- Required flags:
  - `--workflow-path <path>` or `--workflow-json -` (stdin)

4. `workflow propose`
- Purpose: generate a self-modification proposal from current workflow + intent.
- Required flags:
  - `--workflow-id <id>`
  - `--base-hash <sha256>`
  - `--intent <text>`

### 6.5 Request/Response Schemas

`run` stdin payload:

```json
{
  "workflow": {},
  "trigger": { "type": "manual|webhook|schedule", "metadata": {} },
  "variables": {},
  "runtime": {
    "attempt": 1,
    "idempotencyKey": "wkf_...",
    "policy": {
      "timeoutMs": 120000,
      "maxSteps": 50,
      "maxParallel": 4,
      "maxOutputBytes": 262144
    }
  }
}
```

`run`/`resume` stdout envelope:

```json
{
  "ok": true,
  "status": "ok | needs_approval | cancelled | failed",
  "executionId": "uuid",
  "output": {},
  "steps": [
    {
      "stepId": "lint",
      "status": "completed",
      "attempt": 1,
      "startedAt": "2026-02-07T12:00:00.000Z",
      "completedAt": "2026-02-07T12:00:03.000Z",
      "output": {}
    }
  ],
  "requiresApproval": {
    "stepId": "approve_release",
    "prompt": "Ship release v1.2.3?",
    "items": [],
    "resumeToken": "wrf_rt_..."
  },
  "error": null
}
```

`validate` stdout envelope:

```json
{
  "ok": true,
  "status": "valid | invalid",
  "workflowHash": "sha256:...",
  "errors": []
}
```

`propose` stdout envelope:

```json
{
  "ok": true,
  "status": "proposal_created | proposal_failed",
  "proposal": {
    "baseHash": "sha256:...",
    "proposedWorkflow": {},
    "summary": "Add an approval gate before deploy",
    "riskLevel": "low | medium | high",
    "diff": "--- old\n+++ new\n..."
  },
  "error": null
}
```

### 6.6 Progress Event Stream (stderr NDJSON)

Each stderr line is a JSON object:

```json
{"type":"execution.started","executionId":"...","ts":"..."}
{"type":"step.started","executionId":"...","stepId":"lint","attempt":1,"ts":"..."}
{"type":"step.completed","executionId":"...","stepId":"lint","attempt":1,"ts":"..."}
{"type":"approval.required","executionId":"...","stepId":"approve_release","resumeToken":"...","ts":"..."}
{"type":"execution.finished","executionId":"...","status":"needs_approval","ts":"..."}
```

SessionAgent forwards these events to Worker for durable persistence and UI streaming.

### 6.7 Exit Codes

1. `0`: successful command invocation (including `needs_approval` and `cancelled` terminal envelopes)
2. `10`: validation failure
3. `20`: deterministic contract violation (missing hash/input mismatch/resume mismatch)
4. `30`: policy violation (timeout, max steps, blocked tool class)
5. `40`: internal engine error

Non-zero exit does not bypass persistence; Worker/DO still records terminal failure state using captured stderr/stdout context.

### 6.8 End-to-End Examples

Example: initial run

```bash
cat run-input.json | workflow run \
  --execution-id ex_123 \
  --workflow-hash sha256:abc \
  --workspace /workspace
```

If approval is required, stdout returns `status=needs_approval` plus `resumeToken`.

Example: approval resume

```bash
workflow resume \
  --execution-id ex_123 \
  --resume-token wrf_rt_456 \
  --decision approve
```

Example: proposal generation

```bash
workflow propose \
  --workflow-id wf_release \
  --base-hash sha256:abc \
  --intent "require approval before production deploy"
```

## 7. Data Model Changes

Add migration `0022_workflow_runtime.sql`:

1. `workflow_executions` additions
- `workflow_version TEXT`
- `workflow_hash TEXT` (sha256 of normalized definition)
- `idempotency_key TEXT`
- `runtime_state TEXT` (serialized deterministic context)
- `resume_token TEXT`
- `attempt_count INTEGER DEFAULT 0`
- `session_id TEXT` (bound workflow session id)

2. New `workflow_execution_steps`
- `id TEXT PRIMARY KEY`
- `execution_id TEXT NOT NULL`
- `step_id TEXT NOT NULL`
- `attempt INTEGER NOT NULL`
- `status TEXT NOT NULL` (`pending|running|waiting_approval|completed|failed|cancelled|skipped`)
- `input_json TEXT`
- `output_json TEXT`
- `error TEXT`
- `started_at TEXT`
- `completed_at TEXT`
- unique `(execution_id, step_id, attempt)`

3. New `workflow_mutation_proposals`
- `id TEXT PRIMARY KEY`
- `workflow_id TEXT NOT NULL`
- `execution_id TEXT`
- `proposed_by_session_id TEXT`
- `base_workflow_hash TEXT NOT NULL`
- `proposal_json TEXT NOT NULL`
- `diff_text TEXT`
- `status TEXT NOT NULL` (`pending|approved|rejected|applied|failed`)
- `review_notes TEXT`
- timestamps

4. New `workflow_schedule_ticks`
- `trigger_id TEXT`
- `tick_bucket TEXT` (UTC minute bucket)
- unique `(trigger_id, tick_bucket)` for dedup/idempotency.

5. Session model extension
- Add session purpose field to `sessions` (example: `purpose TEXT NOT NULL DEFAULT 'interactive'` with allowed values `interactive|orchestrator|workflow`).
- Add index on `(purpose, user_id, status)`.

## 8. API Changes

### 8.1 Existing endpoint behavior updates

1. `POST /api/triggers/manual/run`
- Start actual execution, not placeholder queue message.
- Returns envelope with `status`.
- Creates a dedicated per-execution `workflow` session (no session reuse in v1).

2. `POST /api/triggers/:id/run`
- Same behavior and envelope semantics.
- Creates a dedicated per-execution `workflow` session (no session reuse in v1).

3. `POST /webhooks/*`
- Enqueue deterministic execution immediately, with idempotency key from delivery id/signature hash.
- Creates and binds a dedicated per-execution owner-scoped `workflow` session.

### 8.2 New endpoints

1. `POST /api/executions/:id/approve`
```json
{ "approve": true, "resumeToken": "wrf_rt_..." }
```

2. `POST /api/executions/:id/cancel`
```json
{ "reason": "user_denied" }
```

3. `GET /api/executions/:id/steps`
- Step-level trace for debugging and replay.

4. `POST /api/workflows/:id/proposals/:proposalId/apply`
- Applies approved self-modification proposal.

### 8.3 Internal Worker <-> SessionAgent <-> Runner Messages

Worker to SessionAgent:

```json
{
  "type": "workflow.execute",
  "executionId": "ex_123",
  "workflowId": "wf_release",
  "sessionId": "sess_workflow_123",
  "workflowHash": "sha256:abc",
  "payload": {}
}
```

SessionAgent to Runner:

1. Spawns CLI command with the execution payload on stdin.
2. Streams stderr NDJSON events back to Worker as `workflow.progress`.
3. Sends stdout final envelope as `workflow.result`.

Runner to SessionAgent (final):

```json
{
  "type": "workflow.result",
  "executionId": "ex_123",
  "result": {}
}
```

SessionAgent to Worker (progress):

```json
{
  "type": "workflow.progress",
  "executionId": "ex_123",
  "event": { "type": "step.started", "stepId": "lint", "attempt": 1, "ts": "..." }
}
```

## 9. Determinism Rules

A run is deterministic if:

1. Normalized workflow definition hash is pinned at run start.
2. Trigger payload snapshot is immutable.
3. Variable resolution is explicit and recorded per step.
4. Step ordering is fixed by compiled plan graph.
5. Approval decisions are explicit events (`approve`/`deny`) with actor/time.
6. Retries increment attempt index and persist full input/output/error each attempt.

### 9.1 Step type support (v1)

Supported now:

1. `tool`
2. `agent`
3. `approval`
4. `conditional`
5. `parallel` (fan-out/fan-in with deterministic join ordering by step id)

Deferred:

1. `loop`
2. `subworkflow`

## 10. Scheduling Model

Current cron handler is integration-sync only. Extend it with workflow schedule dispatch:

1. Parse trigger cron expressions.
2. For each due trigger, write `workflow_schedule_ticks` row (dedupe).
3. Create execution for new ticks only.
4. Submit execution to Workflow Executor DO.

This makes schedule triggers exact and idempotent.

## 11. Controlled Self-Modification

Self-modification is opt-in per workflow via `data.constraints.allowSelfModification`.

### 11.1 Proposal flow

1. Agent run generates proposal (new workflow JSON + rationale + diff).
2. Proposal stored in `workflow_mutation_proposals` as `pending`.
3. Human review in UI (diff + risk checks).
4. Approve -> apply via transaction:
   - verify `base_workflow_hash` still current
   - write new workflow `data`
   - bump `version`
   - record audit trail
5. Rejection leaves workflow unchanged.

### 11.2 Safety checks before apply

1. Schema validation.
2. Constraint validation (timeouts, max steps/tool calls).
3. Forbidden capability checks (for example, deny adding disallowed tool families).
4. Optional dry-run compile.

### 11.3 Rollback

Keep previous normalized definitions as immutable history entries and support one-click rollback to prior version hash.

## 12. Security and Access

Decision: workflow execution has full access to tools available in the session sandbox/repo environment.

Guardrails remain runtime-level:

1. Per-step timeout.
2. Max stdout/output bytes.
3. Max steps and max parallel branches.
4. Explicit approval required for side-effect classes (configurable policy map).
5. Full execution and mutation audit logs.

### 12.1 Locked Implementation Defaults

1. Workflow session reuse policy
- v1 uses one dedicated `workflow` session per execution (no reuse/pooling).
- Rationale: eliminates cross-run workspace state leakage and simplifies determinism.

2. Repo context resolution policy
- Context priority order: trigger-derived context -> workflow defaults -> request overrides (manual-only).
- Every run pins `source_repo_full_name`, `ref`, and resolved `commit_sha` before step 1.
- Schedule runs fail fast if repo/ref cannot be resolved.

3. Execution identity and credentials
- Manual runs execute as requesting user identity.
- Webhook and schedule runs execute as workflow owner identity.
- Persist `initiator_type` (`manual|webhook|schedule`) and `initiator_user_id` on execution.

4. Idempotency contract
- Add unique key `(workflow_id, idempotency_key)` on executions.
- Manual: key = `manual:{workflowId}:{userId}:{clientRequestId}` (clientRequestId required on API call).
- Webhook: key = `webhook:{triggerId}:{deliveryId}` (fallback: sha256(signature+rawBody)).
- Schedule: key = `schedule:{triggerId}:{tick_bucket}`.
- Duplicate keys return existing execution record instead of creating a new one.

5. Concurrency limits
- Per execution session: one active execution (inherent).
- Per user: max 5 concurrent workflow executions.
- Per org: max 50 concurrent workflow executions.
- Excess work queues FIFO at dispatcher level.

6. Retry policy
- Automatic retries only for retryable failures: transient network errors, 429, 5xx, sandbox startup failures, tool timeout.
- Max attempts: 3 total (initial + 2 retries).
- Backoff: 10s then 30s.
- Non-retryable: validation/policy failures, approval denial, deterministic contract mismatch.

7. Approval policy
- Approvers: execution owner and org admins.
- Default approval token TTL: 24h.
- Timeout default action: `deny` (execution ends `cancelled` with reason `approval_timeout`).
- Audit log must capture actor, decision, timestamp, optional reason.

8. Cancellation semantics
- Cancel sets execution state to `cancel_requested`, then SessionAgent sends SIGTERM to workflow CLI process.
- Grace period: 10s; then SIGKILL if still running.
- In-flight tool calls are best-effort aborted; execution terminates as `cancelled`.

9. Determinism boundary (v1)
- Deterministic guarantee scope: control-flow determinism, not byte-identical model/tool output determinism.
- Required snapshots per run: workflow hash, trigger payload, resolved variables, step inputs, step outputs, model settings, commit SHA.
- `agent` steps are forced to deterministic settings (`temperature=0`, fixed tool policy) in v1.

10. Self-mod governance defaults
- Proposal creation allowed only if `allowSelfModification=true` on workflow constraints.
- Proposal apply allowed for workflow owner or org admin only.
- Required apply checks: schema validation, compile validation, policy checks, base hash match, dry-run compile.
- Proposal TTL: 14 days; expired proposals cannot be applied.

11. Data retention and cleanup
- `workflow_executions`: 180 days.
- `workflow_execution_steps`: 30 days.
- `workflow_mutation_proposals` and workflow version history: 365 days.
- Daily cleanup job removes expired rows by retention policy.

12. Rollout and fallback
- Feature flag: `workflow_runtime_v1` (org-scoped, default off).
- Rollout phases: internal org -> canary orgs -> general availability.
- If runtime is disabled, run endpoints return `409 WORKFLOW_RUNTIME_DISABLED`.
- If runtime fails mid-execution, mark execution `failed` with typed error and keep all partial traces.

## 13. Implementation Plan

### Phase 0: Runtime skeleton (1 PR)

1. Add migration for execution-step tables and runtime columns.
2. Add `WorkflowExecutorDO` stub and routing.
3. Update trigger endpoints to enqueue executor work.
4. Add Worker/SessionAgent event types: `workflow.execute`, `workflow.progress`, `workflow.result`.
5. Add session purpose support (`workflow`) to session create/read paths and access policies.

### Phase 1: Deterministic execution core (2-3 PRs)

1. Build workflow compiler (normalize JSON -> execution graph + hash).
2. Implement step runner for `tool|agent|approval|conditional`.
3. Add native sandbox `workflow` CLI (`run|resume|validate|propose`) and connect it to SessionAgent messaging.
4. Persist step traces and terminal envelope.
5. Add golden tests for deterministic replay (same workflow hash + same input => same step graph and step ordering).

### Phase 2: Approval + resume (1-2 PRs)

1. Resume token issuance/storage/expiry.
2. `/approve` and `/cancel` endpoints.
3. UI support for approval prompts and resume actions.

### Phase 3: Schedule dispatcher (1 PR)

1. Extend scheduled handler for workflow cron matching + dedupe.
2. Add observability counters/logging.

### Phase 4: Self-modification (2 PRs)

1. Proposal model + APIs + UI review surface.
2. Apply transaction + rollback history.

## 14. File-Level Change Map

Worker:

- `packages/worker/src/index.ts`
- `packages/worker/src/routes/triggers.ts`
- `packages/worker/src/routes/webhooks.ts`
- `packages/worker/src/routes/executions.ts`
- `packages/worker/src/routes/workflows.ts`
- `packages/worker/src/routes/sessions.ts`
- `packages/worker/src/durable-objects/workflow-executor.ts` (new)
- `packages/worker/migrations/0022_workflow_runtime.sql` (new)
- `packages/worker/src/lib/db.ts`

Runner:

- `packages/runner/src/workflow-cli.ts` (new)
- `packages/runner/src/workflow-engine.ts` (new)
- `packages/runner/src/workflow-compiler.ts` (new)
- `packages/runner/src/workflow-cli.test.ts` (new)
- `packages/runner/src/workflow-engine.test.ts` (new)
- `packages/runner/src/prompt.ts` (bridge events and command types)
- `packages/runner/src/types.ts` (execution envelopes and step schemas)

Client:

- `packages/client/src/api/executions.ts`
- `packages/client/src/api/workflows.ts`
- `packages/client/src/components/workflows/*`
- `packages/client/src/routes/workflows/$workflowId.tsx`
- `packages/client/src/routes/workflows/executions.tsx`

Shared:

- `packages/shared/src/types/index.ts` (session purpose/type additions)

## 15. Acceptance Criteria

1. Manual trigger run executes at least one step and reaches terminal status.
2. Approval step pauses with `needs_approval` and resumable token.
3. Denial path produces terminal `cancelled`.
4. Scheduled trigger fires once per due cron bucket (no duplicate runs).
5. Each run stores workflow hash + immutable input snapshot.
6. Self-mod proposal can be reviewed, approved, applied, and rolled back.
7. CLI contract tests verify command envelopes and exit codes for `run|resume|validate|propose`.
8. Every workflow execution is bound to a `workflow` session id.
9. `workflow` sessions are not shareable and are hidden from standard interactive session lists by default.

## 16. Risks

1. Determinism drift from non-deterministic tool outputs.
- Mitigation: snapshot all step inputs/outputs and enforce typed boundaries.

2. Approval deadlocks (abandoned tokens).
- Mitigation: token TTL + expiry transitions + default policy.

3. Schedule duplicate/skip on clock edges.
- Mitigation: tick-bucket dedupe + catch-up window.

4. Workflow mutation conflicts during concurrent edits.
- Mitigation: base hash precondition and transactional apply.

## 17. Deferred Decisions

1. Session pooling optimization for workflow sessions (post-v1; only after determinism SLOs are met).
2. Optional multi-approver policy for high-risk self-mod proposals.
3. Optional per-workflow custom retention windows beyond global defaults.

## 18. References

- OpenClaw Lobster tool docs: https://docs.openclaw.ai/tools/lobster
- Lobster OSS repository: https://github.com/openclaw/lobster
- OpenClaw Cron vs Heartbeat (Lobster pairing model): https://docs.openclaw.ai/automation/cron-vs-heartbeat
- OpenClaw Hooks overview: https://docs.openclaw.ai/hooks
- OpenClaw SOUL Evil Hook (in-memory bootstrap mutation model): https://docs.openclaw.ai/hooks/soul-evil
