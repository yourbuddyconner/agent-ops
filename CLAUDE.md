# CLAUDE.md — Agent-Ops Development Guide

## What This Project Is

Agent-Ops is a hosted background coding agent platform. Users interact with an AI coding agent through a web UI or Slack. Each session runs in an isolated Modal sandbox with a full dev environment (VS Code, browser via VNC, terminal, and an OpenCode agent). The architecture is modeled after Ramp's Inspect system.

Read `V1.md` for the full architecture specification, all decisions, and implementation phases.

## Task Tracking with Beans

This project uses **beans** for task tracking. Beans stores issues as markdown files in `.beans/`.

### Starting a Session

Every session should begin by checking for work:

```bash
# 1. Check for in-progress beans first (finish what's started)
beans list -s in-progress

# 2. If none in-progress, list todo beans by priority
beans list -s todo --sort priority

# 3. Read the top bean to understand the task
beans show <id>
```

**If a bean is in-progress**, finish it before starting anything new. Read it with `beans show <id>`, understand what's left, and complete it.

**If no beans are in-progress**, pick the highest-priority todo bean, mark it in-progress, and start working:

```bash
beans update <id> -s in-progress
```

### While Working

- **When done with a bean**: `beans update <id> -s completed`
- **If a task is no longer needed**: `beans update <id> -s scrapped`
- **If you discover sub-work needed**: Create child beans with `--parent`:
  ```bash
  beans create "Sub-task title" -t task -p high --parent <parent-id> -d "Description"
  ```
- **If a bean blocks another**: Use `--blocking <other-id>` on create or update
- **To add notes/context to a bean**: `beans update <id> -d "Updated description with findings"`

### Bean Conventions

- **Types**: `milestone` (phase), `epic` (large feature), `feature` (user-facing), `task` (implementation unit), `bug`
- **Priorities**: `critical`, `high`, `normal`, `low`, `deferred`
- **Statuses**: `todo`, `in-progress`, `completed`, `scrapped`, `draft`
- Keep bean titles short and imperative ("Build SessionAgent DO", not "Building the session agent")
- Bean bodies should include acceptance criteria — what does "done" look like?
- Tag beans with the layer they affect: `--tag worker`, `--tag frontend`, `--tag runner`, `--tag backend`, `--tag sandbox`

### Viewing Progress

```bash
beans list                          # All active beans
beans list -s completed             # Done beans
beans list --tag worker             # Beans for a specific layer
beans roadmap                       # Milestone/epic overview
```

## Project Structure

```
agent-ops/
├── packages/
│   ├── client/          # React SPA (Vite + TanStack Router + Query + Zustand)
│   ├── worker/          # Cloudflare Worker (Hono + D1 + R2 + Durable Objects)
│   ├── shared/          # Shared TypeScript types & errors
│   └── runner/          # [TO BUILD] Bun/TS runner for inside sandboxes
├── backend/             # [TO BUILD] Modal Python backend
├── docker/              # [TO BUILD] Sandbox Dockerfile + start.sh
├── V1.md                # Full architecture spec (READ THIS FIRST)
├── WORKFLOW_PLUGIN_SPEC.md  # Workflow engine spec
├── Makefile             # Dev, test, deploy commands
├── docker-compose.yml   # Local dev (OpenCode container)
└── .beans/              # Task tracking (beans)
```

## Tech Stack Quick Reference

| Layer | Tech | Key Files |
|-------|------|-----------|
| Frontend | React 19, Vite 6, TanStack Router/Query, Zustand, Tailwind, Radix UI | `packages/client/src/` |
| Worker | Cloudflare Workers, Hono 4, D1 (SQLite), R2, Durable Objects | `packages/worker/src/` |
| Shared | TypeScript types, error classes | `packages/shared/src/` |
| Runner | Bun, TypeScript, `@opencode-ai/sdk`, Hono | `packages/runner/src/` |
| Backend | Python 3.12, Modal SDK | `backend/` |
| Sandbox | OpenCode serve, code-server, Xvfb+VNC, TTYD | `docker/` |

## Key Architectural Decisions

These are decided and locked in. Do not revisit:

1. **WebSocket only** between Runner and SessionAgent DO. No HTTP callbacks.
2. **Single merged SessionAgent DO** replaces both old `AgentSessionDurableObject` and `OpenCodeContainerDO`. Old code is deleted.
3. **Single Modal App** for the Python backend (structured for future split).
4. **Repo-specific images** from day one. Base image fallback for unconfigured repos.
5. **iframes** for VNC (websockify noVNC web UI) and Terminal (TTYD web UI). No embedded JS clients for V1.
6. **Single auth gateway proxy** on port 9000 in sandbox. Routes `/vscode/*`, `/vnc/*`, `/ttyd/*` to internal services. JWT validation.
7. **Full Slack App** with Inspect parity (slash commands, Events API, repo classifier, thread updates, interactive components).

## Development Commands

```bash
# Install dependencies
pnpm install

# Run locally (3 terminals or use Makefile)
make dev-worker         # Cloudflare Worker on :8787
make dev-opencode       # OpenCode container on :4096
cd packages/client && pnpm dev  # Frontend on :5173

# Or all at once:
make dev-all

# Database
make db-migrate         # Run D1 migrations locally
make db-seed            # Seed test data

# Typecheck
pnpm typecheck          # All packages
cd packages/worker && pnpm typecheck  # Single package

# Deploy
make deploy             # Deploy worker to Cloudflare
```

