---
# agent-ops-58ly
title: Delete old DOs and ModalService
status: todo
type: task
priority: critical
tags:
    - worker
    - phase1
created_at: 2026-01-28T03:55:05Z
updated_at: 2026-01-28T03:55:05Z
parent: agent-ops-jcbs
---

Delete AgentSessionDurableObject, OpenCodeContainerDO, and ModalService. Update wrangler.toml DO bindings and migrations. Update index.ts exports. Remove references from routes. This clears the way for the new SessionAgentDO.

Acceptance criteria:
- agent-session.ts deleted
- opencode-container.ts deleted  
- modal-service.ts deleted
- wrangler.toml updated with only APIKeysDurableObject + new SessionAgentDO binding
- index.ts exports updated
- All route files that referenced old DOs updated to stub/TODO
- TypeScript compiles clean