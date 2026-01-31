---
# agent-ops-guyj
title: Add admin middleware and update auth to include role
status: todo
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:47:57Z
updated_at: 2026-01-31T07:49:57Z
parent: agent-ops-csfb
blocking:
    - agent-ops-9nj8
---

Update auth middleware to include user role and create new admin guard middleware.

## Env update (packages/worker/src/env.ts)
- Add `ADMIN_EMAIL?: string` to Env interface (bootstrap fallback for first admin)
- Add `role: 'admin' | 'member'` to the Variables.user type

## Auth middleware (packages/worker/src/middleware/auth.ts)
- Update the auth session query and API token query to JOIN users table and SELECT u.role
- Return `{ id, email, role }` in `c.set('user', ...)`
- Add one-time admin bootstrap: if ADMIN_EMAIL env var is set and no user with role='admin' exists in DB, promote the user matching that email to admin

## Admin middleware (packages/worker/src/middleware/admin.ts) — NEW FILE
- Export `adminMiddleware` Hono middleware
- Check `c.get('user').role === 'admin'`
- If not admin, throw ForbiddenError('Admin access required')

## Acceptance Criteria
- All existing routes still work (role field is additive)
- c.get('user') now includes role everywhere
- Admin middleware blocks non-admin users with 403
- pnpm typecheck passes in worker package