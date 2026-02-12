---
# agent-ops-sup1
title: Supabase Integration
status: todo
type: task
priority: high
tags:
    - phase4
    - supabase
    - worker
    - database
created_at: 2026-02-12T18:00:00Z
updated_at: 2026-02-12T18:00:00Z
parent: null
---

Supabase integration for database management and authentication:
- Supabase OAuth flow (frontend + worker callback)
- Store access token encrypted in D1
- Connect to user's Supabase projects via Management API
- List databases, tables, and schemas for context injection
- Execute read-only SQL queries for database exploration
- Sync database schema snapshots for session context
- Display database metrics (size, row counts, connection info)

**Why it's needed:**
Many users store their application data in Supabase. Integrating Supabase allows the AI agent to understand the database schema, query data for debugging, and suggest schema improvements. This enables richer context-aware coding assistance, especially for full-stack applications where database structure impacts code decisions.

Acceptance criteria:
- Supabase OAuth install flow works
- Access token stored encrypted in D1
- API endpoints to list user's Supabase projects
- Database schema introspection and sync
- Read-only SQL query execution (with safety limits)
- Database context injectable into agent sessions
- Webhook or polling for schema change detection
