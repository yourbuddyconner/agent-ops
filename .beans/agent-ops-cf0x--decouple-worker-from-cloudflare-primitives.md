---
# agent-ops-cf0x
title: Decouple worker from Cloudflare primitives
status: todo
type: epic
priority: medium
tags:
    - worker
    - architecture
    - refactor
    - infrastructure
created_at: 2026-02-24T00:00:00Z
updated_at: 2026-02-24T00:00:00Z
---

Introduce platform abstraction interfaces so the worker package can run on Cloudflare Workers (current) or a standard Node/Bun runtime on Kubernetes, with the door open for other deployment targets. Rename `packages/worker` to `packages/gateway` to reflect its role as the API gateway regardless of host platform.

## Problem

The worker package is deeply coupled to Cloudflare through three fundamental choke points:

### 1. Durable Objects (~4,500 lines in SessionAgentDO alone)

Four DOs use CF-only APIs with no abstraction layer:

| DO | CF APIs Used |
|---|---|
| `SessionAgentDO` | `ctx.storage.sql.exec()`, `ctx.acceptWebSocket()` with hibernation, `ctx.setAlarm()`, `ctx.getWebSockets(tag)`, `WebSocketPair()`, `blockConcurrencyWhile()` |
| `EventBusDO` | `ctx.acceptWebSocket()`, `ctx.getWebSockets(tag)`, WebSocket hibernation hooks |
| `APIKeysDurableObject` | `state.storage.put/get/list/delete` (KV-style) |
| `WorkflowExecutorDO` | `DurableObjectState` + D1 access through `env.DB` |

DOs combine three concerns that are separate in other platforms:
- **Addressing** — `idFromName()` guarantees a single instance per key
- **Storage** — embedded SQLite or KV, colocated with compute
- **Compute** — WebSocket handling, alarms, request processing

There is no interface abstraction over any of these. The DO is the abstraction.

### 2. D1 Database (typed everywhere as `D1Database`)

All 28 DB service files in `src/lib/db/*.ts` import `D1Database` from `@cloudflare/workers-types`. Used both through Drizzle ORM (`drizzle-orm/d1`) and as raw SQL (`env.DB.prepare(...).bind(...).all()`). The cron handler in `index.ts` (lines 146–1127) is almost entirely raw D1 calls.

Drizzle already exists as a partial abstraction (`src/lib/drizzle.ts` wraps D1 via `drizzle-orm/d1`), but complex queries bypass it and hit D1 directly because they need dynamic WHERE clauses, `json_extract`, `ON CONFLICT`, or cursor-based pagination.

### 3. Platform Primitives (R2, Cron, WebSocketPair, Pages URL logic)

| Primitive | Where Used | Coupling Depth |
|---|---|---|
| R2 | `src/routes/files.ts` — list/get/put with `.writeHttpMetadata()` | Shallow, one file |
| Cron triggers | `index.ts` — `ExportedHandlerScheduledHandler<Env>` export | Medium, ~1000 lines of reconciliation logic |
| `WebSocketPair()` | SessionAgentDO, EventBusDO | Deep, integral to WS upgrade flow |
| `ctx.waitUntil()` | Cron handler, DOs | Medium, used for fire-and-forget |
| Pages preview CORS | `index.ts` — `*.pages.dev` origin matching | Shallow |
| Workers/Pages URL derivation | `src/lib/do-ws-url.ts` | Shallow |
| `nodejs_compat` flag | `wrangler.toml` | Config-only |

### Why this matters

1. **Deployment flexibility blocked.** Cannot deploy to Kubernetes, Fly.io, Railway, or any other platform without rewriting the worker.
2. **Self-hosted path blocked.** Users who want to run agent-ops on their own infrastructure cannot do so.
3. **Testing difficulty.** Unit testing requires mocking CF globals (`D1Database`, `DurableObjectState`, `WebSocketPair`). Portable interfaces enable in-memory test implementations.
4. **Vendor risk.** Single-provider dependency for the entire API layer.

## Current Architecture (What Exists)

### Hono Setup

Hono is used in generic mode (not `@hono/cloudflare-workers` adapter):

```typescript
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
```

Hono itself is multi-runtime — it runs on Node, Bun, Deno, and Workers. The CF coupling is in the `Env` type threaded through as `Bindings`, not in Hono itself.

### Env Interface (the coupling surface)

