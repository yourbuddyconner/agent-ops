---
# agent-ops-llar
title: Create plugin-sdk package with manifest types and definePlugin()
status: todo
type: task
priority: high
tags:
    - worker
    - frontend
    - runner
created_at: 2026-01-31T07:50:06Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-3196
---

Create packages/plugin-sdk/ with:

## Files to Create
- package.json (@agent-ops/plugin-sdk, type: module)
- src/index.ts — re-exports all types
- src/manifest.ts — PluginManifest interface, SettingDefinition interface, definePlugin() helper
- src/worker.ts — PluginEventHandlers, PluginWorkerContext types
- src/runner.ts — RunnerHooks interface (onConnect, onDisconnect, onPromptBefore, onPromptAfter, onToolCall)
- src/client.ts — PluginPanel, PluginSidebarItem, PluginToolCardProps types
- tsconfig.json

## PluginManifest Shape
- name, version, displayName, description
- sandbox?: { aptPackages, npmPackages, runCommands, envVars }
- opencode?: { tools, skills, instructions, configPatch }
- worker?: { routes, events, migrations }
- runner?: { hooks, gatewayRoutes }
- client?: { toolCards, panels, sidebarItems, settingsPanel }
- settings?: { schema: Record<string, SettingDefinition> }

## Acceptance Criteria
- pnpm typecheck passes in plugin-sdk package
- definePlugin() returns the manifest object as-is (identity function for type checking)
- All layer-specific types are importable from subpaths