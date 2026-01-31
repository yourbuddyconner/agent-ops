---
# agent-ops-csfb
title: Implement single-org model with roles, invites, and access control
status: todo
type: epic
priority: high
tags:
    - backend
    - frontend
    - worker
created_at: 2026-01-31T07:47:30Z
updated_at: 2026-01-31T07:47:30Z
---

Add a single-organization model to Agent-Ops. The org has admin/member roles, org-level LLM API key management, org-level integrations, user invites with email+role, and email domain gating. The first user to sign up automatically becomes admin.

## Key Design Decisions
- Single-org model (one org_settings row with id='default')
- Roles: admin and member. Admin can manage everything. Members have read-only access to org resources.
- LLM API keys stored encrypted in D1 (org_api_keys table), with env var fallback
- Email access control: domain gating (e.g. @acme.com) and/or explicit email allowlist, both optional
- Invites: admin creates invite with email+role, 7-day expiry, unique per email
- Integrations gain a scope column ('user' or 'org') so org-wide integrations can be shared

## Schema Changes (migration 0006_organization.sql)
- ALTER users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
- CREATE TABLE org_settings (single-row: name, allowed_email_domain, allowed_emails, domain_gating_enabled, email_allowlist_enabled)
- CREATE TABLE org_api_keys (id, provider UNIQUE, encrypted_key, set_by, timestamps)
- CREATE TABLE invites (id, email UNIQUE, role, invited_by, accepted_at, expires_at, timestamps) + index on email
- ALTER integrations ADD COLUMN scope TEXT NOT NULL DEFAULT 'user'

## File Change Summary
| File | Action |
|------|--------|
| packages/worker/migrations/0006_organization.sql | CREATE |
| packages/shared/src/types/index.ts | MODIFY |
| packages/shared/src/errors.ts | MODIFY |
| packages/worker/src/env.ts | MODIFY |
| packages/worker/src/middleware/auth.ts | MODIFY |
| packages/worker/src/middleware/admin.ts | CREATE |
| packages/worker/src/lib/db.ts | MODIFY |
| packages/worker/src/routes/admin.ts | CREATE |
| packages/worker/src/routes/oauth.ts | MODIFY |
| packages/worker/src/routes/sessions.ts | MODIFY |
| packages/worker/src/routes/integrations.ts | MODIFY |
| packages/worker/src/index.ts | MODIFY |
| packages/client/src/api/admin.ts | CREATE |
| packages/client/src/routes/settings/admin.tsx | CREATE |
| packages/client/src/routes/settings/index.tsx | MODIFY |
| packages/client/src/components/admin/*.tsx | CREATE (5 files) |

## Acceptance Criteria
- First user signup gets admin role automatically
- Admin can manage org settings, LLM keys, invites, and users from /settings/admin
- LLM keys fall back to env vars when not set in DB
- Domain gating and email allowlist enforce access from DB settings
- Invites assign role on acceptance
- Members get 403 on all /api/admin routes
- pnpm typecheck passes across all packages