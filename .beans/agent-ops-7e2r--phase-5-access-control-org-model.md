---
# agent-ops-7e2r
title: 'Phase 5: Access Control & Org Model'
status: todo
type: milestone
priority: high
tags:
    - worker
    - frontend
    - backend
created_at: 2026-01-31T08:03:48Z
updated_at: 2026-01-31T08:04:47Z
blocking:
    - agent-ops-4i58
---

Single-organization model with admin/member roles, invites, email domain gating, org-level LLM keys, and access control. Foundation for multi-tenancy and team management.

## Epics
- Implement single-org model with roles, invites, and access control (agent-ops-csfb)

## Definition of Done
- Org schema migrated and shared types defined
- Admin middleware enforces role-based access
- OAuth flow handles first-user-admin and email domain gating
- Admin settings page for org management, invites, and LLM keys
- LLM key fallback chain: user keys → org keys → platform keys
- Integrations scoped to org level