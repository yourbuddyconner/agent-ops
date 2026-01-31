---
# agent-ops-0uxn
title: Add DO garbage collection for terminated sessions
status: todo
type: task
priority: normal
tags:
    - worker
    - infrastructure
created_at: 2026-01-30T22:07:38Z
updated_at: 2026-01-31T08:04:38Z
parent: agent-ops-zrpc
---

## Problem

Durable Objects persist their SQLite storage indefinitely. Every terminated/hibernated session keeps its full message history, questions, prompt queue, and state in DO-local SQLite forever. Cloudflare charges $0.20/GB-month for stored data and $1.00/million rows written. At scale this becomes a real cost line item — each session can accumulate hundreds of messages with tool call payloads (args + results), screenshots (base64 blobs), and other data.

Currently there is no cleanup mechanism. The system relies on the fact that "once all data is removed via deleteAll(), the object will be cleaned up automatically by the system" per Cloudflare docs, but nothing ever calls deleteAll().

## Solution

Add a garbage collection system that runs on the existing hourly cron trigger (already configured in wrangler.toml as `schedule: 0 * * * *`).

### Implementation Details

**1. New D1 column: `packages/worker/migrations/NNNN_session_archived.sql`**
- `ALTER TABLE sessions ADD COLUMN archived_at TEXT DEFAULT NULL;`
- Archived sessions are excluded from dashboard queries and session lists but kept for historical record.

**2. Cron handler in `packages/worker/src/index.ts`**
- The existing `scheduled` event handler should call a new `gcTerminatedSessions()` function.
- Query D1 for sessions in terminal states (`terminated`, `error`) older than the retention period:
  ```sql
  SELECT id FROM sessions
  WHERE status IN ('terminated', 'error')
    AND archived_at IS NULL
    AND last_active_at < datetime('now', '-30 days')
  LIMIT 50
  ```
- The LIMIT 50 prevents the cron from timing out (Worker CPU limit is 30s for cron triggers). Each DO cleanup involves a network call, so batching is important.

**3. For each stale session:**
  1. Call the DO's new `/gc` endpoint (see below).
  2. On success, update D1: `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
  3. On failure (DO unreachable), log and skip — will retry next hour.

**4. New DO endpoint: `/gc` in `session-agent.ts`**
- Final flush of metrics to D1 (call `flushMetrics()` one last time to ensure counts are persisted).
- Call `this.ctx.storage.deleteAll()` to remove all SQLite data and internal metadata.
- Return `{ success: true }`.
- After `deleteAll()`, Cloudflare will automatically garbage collect the DO instance.

**5. Configurable retention period**
- Default: 30 days after `last_active_at` for terminated/error sessions.
- Store as an environment variable `GC_RETENTION_DAYS` in wrangler.toml (default 30).
- Hibernated sessions should NOT be garbage collected — they are expected to be restored.

**6. Update dashboard and session list queries**
- Add `AND archived_at IS NULL` to dashboard aggregation queries (or keep archived sessions in aggregates but exclude from recent/active lists).
- The `getUserSessions()` helper in `db.ts` should filter out archived sessions by default (add `AND archived_at IS NULL` to the WHERE clause).

### Edge Cases

- **Race condition**: A session is being restored from hibernate while GC runs. Guard against this by only GC'ing `terminated` and `error` statuses, never `hibernated`.
- **DO already evicted from memory**: This is fine — the `/gc` fetch will re-instantiate it, flush metrics, then deleteAll(). The DO will be cleaned up after.
- **deleteAll() idempotency**: If GC runs twice on the same session (e.g., first run set archived_at but DO deleteAll failed), the second `/gc` call on an empty DO is harmless.
- **Cron timeout**: Limit to 50 sessions per run. At hourly frequency, this handles 1200 sessions/day of cleanup throughput. If backlog grows, temporarily increase the limit or run more frequently.

### Acceptance Criteria

- [ ] Hourly cron trigger calls GC function
- [ ] Sessions in `terminated`/`error` status older than 30 days get their DO storage wiped via `deleteAll()`
- [ ] Sessions are marked `archived_at` in D1 after successful DO cleanup
- [ ] Archived sessions are excluded from session lists and dashboard recent/active queries
- [ ] Archived sessions still count toward historical aggregate stats (total sessions, total messages)
- [ ] Hibernated sessions are never garbage collected
- [ ] GC processes at most 50 sessions per cron run to stay within CPU limits
- [ ] `GC_RETENTION_DAYS` env var controls retention period (default 30)
- [ ] flushMetrics() is called before deleteAll() so no data is lost