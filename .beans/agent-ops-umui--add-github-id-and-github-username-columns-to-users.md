---
# agent-ops-umui
title: Add github_id and github_username columns to users table
status: completed
type: task
priority: normal
tags:
    - worker
created_at: 2026-01-28T07:09:57Z
updated_at: 2026-01-28T07:17:17Z
parent: agent-ops-mr3k
---

V1 spec (section 10) requires two columns on the users table for GitHub OAuth:

- github_id TEXT UNIQUE — GitHub user ID for OAuth identity mapping
- github_username TEXT — For git config (user.name) inside sandboxes

Neither column exists. Needed before Phase 4 (GitHub OAuth) but the migration should be created now.

**Action:** Create migration:
  ALTER TABLE users ADD COLUMN github_id TEXT UNIQUE;
  ALTER TABLE users ADD COLUMN github_username TEXT;

**Done when:** Users table has both columns. Existing rows are unaffected (nullable columns).