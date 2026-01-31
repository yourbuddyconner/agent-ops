---
# agent-ops-7n6t
title: Add client plugin registry and extension points
status: todo
type: task
priority: high
tags:
    - frontend
created_at: 2026-01-31T07:50:53Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-bklb
---

Wire plugin support into the React frontend.

## Files to Create

### packages/client/src/plugins/_registry.ts (auto-generated, initial empty version)
- Export pluginToolCards: Record<string, ComponentType<PluginToolCardProps>> (empty)
- Export pluginPanels: PluginPanel[] (empty)
- Export pluginSidebarItems: PluginSidebarItem[] (empty)
- Export pluginSettingsPanels: Record<string, ComponentType> (empty)

## Files to Modify

### packages/client/src/components/chat/tool-cards/index.tsx (or equivalent)
- Import pluginToolCards from registry
- Before the existing switch/lookup for built-in tool cards, check if pluginToolCards has a match for the tool name
- If found, render the plugin's custom ToolCard component

### packages/client/src/routes/sessions/$sessionId.tsx
- Import pluginPanels from registry
- Extend DrawerPanel type to accept string (for plugin panel IDs)
- After existing panel rendering (editor, files), render active plugin panels
- Add plugin panel toggle buttons to the session toolbar alongside editor/files buttons

### Sidebar (if applicable)
- Import pluginSidebarItems from registry
- Render plugin sidebar items in the navigation

## Acceptance Criteria
- Client builds and dev server starts with empty plugin registry
- Existing tool cards render unchanged when no plugins are loaded
- Session drawer supports dynamic plugin panels
- No runtime errors when pluginPanels/pluginToolCards are empty