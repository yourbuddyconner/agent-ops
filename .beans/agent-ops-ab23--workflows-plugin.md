---
# agent-ops-ab23
title: Workflows Plugin
status: todo
type: epic
priority: high
tags:
    - worker
    - frontend
    - runner
    - sandbox
created_at: 2026-01-31T08:02:50Z
updated_at: 2026-01-31T08:04:38Z
parent: agent-ops-4i58
---

Extract the existing workflow system into an @agent-ops/plugin-workflows package that exercises every plugin extension point. This replaces the toy example plugin as the real-world validation of the plugin architecture.

## Scope

Move existing workflow code (routes, UI, tables) into plugin structure and build the missing pieces:

### Worker layer (plugin routes + events)
- Workflow/trigger/execution/webhook CRUD routes (move from core)
- Scheduled hook for cron trigger evaluation (requires plugin SDK to support worker.scheduled)
- Event handlers for workflow lifecycle events (execution started/completed/failed)
- D1 migrations (existing tables from 0001 — plugin assumes they exist, provides migrations for fresh installs)

### Sandbox layer (agent tools)
- workflow.list — list available workflows
- workflow.get — read workflow definition
- workflow.run — execute a workflow by ID with variables
- workflow.create — create a new workflow from YAML/JSON
- workflow.update — modify an existing workflow
- These are OpenCode tools the agent uses to self-modify and execute workflows

### Runner layer (hooks + execution engine)
- onPromptBefore hook: inject workflow context when session is a workflow execution
- onToolCall hook: track step progress, update execution record
- Execution engine: interpret workflow steps (agent, tool, conditional, loop, parallel, subworkflow, approval)
- Variable interpolation in step goals/contexts
- Completion callback: POST /api/executions/:id/complete when workflow finishes

### Client layer (wizard + builder UI)
- Workflow wizard: guided multi-step creation flow for new workflows
- Visual step builder: step palette, drag-to-reorder, branch/conditional editor
- Trigger configuration UI: webhook URL display, cron expression builder, variable mapping editor
- Approval UI: respond to pending approvals, timeout display
- Plugin tool cards for workflow.run/create/update agent actions
- Plugin sidebar items and settings panel

### Design decisions needed
- Webhook routing: plugin owns /api/plugins/workflows/webhooks/* or core delegates via hook
- Scheduled handler: plugin SDK needs a worker.scheduled hook type for cron evaluation
- Existing D1 tables: plugin assumes 0001 tables exist, no destructive migration

## Blocked by
- Plugin System epic (agent-ops-xc0m) — all plugin SDK and registry tasks must complete first

## Acceptance Criteria
- All existing workflow functionality preserved (CRUD, triggers, executions, webhooks)
- Agent can create and run workflows from inside a sandbox session
- Workflow execution engine interprets steps and tracks progress
- Cron triggers fire on schedule
- Workflow wizard allows non-technical users to create workflows in the browser
- Approval flow works end-to-end (request, notify, respond, timeout)
- Plugin validates the entire plugin SDK architecture with real production code