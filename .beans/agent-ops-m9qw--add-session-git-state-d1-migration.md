---
# agent-ops-m9qw
title: Add session_git_state D1 migration
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:44:28Z
updated_at: 2026-02-01T21:30:02Z
parent: agent-ops-1mec
blocking:
    - agent-ops-1m4j
    - agent-ops-3np2
    - agent-ops-26wg
    - agent-ops-8q1l
    - agent-ops-aop1
---

Create packages/worker/migrations/0008_session_git_state.sql

Table: session_git_state with columns:
- id (TEXT PK)
- session_id (TEXT NOT NULL, FK to sessions, UNIQUE INDEX)
- source_type (TEXT, CHECK IN pr/issue/branch/manual)
- source_pr_number, source_issue_number (INTEGER)
- source_repo_full_name, source_repo_url (TEXT)
- branch, base_branch (TEXT)
- commit_count (INTEGER DEFAULT 0)
- pr_number, pr_title, pr_state, pr_url, pr_created_at, pr_merged_at (PR tracking)
- agent_authored (INTEGER DEFAULT 1)
- created_at, updated_at (TEXT DEFAULT datetime('now'))

Indexes:
- UNIQUE idx_sgs_session ON session_id
- idx_sgs_repo_pr ON (source_repo_full_name, pr_number)
- idx_sgs_agent_pr ON (agent_authored, pr_state)

Done when: migration file exists and passes make db-migrate.