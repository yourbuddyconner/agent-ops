---
# agent-ops-8wua
title: Update OAuth flow for DB-based access control and first-user-admin
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-01-31T07:48:44Z
updated_at: 2026-02-01T02:25:25Z
parent: agent-ops-csfb
---

Modify packages/worker/src/routes/oauth.ts to use database-driven email access control instead of env vars, and implement first-user-admin logic.

## Email access control (replace isEmailAllowed)
Replace the current `isEmailAllowed` function with a new DB-based check. The logic should be:
1. Query org_settings for domain_gating_enabled, allowed_email_domain, email_allowlist_enabled, allowed_emails
2. If domain_gating_enabled → check email domain matches allowed_email_domain (case-insensitive)
3. If email_allowlist_enabled → check email is in allowed_emails (comma-separated list, trimmed, case-insensitive)
4. If NEITHER gating is enabled → check for a valid (non-expired, non-accepted) invite for this email
5. Backward compat fallback: if nothing configured in DB, fall back to ALLOWED_EMAILS env var
6. If nothing is configured at all → allow signup (preserves current open-signup behavior for fresh installs)

## First-user-admin logic
After creating a new user in the OAuth callback:
- Call getUserCount(db)
- If count === 1 → this is the first user, UPDATE their role to 'admin'

## Invite acceptance
After user creation (or login):
- Call getInviteByEmail(db, email)
- If a valid invite exists → markInviteAccepted(db, invite.id)
- If user was just created → set their role to the invite's role

## Acceptance Criteria
- First signup becomes admin automatically
- Domain gating blocks wrong-domain emails
- Email allowlist blocks non-listed emails
- Valid invites allow signup and assign correct role
- Backward compat: ALLOWED_EMAILS env var still works as fallback
- Open signup still works when nothing is configured
- pnpm typecheck passes