## Code Conventions

### Worker (Hono)

- Routes go in `packages/worker/src/routes/<name>.ts`
- Each route file exports a Hono router: `export const fooRouter = new Hono<{ Bindings: Env; Variables: Variables }>()`
- Route is mounted in `index.ts`: `app.route('/api/foo', fooRouter)`
- DB helpers go in `packages/worker/src/lib/db.ts` — cursor-based pagination, camelCase conversion
- Durable Objects go in `packages/worker/src/durable-objects/<name>.ts` — export the class and re-export from `index.ts`
- Services go in `packages/worker/src/services/<name>.ts`
- Auth middleware at `packages/worker/src/middleware/auth.ts` — sets `c.get('user')` with `{ id, email }`
- Errors use classes from `@agent-ops/shared`: `UnauthorizedError`, `NotFoundError`, `ValidationError`
- All API responses are JSON. Error format: `{ error, code, requestId }`
- Wrangler config in `packages/worker/wrangler.toml` — DO bindings, D1, R2, cron triggers
- Migrations in `packages/worker/migrations/` — numbered `0001_name.sql`, `0002_name.sql`, etc.

### Frontend (React)

- File-based routing via TanStack Router: `packages/client/src/routes/`
- API layer in `packages/client/src/api/` — one file per resource with query key factories
- API client at `packages/client/src/api/client.ts` — centralized fetch with auth header injection
- Components at `packages/client/src/components/<feature>/`
- Hooks at `packages/client/src/hooks/`
- Stores (Zustand) at `packages/client/src/stores/`
- UI primitives at `packages/client/src/components/ui/` — Radix-based
- Pattern: query key factories per resource (`sessionKeys.all`, `sessionKeys.detail(id)`, etc.)
- Pattern: `PageContainer` + `PageHeader` for page layout
- Pattern: Skeleton loaders for every list component

### Shared Types

- All shared types in `packages/shared/src/types/index.ts`
- Errors in `packages/shared/src/errors.ts`
- When adding a new entity, add types here first, then use in both worker and client

### Runner (TO BUILD)

- Runtime: Bun
- Entry: `packages/runner/src/bin.ts`
- WebSocket to DO: `packages/runner/src/agent-client.ts`
- OpenCode interaction: `packages/runner/src/prompt.ts`
- Event stream: `packages/runner/src/events.ts`
- Auth gateway: `packages/runner/src/gateway.ts` (Hono on port 9000)

### Backend (TO BUILD)

- Python 3.12, Modal SDK
- Entry: `backend/app.py` (Modal App with web endpoints)
- Session management: `backend/session.py`
- Sandbox lifecycle: `backend/sandboxes.py`
- Image definitions: `backend/images/base.py`, `backend/images/webapp.py`, `backend/images/core.py`

### Git Conventions

- Commit code upon completion of each bean.
- Do NOT add "Co-Authored-by" trailers mentioning AI models (e.g., Opus, Claude) in commit messages

## Implementation Phases (from V1.md)

**Phase 1 — Core Sandbox Runtime**: Delete old DOs, build SessionAgentDO, Python backend, Runner, sandbox Dockerfile, end-to-end session flow.

**Phase 2 — Full Dev Environment**: code-server + VNC + TTYD in sandbox, auth gateway, JWT issuance, iframe panels in frontend, session editor page.

**Phase 3 — Real-Time & Multiplayer**: EventBus DO, user-tagged WebSockets, question handling, prompt queuing, collaborator UI.

**Phase 4 — Integrations**: GitHub OAuth, Slack App (full Inspect parity), Linear OAuth.

**Phase 5 — Cost Management**: Usage tracking, concurrency limits, budgets, alerts.

**Phase 6 — Optimization**: Image build pipeline, warm pools, snapshots, screenshots, memories, dashboard.

## What to Delete

The following existing code must be deleted (per architectural decisions) and replaced:

- `packages/worker/src/durable-objects/agent-session.ts` — replaced by new `SessionAgentDO`
- `packages/worker/src/durable-objects/opencode-container.ts` — replaced by new `SessionAgentDO`
- `packages/worker/src/services/modal-service.ts` — replaced by Python backend

Do NOT delete these until their replacements are built and working. Delete as part of Phase 1.

## Common Patterns

### Adding a new D1 table

1. Create migration: `packages/worker/migrations/NNNN_name.sql`
2. Add types to `packages/shared/src/types/index.ts`
3. Add DB helpers to `packages/worker/src/lib/db.ts`
4. Add API routes to `packages/worker/src/routes/<name>.ts`
5. Mount in `packages/worker/src/index.ts`
6. Add React Query hooks in `packages/client/src/api/<name>.ts`
7. Run `make db-migrate`

### Adding a new Durable Object

1. Create class in `packages/worker/src/durable-objects/<name>.ts`
2. Re-export from `packages/worker/src/index.ts`
3. Add binding to `packages/worker/wrangler.toml` (durable_objects.bindings + migrations)
4. Add type to `packages/worker/src/env.ts` Env interface
5. Use in routes via `c.env.BINDING_NAME.idFromName(...)`

### Adding a frontend route

1. Create route file at `packages/client/src/routes/<path>.tsx`
2. TanStack Router auto-generates route tree on dev server restart
3. Add navigation link to sidebar at `packages/client/src/components/layout/sidebar.tsx`
