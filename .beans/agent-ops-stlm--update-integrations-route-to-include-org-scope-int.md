---
# agent-ops-stlm
title: Update integrations route to include org-scope integrations
status: todo
type: task
priority: normal
tags:
    - worker
created_at: 2026-01-31T07:48:51Z
updated_at: 2026-01-31T07:48:51Z
parent: agent-ops-csfb
---

Modify packages/worker/src/routes/integrations.ts to return both user-personal and org-level integrations.

## Changes
- GET /api/integrations should return:
  - User's own integrations (scope='user', user_id = current user)
  - Org-level integrations (scope='org') — visible to all members
- Org integrations are managed via admin routes (POST/PUT/DELETE for org integrations go through /api/admin)
- Members see org integrations as read-only

## Acceptance Criteria
- GET /api/integrations returns merged list with scope field
- Org integrations visible to all authenticated users
- Existing user integration CRUD unchanged
- pnpm typecheck passes