```typescript
// src/env.ts
import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  API_KEYS: DurableObjectNamespace;
  SESSIONS: DurableObjectNamespace;
  EVENT_BUS: DurableObjectNamespace;
  WORKFLOW_EXECUTOR: DurableObjectNamespace;
  DB: D1Database;
  STORAGE: R2Bucket;
  ENCRYPTION_KEY: string;
  // ... other secrets/vars
}
```

Every route handler, service function, and DO constructor receives `Env` or individual bindings from it. This interface is the single point where all CF dependencies converge.

### DB Access Pattern

Two coexisting approaches:

1. **Drizzle ORM** — `getDb(d1: D1Database)` returns a Drizzle instance using `drizzle-orm/d1`. Used for simple CRUD.
2. **Raw D1 SQL** — `db.prepare(sql).bind(...args).all()/.first()/.run()`. Used for complex queries with dynamic conditions, joins, aggregations.

Both take `D1Database` as parameter, not a generic interface.

### Entry Point Export

```typescript
// src/index.ts
export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
};
export { SessionAgentDO } from './durable-objects/session-agent';
// ... other DO exports
```

This is the CF Workers module format. A k8s deployment would use `Bun.serve({ fetch: app.fetch })` or equivalent.

## Design

### Portable Interface Layer

Introduce interfaces in `packages/shared` (or a new `packages/platform` package) that abstract the four CF-specific capabilities:

#### 1. Database Interface

```typescript
// Replace D1Database with a portable interface
interface DatabaseClient {
  // Drizzle-compatible — the primary path
  drizzle(): DrizzleDatabase;

  // Raw SQL escape hatch — for complex queries
  prepare(sql: string): PreparedStatement;
}

interface PreparedStatement {
  bind(...values: unknown[]): BoundStatement;
}

interface BoundStatement {
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
```

This matches the D1 API shape exactly, so the CF implementation is a thin wrapper. A Postgres/libsql/better-sqlite3 implementation satisfies the same interface.

#### 2. Object Storage Interface

