---
# agent-ops-9nj8
title: Build admin API routes
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:48:28Z
updated_at: 2026-02-01T02:24:29Z
parent: agent-ops-csfb
blocking:
    - agent-ops-fz5k
    - agent-ops-ctmq
---

Create packages/worker/src/routes/admin.ts with all admin-only CRUD endpoints, and mount in index.ts.

## Route file (packages/worker/src/routes/admin.ts) — NEW
Export `adminRouter` as Hono router. Apply `adminMiddleware` to all routes.

### Org Settings
- `GET /` → getOrgSettings (returns org name, domain settings, toggles)
- `PUT /` → updateOrgSettings (accepts partial updates: name, allowed_email_domain, allowed_emails, domain_gating_enabled, email_allowlist_enabled)

### LLM API Keys
- `GET /llm-keys` → listOrgApiKeys (returns provider + isSet flag + setBy + timestamps, NEVER raw keys)
- `PUT /llm-keys/:provider` → setOrgApiKey (accepts { key: string }, encrypts with ENCRYPTION_KEY env var before storing, validates provider is one of: anthropic, openai, google)
- `DELETE /llm-keys/:provider` → deleteOrgApiKey

### Invites
- `GET /invites` → listInvites
- `POST /invites` → createInvite (accepts { email, role? }, generates nanoid, sets 7-day expiry, validates email format)
- `DELETE /invites/:id` → deleteInvite

### Users
- `GET /users` → listUsers (returns all users with role)
- `PATCH /users/:id` → updateUserRole (accepts { role }, validates not demoting last admin)
- `DELETE /users/:id` → deleteUser (validates not deleting self, not deleting last admin)

## Encryption helpers
- `encryptApiKey(key: string, secret: string): string` — AES-GCM encrypt using Web Crypto API, return base64(iv + ciphertext)
- `decryptApiKey(encrypted: string, secret: string): string` — reverse of above
- These can live in a small util file or inline in admin.ts

## Mount (packages/worker/src/index.ts)
- Import adminRouter
- Mount at `app.route('/api/admin', adminRouter)` (after auth middleware)

## Acceptance Criteria
- All routes return proper JSON responses
- All routes require admin role (403 for members)
- LLM keys are encrypted at rest, never returned in plaintext
- Validation: can't demote last admin, can't delete self, valid provider names, valid email format
- pnpm typecheck passes