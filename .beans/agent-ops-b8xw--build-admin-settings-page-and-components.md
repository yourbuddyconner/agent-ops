---
# agent-ops-b8xw
title: Build admin settings page and components
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-01-31T07:49:43Z
updated_at: 2026-02-01T02:29:26Z
parent: agent-ops-csfb
---

Create the admin settings page at /settings/admin and all supporting components. Use frontend-design skill for final polish.

## Admin settings page (packages/client/src/routes/settings/admin.tsx) — NEW
Page layout using PageContainer + PageHeader pattern. Sections:

### 1. Organization
- Org name text input with save button
- Simple inline edit pattern

### 2. LLM API Keys (packages/client/src/components/admin/llm-key-form.tsx)
- One row per provider: Anthropic, OpenAI, Google
- Each row: provider name, masked input (show ••••••• if key is set), Save/Delete buttons
- When saving, send the raw key to the API (encryption happens server-side)
- Show who set the key and when (from setBy, updatedAt)

### 3. Access Control (packages/client/src/components/admin/access-control.tsx)
- Toggle: 'Restrict signups to email domain' + text input for domain (e.g. 'acme.com')
- Toggle: 'Use email allowlist' + textarea for comma-separated emails
- Save button that updates org settings
- Help text explaining behavior when both/neither are enabled

### 4. Invites (packages/client/src/components/admin/invite-form.tsx + invite-list.tsx)
- invite-form: email input + role select (admin/member) + 'Send Invite' button
- invite-list: table with columns: Email, Role, Status (pending/accepted/expired), Expires, Revoke button
- Show expired invites grayed out

### 5. Users (packages/client/src/components/admin/user-list.tsx)
- Table with columns: Name/Email, Role (badge), Joined date
- Role dropdown to change role (with confirmation for admin changes)
- Remove button (with confirmation dialog, disabled for self and last admin)

### 6. Org Integrations
- List org-scope integrations
- Link to configure (reuse existing integration components with scope='org')

## Settings index update (packages/client/src/routes/settings/index.tsx)
- Add 'Organization' section/link visible only when user.role === 'admin'
- Link to /settings/admin

## Acceptance Criteria
- Page only accessible to admins (redirect or hide for members)
- All CRUD operations work end-to-end
- Proper loading states (skeletons) and error handling
- Responsive layout
- Use frontend-design skill for final design polish
- pnpm typecheck passes