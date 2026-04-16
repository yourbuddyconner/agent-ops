# Seed Data & CI Smoke Tests

**Date:** 2026-04-15
**Status:** Approved
**Depends on:** Nothing (standalone)
**Depended on by:** Bootstrap Registry (which also depends on Service Config Convergence)

## Problem

The test suite has unit tests and a smoke test harness, but CI only runs unit tests. The smoke tests (`tests/smoke/`) require a running worker with seeded data (a user and API token at minimum), and there's no reliable way to set that up in CI. The existing seed file (`packages/worker/scripts/seed-test-data.sql`) has one user and one token — not enough for frontend development, staging validation, or exercising the workflow/orchestrator UI.

## Goals

1. A single idempotent SQL seed script that populates D1 with enough data for CI smoke tests, local dev, and staging baselines.
2. A CI job that boots a local worker, seeds the database, and runs the API smoke tests on every push/PR.
3. Enough entity variety that the frontend renders non-empty states for all major views (sessions list, orchestrator, workflows, personas, integrations).

## What gets seeded

### Users (3)

| ID | Email | Role | Purpose |
|---|---|---|---|
| `seed-admin` | `admin@test.valet.dev` | admin | Owns org settings; API token used by CI |
| `seed-member` | `member@test.valet.dev` | member | Owns orchestrator, workflows, persona |
| `seed-viewer` | `viewer@test.valet.dev` | member | Multiplayer/participant testing |

### API token (1)

Token value: `test-api-token-12345` (matches `Makefile` default `API_TOKEN`).
Stored as SHA-256 hash in `api_tokens`. Owned by `seed-admin`, no expiry, no revocation.

### Org settings (1)

Singleton row `id='default'`: name `Valet Dev`, domain gating off, default session visibility `org_visible`.

### Orchestrator identity (1)

For `seed-member`: name `Agent`, handle `agent`, basic custom instructions telling it to be helpful and concise.

### Persona + persona file (1 + 1)

Default persona `Assistant` (`isDefault=true`, shared visibility, slug `assistant`). One persona file with a short system prompt.

### Skills (2)

Two builtin shared skills with stub content: `github` and `browser`. Linked to the default persona via `persona_skills`.

### Workflow + trigger + execution (1 + 1 + 1)

**Workflow:** `daily-health-check` (slug), owned by `seed-member`. Single-step `data` JSON that prompts the orchestrator: "Summarize active sessions, recent errors, and memory stats."

**Trigger:** Schedule type, cron `0 9 * * *`, enabled, linked to the workflow.

**Execution:** One completed execution with `status='completed'`, timestamps, and a stub `outputs` JSON so the execution history UI has a row to render.

### Integrations (3 rows, no credentials)

| Service | Status | Purpose |
|---|---|---|
| github | active | Shows connected state in UI |
| slack | disconnected | Shows disconnected state |
| linear | pending | Shows pending state |

All owned by `seed-member`, scope `user`. No `credentials` rows — those require real encrypted tokens.

### What does NOT get seeded

- Credentials or encrypted tokens (requires real secrets)
- Session history or messages (ephemeral, UI handles empty state)
- Screenshots, file changes, git state
- Channel bindings, Slack/Telegram installs
- Memory files (orchestrator creates these at runtime)
- Org API keys or custom providers (separate service config convergence project)

## Seed script

**Location:** `packages/worker/scripts/seed-test-data.sql`

Replaces the existing minimal file. All statements use `INSERT OR REPLACE` (or `INSERT OR IGNORE` where appropriate) so the script is safe to re-run.

Sections in order (respecting foreign key dependencies):
1. Users
2. API tokens
3. Org settings
4. Personas + persona files
5. Skills + persona-skill links
6. Orchestrator identity
7. Workflows + triggers + executions
8. Integrations

**Invocation:** `make db-seed` calls `wrangler d1 execute --local --file=scripts/seed-test-data.sql` from `packages/worker/`.

**`package.json` script:** Add `"db:seed"` to `packages/worker/package.json`.

## CI job

Added as a new job in `.github/workflows/ci.yml`, running after the existing `ci` job (which handles typecheck + unit tests).

```yaml
smoke:
  runs-on: ubuntu-latest
  needs: ci
  steps:
    - checkout
    - setup pnpm/node/bun (same as ci job)
    - pnpm install --frozen-lockfile
    - generate plugin registries
    - wrangler d1 migrations apply --local
    - wrangler d1 execute --local --file=scripts/seed-test-data.sql
    - wrangler dev --local &  # background the worker
    - wait for worker to respond on :8787
    - WORKER_URL=http://localhost:8787 API_TOKEN=test-api-token-12345 pnpm vitest run --config tests/smoke/vitest.config.ts api.test.ts
```

Only `api.test.ts` runs in CI (direct HTTP, no agent dispatch, no LLM keys needed). The agent-dispatched tests remain a manual `make smoke-test-prod` until the bootstrap registry lands.

The `smoke` job depends on `ci` (`needs: ci`) so it only runs if typecheck + unit tests pass first.

## Not in scope

- Integration credential bootstrap from env vars (see: Bootstrap Registry spec, depends on Service Config Convergence)
- Agent-dispatched smoke tests in CI (requires LLM keys + running sandbox)
- Production scheduled smoke tests (future: cron workflow after bootstrap registry)
- Staging-specific seed data with real emails (manual enrollment step)
