---
# agent-ops-se0c
title: Add worker plugin registry, routes, and event dispatch
status: todo
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:50:42Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-bklb
---

Wire plugin support into the Cloudflare Worker layer.

## Files to Create

### packages/worker/src/plugins/_registry.ts (auto-generated, initial empty version)
- mountPluginRoutes(app) — no-op when empty
- getPluginEventHandlers() — returns empty object when no plugins

### packages/worker/src/routes/plugins.ts — core plugin settings API
- GET /api/plugins — list enabled plugins (reads from resolved manifest)
- GET /api/plugins/:name/settings — get user's plugin settings
- PUT /api/plugins/:name/settings — update settings (validate against schema)

### packages/worker/migrations/NNNN_plugin_settings.sql
- CREATE TABLE plugin_settings (user_id, plugin_name, key, value, is_secret, updated_at)
- PRIMARY KEY (user_id, plugin_name, key)

## Files to Modify

### packages/worker/src/index.ts
- Import and mount pluginsRouter at /api/plugins
- Import and call mountPluginRoutes(app)

### packages/worker/src/durable-objects/event-bus.ts
- Import getPluginEventHandlers from registry
- After broadcasting events to WebSocket clients, dispatch to plugin handlers
- Use Promise.allSettled so plugin errors don't break event delivery

## Acceptance Criteria
- Worker typechecks with empty plugin registry
- GET /api/plugins returns empty array when no plugins configured
- Plugin settings CRUD works via API
- EventBus dispatches events to plugin handlers without breaking existing flow
- D1 migration applies cleanly