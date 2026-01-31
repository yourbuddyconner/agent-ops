---
# agent-ops-9sf1
title: Add runner plugin hooks and gateway route mounting
status: todo
type: task
priority: high
tags:
    - runner
created_at: 2026-01-31T07:50:46Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-bklb
---

Wire plugin support into the Runner layer.

## Files to Create

### packages/runner/src/plugins/_registry.ts (auto-generated, initial empty version)
- Export pluginHooks: RunnerHooks[] (empty array)
- Export pluginGatewayRoutes: Array<{ prefix: string; router: any }> (empty array)

## Files to Modify

### packages/runner/src/prompt.ts
- Import pluginHooks from registry
- In handlePrompt() — before sending to OpenCode, call onPromptBefore hooks in sequence; if any returns a string, use it as transformed content
- In finalizeResponse() — after sending result, call onPromptAfter hooks
- In handleToolPart() — after sending tool call to DO, call onToolCall hooks

### packages/runner/src/gateway.ts
- Import pluginGatewayRoutes from registry
- After existing routes, mount each plugin's gateway router at /api/plugins/{prefix}

## Acceptance Criteria
- Runner typechecks with empty plugin registry
- Existing prompt flow works unchanged when no plugins are loaded
- Hook calls are wrapped in try/catch so a broken plugin doesn't crash the runner
- Gateway routes mount correctly when plugins provide them