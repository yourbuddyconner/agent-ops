---
name: workflows
description: End-to-end Agent-Ops workflow operations. Use when creating, updating, deleting, running, scheduling, debugging, rolling back, or self-modifying workflows; when managing workflow executions and approvals; when configuring trigger behavior; when passing repository context into workflow runs; and when using agent_message workflow steps.
---

# Workflows

## Use the workflow tools, not raw API calls

Use these tools for lifecycle operations:

- `list_workflows`, `get_workflow`, `sync_workflow`, `update_workflow`, `delete_workflow`
- `list_workflow_history`, `rollback_workflow`
- `list_workflow_proposals`, `create_workflow_proposal`, `review_workflow_proposal`, `apply_workflow_proposal`
- `run_workflow`, `list_workflow_executions`, `get_execution`, `get_execution_steps`, `debug_execution`, `approve_execution`, `cancel_execution`
- `list_triggers`, `sync_trigger`, `run_trigger`, `delete_trigger`

## Think in 4 layers

1. Workflow definition: versioned JSON with non-empty `steps`.
2. Trigger configuration: dispatch rules for `manual`, `webhook`, or `schedule`.
3. Execution record: immutable run state, status, step traces, and approval token lifecycle.
4. Workflow session: dedicated sandbox session (`purpose: workflow`) started/woken by the workflow executor.

## Choose the right lifecycle tool

- Use `sync_workflow` for create or full-definition upsert.
- Use `update_workflow` for partial metadata/definition patch (`name`, `description`, `slug`, `version`, `enabled`, `tags`, `data`).
- Use `delete_workflow` to remove workflows (and linked triggers).
- Use `list_workflow_history` before rollback or forensic comparison.
- Use `rollback_workflow` with a `target_workflow_hash` from history.

## Use proposal flow for self-modifying workflows

Follow this sequence:

1. Use `get_workflow` and compute/use current workflow hash as `base_workflow_hash`.
2. Use `create_workflow_proposal`.
3. Use `review_workflow_proposal` (`approve=true/false`).
4. Use `apply_workflow_proposal` after approval.

Notes:

- Proposal creation enforces base-hash matching.
- Workflow must allow self-modification (`constraints.allowSelfModification === true`).
- Use `list_workflow_proposals` to inspect status transitions (`pending`, `approved`, `rejected`, `applied`, `failed`).

## Run and operate executions

Run:

- Use `run_workflow` with `workflow_id`.
- Optionally pass `variables_json`.
- Optionally pass repo context: `repo_url`, `repo_branch`, `repo_ref`, `source_repo_full_name`.

Inspect:

- Use `list_workflow_executions` for recent runs.
- Use `get_execution` for authoritative status and current `resumeToken`.
- Use `get_execution_steps` for ordered normalized step traces.
- Use `debug_execution` first when a run stalls/fails.

Approval/cancel:

- Use `approve_execution` with the latest `resume_token` from `get_execution`.
- Use `cancel_execution` for stuck/inconsistent runs.

## Configure triggers and scheduling

Use `sync_trigger` for create/update:

- `type=manual`
- `type=webhook` requires `webhook_path` (optional method/secret)
- `type=schedule` requires `schedule_cron`

Schedule specifics:

- `schedule_cron` must be a 5-field cron expression.
- `schedule_timezone` uses IANA TZ names.
- `schedule_target=workflow` (default): dispatches workflow execution.
- `schedule_target=orchestrator`: dispatches `schedule_prompt` to orchestrator session.
- `schedule_prompt` is required when `schedule_target=orchestrator`.

Use `run_trigger` to test behavior immediately.

Use `delete_trigger` to remove stale triggers.

Variable mapping note:

- Keep `variable_mapping_json` paths simple (`$.field`), since extraction is shallow.

## Understand workflow execution context

Workflow runs do not execute in the orchestrator sandbox.

Execution context behavior:

1. A workflow session is created as a dedicated session (`purpose: workflow`) and initially hibernated.
2. `WorkflowExecutorDO` wakes/boots that workflow sandbox when enqueue/resume happens.
3. The executor dispatches a workflow-run prompt into that workflow session.

Repository context behavior:

- Repo context is stored in `session_git_state` for the workflow session.
- Executor injects `REPO_URL`, `REPO_BRANCH`, `REPO_REF` env vars into the sandbox.
- Sandbox startup clones `REPO_URL` into `/workspace/<repo>`, checks out branch/ref when provided, and sets working directory to the clone.

## Author workflow definitions with current runtime behavior

Minimum requirement:

- `workflow.steps` must be a non-empty array.

Common step types:

- `tool` (including `bash` via `tool: "bash"` and `arguments.command`)
- `approval`
- `conditional`
- `parallel`
- `agent`
- `agent_message`

`agent_message` step contract:

- Provide message via `content` (preferred), or `message`, or `goal`.
- Optional `interrupt` (boolean).
- Optional `await_response` (or `awaitResponse`) boolean.
- Optional `await_timeout_ms` (or `awaitTimeoutMs`) number, minimum 1000.

`agent_message` behavior:

- Non-await mode sends a message to the current workflow session agent.
- Await mode runs a temporary OpenCode session and returns response text in step output.

## Reliable operating playbook

1. Use `list_workflows` and `list_triggers` before creating/updating to avoid duplicates.
2. Use `get_workflow` before patching critical definitions.
3. Use `run_workflow` or `run_trigger` for tests.
4. Use `debug_execution` first for incidents.
5. Use fresh `resume_token` from `get_execution` before `approve_execution`.
6. Use `cancel_execution` when state is inconsistent, then rerun cleanly.
7. Use `list_workflow_history` and `rollback_workflow` for safe recovery.