```typescript
interface ObjectStorage {
  list(options: { prefix: string; limit?: number }): Promise<{ objects: StorageObject[] }>;
  get(key: string): Promise<StorageObjectBody | null>;
  put(key: string, body: ReadableStream | ArrayBuffer | string, options?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Implementations: R2 (current), S3/MinIO (k8s), filesystem (dev/test).

#### 3. PubSub / Real-Time Interface

```typescript
interface PubSub {
  publish(channel: string, event: unknown): Promise<void>;
  subscribe(channel: string, handler: (event: unknown) => void): Subscription;
}
```

This replaces the EventBusDO's role. Implementations: CF DO WebSockets (current), Redis Pub/Sub, or a dedicated WebSocket gateway (Soketi, Centrifugo).

#### 4. Scheduler Interface

```typescript
interface Scheduler {
  scheduleAt(timestamp: number, handler: string, payload: unknown): Promise<void>;
  scheduleCron(expression: string, handler: string): Promise<void>;
  cancel(id: string): Promise<void>;
}
```

Replaces DO alarms and cron triggers. Implementations: DO alarms (current), BullMQ delayed jobs, k8s CronJobs, Temporal.

### DO Decomposition Strategy

Each DO maps to a k8s-friendly replacement:

| Durable Object | What It Combines | K8s Replacement |
|---|---|---|
| **SessionAgentDO** | Single-writer state machine + embedded SQLite + WebSocket hub + alarms | Stateful service (1 pod per session) with external DB + native WS server + job queue for alarms |
| **EventBusDO** | Global WebSocket broadcast by userId tag | Redis Pub/Sub or dedicated WS gateway |
| **APIKeysDurableObject** | Per-user encrypted KV store | Vault/Sealed Secrets + CRUD service, or encrypted columns in the main DB |
| **WorkflowExecutorDO** | Per-execution coordinator with DO state + D1 access | Job queue (BullMQ, Temporal) or a simple coordinator service |

The critical insight: DOs provide **single-writer guarantees** (one instance per key, serialized access). On k8s, this must be replicated via:
- Distributed locks (Redis/etcd) for short-lived operations
- Session affinity (consistent hashing) for WebSocket routing
- Actor frameworks (e.g., Temporal activities) for complex state machines

### Package Rename

Rename `packages/worker` → `packages/gateway` to reflect its platform-agnostic role:

- Update `package.json` name: `@agent-ops/worker` → `@agent-ops/gateway`
- Update all cross-package imports
- Update `CLAUDE.md`, `Makefile`, deploy scripts
- Update wrangler.toml (still needed for CF deployments)
- The CF-specific entry point (`export default { fetch, scheduled }`) becomes one of multiple entry points

### Entry Point Strategy

```
packages/gateway/
├── src/
│   ├── app.ts              # Hono app setup (platform-agnostic)
│   ├── entry-cloudflare.ts # CF Workers entry: export { fetch, scheduled }
│   ├── entry-node.ts       # Node/Bun entry: Bun.serve({ fetch })
│   ├── platform/
│   │   ├── types.ts        # Platform interfaces (DB, Storage, PubSub, Scheduler)
│   │   ├── cloudflare.ts   # CF implementations (D1, R2, DO-backed PubSub, alarms)
│   │   └── node.ts         # Node implementations (libsql, S3, Redis, BullMQ)
│   └── ...existing src/
```

## Migration Strategy — Incremental, Not Big-Bang

### Phase 0: Introduce interfaces (no behavior changes)

**Goal:** Define the abstraction seam without changing any behavior.

- Create `DatabaseClient`, `ObjectStorage`, `PubSub`, `Scheduler` interfaces in `packages/shared` (or `packages/gateway/src/platform/types.ts`)
- Create a CF implementation module that wraps existing D1/R2/DO usage behind these interfaces
- Do NOT change any function signatures yet — just define the target contracts
- **Zero behavior change, zero risk**

### Phase 1: Abstract the database layer

**Goal:** Remove `D1Database` from all function signatures.

This is the highest-value change because D1 is the most broadly used CF primitive (28 files).

1. Change `src/lib/drizzle.ts` to accept a `DatabaseClient` instead of `D1Database`
2. Update all `src/lib/db/*.ts` files: replace `(db: D1Database, ...)` with `(db: DatabaseClient, ...)`
3. Wrap raw D1 calls through the `DatabaseClient.prepare()` interface
4. The CF implementation of `DatabaseClient` is a thin wrapper around `D1Database`
5. Add a `libsql` implementation (Turso or `better-sqlite3`) for local dev and k8s

**Why libsql:** SQLite wire compatibility means the 40 existing migrations and all raw SQL keep working. No query rewrites needed. Turso also offers an HTTP-accessible hosted option.

Estimated scope: ~28 files to update (mechanical — change the type and import).

**Dependency:** The [extract service layer bean (agent-ops-yj5t)](#) makes this easier by first consolidating DB access into service files. Consider doing yj5t first or in parallel.

### Phase 2: Abstract object storage

**Goal:** Remove `R2Bucket` from `Env`.

- Replace `c.env.STORAGE` usage in `src/routes/files.ts` with an `ObjectStorage` interface
- Remove `R2Bucket` from `Env`, replace with `ObjectStorage`
- CF implementation wraps R2; k8s implementation wraps S3 SDK

Estimated scope: 1 file (`files.ts`) + env type update. Smallest change in the whole plan.

### Phase 3: Abstract real-time / PubSub

**Goal:** Replace EventBusDO access pattern with a `PubSub` interface.

- Define `PubSub` interface
- Create CF implementation that internally does the current `EVENT_BUS.idFromName('global').get().fetch('/publish', ...)` pattern
- Routes and services call `pubsub.publish(channel, event)` instead of constructing DO stubs
- CF implementation: wraps EventBusDO (no change to the DO itself)
- K8s implementation: Redis Pub/Sub or Centrifugo

Estimated scope: ~10 call sites across routes and SessionAgentDO.

### Phase 4: Abstract scheduling

**Goal:** Replace cron triggers and DO alarms with a `Scheduler` interface.

- Extract the ~1000-line cron handler from `index.ts` into a `src/jobs/` directory with individual job functions
- Create CF implementation: cron trigger calls job functions; DO alarms for per-session timers
- K8s implementation: k8s CronJobs for periodic work; BullMQ delayed jobs for per-session timers
- This is where the cron handler's `ExportedHandlerScheduledHandler` export gets isolated behind the platform layer

Estimated scope: Large refactor of `index.ts` cron handler + SessionAgentDO alarm logic.

### Phase 5: Decompose SessionAgentDO

**Goal:** Extract SessionAgentDO's responsibilities into portable services.

This is the hardest phase. SessionAgentDO is a 4,500-line god object that combines:
- Per-session state machine (status transitions)
- Embedded SQLite tables (messages, questions, prompt_queue, etc.)
- WebSocket hub (runner + client connections, hibernation)
- Alarm-driven timers (idle timeout, question expiry, watchdog)
- D1 writes (session status, message persistence)
- EventBus publishing
- Runner proxy (`/proxy/*` → OpenCode HTTP)

Decomposition:

1. **SessionStateService** — State machine logic, status transitions. Uses `DatabaseClient` for persistence. No WebSocket or timer dependencies.
2. **SessionMessageStore** — Message CRUD, parts handling, history queries. Currently in DO SQLite; moves to main DB or a dedicated store.
3. **SessionWebSocketHub** — WebSocket upgrade, hibernation, message routing. This is the piece that needs platform-specific implementations (CF DO WS vs. native `ws` library).
4. **SessionTimerService** — Idle timeout, question expiry, watchdog. Uses `Scheduler` interface.

The CF implementation keeps the DO as the glue that wires these services together. The k8s implementation replaces the DO with a stateful pod or actor.

### Phase 6: Rename and restructure

**Goal:** `packages/worker` → `packages/gateway` with multiple entry points.

- Rename package directory and `package.json`
- Create `entry-cloudflare.ts` (current behavior) and `entry-node.ts` (new)
- Update all cross-package imports, `CLAUDE.md`, `Makefile`, deploy scripts
- CF deployment continues to use `wrangler deploy`
- K8s deployment uses a Dockerfile that runs `bun entry-node.ts`

## Relationship to Other Beans

- **agent-ops-yj5t (Extract service layer)** — Should be done first or in parallel with Phase 1. Consolidating DB access into service files makes the database abstraction cleaner.
- **agent-ops-k8rt (Multi-runtime sandbox abstraction)** — Complementary. That bean abstracts the sandbox runtime (Modal vs K8s). This bean abstracts the gateway runtime (CF Workers vs K8s). Together they fully decouple agent-ops from any single cloud provider.
- **agent-ops-xc0m (Plugin system)** — Plugin SDK interfaces should be defined against the portable interfaces, not CF-specific types, so plugins work regardless of deployment target.

## Open Questions

1. **libsql vs. Postgres?** libsql (Turso) preserves SQLite compatibility — all 40 migrations and raw SQL work unchanged. Postgres is more conventional for k8s deployments but requires rewriting SQLite-specific SQL (`json_extract`, `datetime('now')`, etc.). Recommendation: libsql for Phase 1, Postgres adapter as a later option.

2. **SessionAgentDO decomposition granularity.** Do we fully decompose into 4 services (Phase 5), or create a single `SessionManager` class that encapsulates all four concerns behind a clean interface? The latter is less work but still couples the four concerns.

3. **DO SQLite data migration.** SessionAgentDO stores messages and questions in embedded DO SQLite. On k8s, this data needs to live elsewhere (main DB, Redis, or a per-session SQLite file on a PVC). What's the migration path for existing sessions?

4. **WebSocket hibernation equivalent.** CF DO hibernation lets WebSocket connections survive across DO sleep/wake cycles without holding memory. On k8s, WebSocket connections are tied to pod lifetime. Options: accept reconnection on pod restart (simpler), or use a WebSocket gateway that decouples connection lifetime from backend pods (more complex).

5. **Single-writer guarantee.** DOs guarantee serialized access per key. On k8s, concurrent requests to the same session could race. Options: Redis distributed locks, session-affinity routing, or an actor framework.

6. **Rename timing.** Renaming `worker` → `gateway` touches every import and deploy script. Should this happen first (clean break) or last (after all abstractions are in place)?

## Acceptance Criteria

- [ ] Platform interfaces defined: `DatabaseClient`, `ObjectStorage`, `PubSub`, `Scheduler`
- [ ] Cloudflare implementations of all interfaces (wrapping existing D1/R2/DO/cron)
- [ ] No `D1Database` import in any file outside `platform/cloudflare.ts`
- [ ] No `R2Bucket` import in any file outside `platform/cloudflare.ts`
- [ ] No `DurableObjectNamespace` import in any file outside `platform/cloudflare.ts` and DO files
- [ ] Cron handler logic extracted into portable job functions
- [ ] Node/Bun entry point exists and boots the Hono app with non-CF implementations
- [ ] `packages/worker` renamed to `packages/gateway`
- [ ] All cross-package imports updated
- [ ] `pnpm typecheck` passes
- [ ] Existing CF deployment works unchanged (no regression)
- [ ] At least one non-CF implementation (libsql + filesystem storage) boots and serves API requests
