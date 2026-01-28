---
# agent-ops-vnkt
title: Update Worker routes for new session flow
status: completed
type: task
priority: critical
tags:
    - worker
    - phase1
created_at: 2026-01-28T04:00:11Z
updated_at: 2026-01-28T04:33:17Z
parent: agent-ops-jcbs
---

Update Worker session routes to use the new SessionAgentDO and Python backend instead of old DOs and ModalService.

Changes:
- POST /api/sessions: Generate runnerToken, construct doWsUrl, call Python backend, init SessionAgentDO
- POST /api/sessions/:id/messages: Forward to SessionAgentDO
- GET /api/sessions/:id/ws: Proxy WebSocket upgrade to SessionAgentDO
- DELETE /api/sessions/:id: Call SessionAgentDO /stop, call Python backend terminate
- Update container routes to work with new DO (or deprecate overlapping routes)
- Add MODAL_BACKEND_URL to env.ts and wrangler.toml

Acceptance criteria:
- Session creation spawns a Modal sandbox via Python backend
- Messages route through SessionAgentDO
- WebSocket connections work for clients
- Session deletion terminates sandbox
- All existing routes that don't overlap continue working
- TypeScript compiles clean