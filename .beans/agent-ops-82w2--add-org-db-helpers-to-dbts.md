---
# agent-ops-82w2
title: Add org DB helpers to db.ts
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:47:59Z
updated_at: 2026-02-01T02:23:43Z
parent: agent-ops-csfb
blocking:
    - agent-ops-9nj8
    - agent-ops-8wua
    - agent-ops-ctmq
---

Add ~15 new database helper functions to packages/worker/src/lib/db.ts for organization, invites, and user management.

## Org Settings
- `getOrgSettings(db: D1Database): Promise<OrgSettings>` — SELECT from org_settings WHERE id='default'
- `updateOrgSettings(db: D1Database, updates: Partial<OrgSettings>): Promise<OrgSettings>` — UPDATE org_settings, return updated row

## Org API Keys
- `listOrgApiKeys(db: D1Database): Promise<OrgApiKey[]>` — SELECT id, provider, set_by, created_at, updated_at (NO encrypted_key)
- `getOrgApiKey(db: D1Database, provider: string): Promise<{ encrypted_key: string } | null>` — SELECT encrypted_key WHERE provider=?
- `setOrgApiKey(db: D1Database, params: { id: string, provider: string, encryptedKey: string, setBy: string }): Promise<void>` — INSERT OR REPLACE
- `deleteOrgApiKey(db: D1Database, provider: string): Promise<void>`

## Invites
- `createInvite(db: D1Database, params: { id, email, role, invitedBy, expiresAt }): Promise<Invite>`
- `getInviteByEmail(db: D1Database, email: string): Promise<Invite | null>` — WHERE email=? AND accepted_at IS NULL AND expires_at > datetime('now')
- `listInvites(db: D1Database): Promise<Invite[]>` — all invites ordered by created_at DESC
- `deleteInvite(db: D1Database, id: string): Promise<void>`
- `markInviteAccepted(db: D1Database, id: string): Promise<void>` — UPDATE accepted_at = datetime('now')

## Users
- `updateUserRole(db: D1Database, userId: string, role: UserRole): Promise<void>`
- `getUserCount(db: D1Database): Promise<number>` — SELECT COUNT(*) FROM users
- `listUsers(db: D1Database): Promise<User[]>` — all users ordered by created_at
- `deleteUser(db: D1Database, userId: string): Promise<void>`
- Update existing `mapUser` / user mapping to include `role` field

## Acceptance Criteria
- All functions properly typed with shared types
- camelCase conversion applied to all returned objects
- pnpm typecheck passes