---
# agent-ops-vlqt
title: Add org schema migration and shared types
status: todo
type: task
priority: high
tags:
    - backend
    - worker
created_at: 2026-01-31T07:47:56Z
updated_at: 2026-01-31T07:49:57Z
parent: agent-ops-csfb
blocking:
    - agent-ops-guyj
    - agent-ops-82w2
    - agent-ops-stlm
---

Create migration 0006_organization.sql and update shared types/errors.

## Migration (packages/worker/migrations/0006_organization.sql)
```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';

CREATE TABLE org_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'My Organization',
  allowed_email_domain TEXT,
  allowed_emails TEXT,
  domain_gating_enabled INTEGER DEFAULT 0,
  email_allowlist_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO org_settings (id) VALUES ('default');

CREATE TABLE org_api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL,
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_invites_email ON invites(email);

ALTER TABLE integrations ADD COLUMN scope TEXT NOT NULL DEFAULT 'user';
```

## Shared Types (packages/shared/src/types/index.ts)
- Add `UserRole = 'admin' | 'member'`
- Add `role: UserRole` to User interface
- Add `scope: 'user' | 'org'` to Integration interface
- Add interfaces: OrgSettings, OrgApiKey (with provider, isSet flag, setBy, timestamps), Invite (email, role, invitedBy, acceptedAt, expiresAt, timestamps)

## Shared Errors (packages/shared/src/errors.ts)
- Add ForbiddenError class (HTTP 403) if not already present

## Acceptance Criteria
- make db-migrate runs cleanly
- pnpm typecheck passes in shared package
- All new types are exported from shared