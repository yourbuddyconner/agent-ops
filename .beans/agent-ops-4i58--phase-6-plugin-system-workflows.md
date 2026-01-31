---
# agent-ops-4i58
title: 'Phase 6: Plugin System & Workflows'
status: todo
type: milestone
priority: high
tags:
    - worker
    - frontend
    - runner
    - sandbox
    - backend
created_at: 2026-01-31T08:04:06Z
updated_at: 2026-01-31T08:04:47Z
blocking:
    - agent-ops-zrpc
---

Build the plugin architecture that lets npm packages extend AgentOps across all layers, then extract the workflow system into the first real plugin. Proves the extensibility model with production code.

## Epics
- Plugin System (agent-ops-xc0m) — SDK, resolver, per-layer registries
- Workflows Plugin (agent-ops-ab23) — workflow execution engine, agent tools, wizard UI

## Ordering
Plugin System must complete before Workflows Plugin begins.

## Definition of Done
- Plugin SDK with definePlugin() and typed interfaces for all layers
- Build-time resolver generates registries from plugin manifests
- Example plugin validates the architecture end-to-end
- Workflow execution engine runs steps when triggers fire
- Agent can create and run workflows from inside sandbox sessions
- Workflow wizard lets users build workflows in the browser
- Cron triggers fire on schedule
- Approval flow works end-to-end