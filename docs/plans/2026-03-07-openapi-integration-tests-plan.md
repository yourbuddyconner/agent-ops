# OpenAPI + Integration Test Harness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all Hono routes to `@hono/zod-openapi` with full OpenAPI spec generation, Swagger UI docs, and a typed Vitest integration test harness.

**Architecture:** Every route file switches from `new Hono()` to `new OpenAPIHono()` with `createRoute()` definitions. Existing Zod request schemas are reused; new Zod response schemas are added. The spec is served at `/api/openapi.json`, docs at `/api/docs`. A generated typed client (`openapi-typescript` + `openapi-fetch`) powers Vitest integration tests in `tests/integration/`.

**Tech Stack:** `@hono/zod-openapi`, `@hono/swagger-ui`, `openapi-typescript`, `openapi-fetch`, Vitest

**Design doc:** `docs/plans/2026-03-07-openapi-integration-tests-design.md`

---

## Reference: The Migration Pattern

Every route file follows this exact transformation. This section documents the pattern once; tasks reference it.

### Before (current pattern)

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../env.js';

export const fooRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET with manual query params
fooRouter.get('/', async (c) => {
  const { limit, cursor } = c.req.query();
  const result = await doList(parseInt(limit || '50'), cursor);
  return c.json({ items: result });
});

// POST with zValidator
const createSchema = z.object({ name: z.string().min(1) });

fooRouter.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const result = await doCreate(body);
  return c.json(result, 201);
});

// DELETE with path param
fooRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await doDelete(id);
  return c.json({ success: true });
});
```

### After (OpenAPI pattern)

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Env, Variables } from '../env.js';
import { errorResponse, successResponse } from '../lib/openapi-schemas.js';

export const fooRouter = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// --- Schemas ---

const createSchema = z.object({
  name: z.string().min(1).openapi({ example: 'My Item' }),
});

const itemSchema = z.object({
  id: z.string().openapi({ example: 'abc-123' }),
  name: z.string(),
  createdAt: z.string(),
});

// --- Routes ---

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Foo'],
  summary: 'List items',
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ example: '50' }),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: successResponse(z.object({ items: z.array(itemSchema) }), 'Item list'),
  },
});

const createItemRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Foo'],
  summary: 'Create item',
  request: {
    body: { content: { 'application/json': { schema: createSchema } } },
  },
  responses: {
    201: successResponse(itemSchema, 'Created'),
    400: errorResponse('Validation error'),
  },
});

const deleteItemRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Foo'],
  summary: 'Delete item',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(z.object({ success: z.boolean() }), 'Deleted'),
    404: errorResponse('Not found'),
  },
});

// --- Handlers ---

fooRouter.openapi(listRoute, async (c) => {
  const { limit, cursor } = c.req.valid('query');
  const result = await doList(parseInt(limit || '50'), cursor);
  return c.json({ items: result }, 200);
});

fooRouter.openapi(createItemRoute, async (c) => {
  const body = c.req.valid('json');
  const result = await doCreate(body);
  return c.json(result, 201);
});

fooRouter.openapi(deleteItemRoute, async (c) => {
  const { id } = c.req.valid('param');
  await doDelete(id);
  return c.json({ success: true }, 200);
});
```

### Key transformation rules

1. **Import:** `Hono` → `OpenAPIHono`, add `createRoute`, import `z` from `@hono/zod-openapi` instead of `zod`
2. **Router:** `new Hono<...>()` → `new OpenAPIHono<...>()`
3. **Path params:** `:id` in path → `{id}` in `createRoute`, but keep `:id` in `.openapi()` handler's `c.req.valid('param')`
4. **Query params:** `c.req.query()` → `c.req.valid('query')` with a Zod schema in `request.query`
5. **Body:** Remove `zValidator('json', schema)` middleware; put schema in `request.body.content['application/json'].schema`
6. **Path params extraction:** `c.req.param('id')` → `c.req.valid('param').id`
7. **Handler:** `router.get(path, handler)` → `router.openapi(routeDef, handler)`
8. **Response status:** Always pass explicit status code to `c.json(data, 200)` — the OpenAPI types require it
9. **Non-JSON responses** (WebSocket upgrades, SSE, binary): Keep as regular `.get()` — not every endpoint needs OpenAPI
10. **Tags:** Group by resource name (Sessions, Workflows, Triggers, etc.)

---

## Task 1: Install Dependencies + Create Shared OpenAPI Schemas

**Files:**
- Modify: `packages/worker/package.json`
- Create: `packages/worker/src/lib/openapi-schemas.ts`

**Step 1: Install dependencies**

```bash
cd packages/worker && pnpm add @hono/zod-openapi @hono/swagger-ui
```

**Step 2: Create shared OpenAPI schema helpers**

Create `packages/worker/src/lib/openapi-schemas.ts`:

```typescript
import { z } from '@hono/zod-openapi';

// Shared error response schema — matches error-handler.ts output
export const ErrorSchema = z.object({
  error: z.string().openapi({ example: 'Not found' }),
  code: z.string().openapi({ example: 'NOT_FOUND' }),
  requestId: z.string().optional().openapi({ example: 'req-abc-123' }),
  details: z.unknown().optional(),
});

// Shared success: { success: true }
export const SuccessSchema = z.object({
  success: z.boolean().openapi({ example: true }),
});

// Helper to create a JSON response definition
export function successResponse(schema: z.ZodType, description: string) {
  return {
    content: { 'application/json': { schema } },
    description,
  };
}

// Helper to create an error response definition
export function errorResponse(description: string) {
  return {
    content: { 'application/json': { schema: ErrorSchema } },
    description,
  };
}

// Common query param schemas
export const PaginationQuery = z.object({
  limit: z.string().optional().openapi({ example: '50' }),
  cursor: z.string().optional(),
});

export const IdParam = z.object({
  id: z.string().openapi({ example: 'abc-123' }),
});
```

**Step 3: Verify it compiles**

```bash
cd packages/worker && pnpm typecheck
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add @hono/zod-openapi deps and shared schemas"
```

---

## Task 2: Migrate `index.ts` to OpenAPIHono + Add Spec/Docs Endpoints

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Change app instantiation**

Replace:
```typescript
import { Hono } from 'hono';
```
With:
```typescript
import { OpenAPIHono } from '@hono/zod-openapi';
```

Replace:
```typescript
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
```
With:
```typescript
const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
```

**Step 2: Add OpenAPI spec + Swagger UI endpoints**

After all route mounts but before the 404 handler, add:

```typescript
import { swaggerUI } from '@hono/swagger-ui';

// OpenAPI spec
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Valet API',
    version: '1.0.0',
    description: 'Valet — hosted background coding agent platform',
  },
  servers: [
    { url: 'http://localhost:8787', description: 'Local development' },
  ],
});

// Swagger UI
app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));
```

**Step 3: Register Bearer auth security scheme**

After creating the app, before middleware:

```typescript
app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  description: 'API key (sk_...) or session token',
});
```

**Step 4: Verify it compiles and spec is served**

```bash
cd packages/worker && pnpm typecheck
```

Note: Child routers that still use `Hono` will work fine with `app.route()` — OpenAPIHono extends Hono and `.route()` accepts Hono instances. Routes will be served but won't appear in the spec until migrated.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: migrate index.ts to OpenAPIHono, add /api/docs and /api/openapi.json"
```

---

## Task 3: Migrate Simple Routes (api-keys, usage, dashboard, plugins)

These are the smallest route files with 2-5 endpoints each.

**Files:**
- Modify: `packages/worker/src/routes/api-keys.ts` (3 endpoints)
- Modify: `packages/worker/src/routes/usage.ts` (1 endpoint)
- Modify: `packages/worker/src/routes/dashboard.ts` (2 endpoints)
- Modify: `packages/worker/src/routes/plugins.ts`

**For each file, apply the migration pattern from the Reference section above:**

1. Change `import { Hono }` → `import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'`
2. Remove `import { zValidator } from '@hono/zod-validator'` and `import { z } from 'zod'`
3. Change `new Hono<...>()` → `new OpenAPIHono<...>()`
4. For each endpoint:
   a. Define a `createRoute()` with method, path (using `{param}` syntax), tags, request schemas, response schemas
   b. Replace `.get()/.post()/.delete()` with `.openapi(routeDef, handler)`
   c. Replace `c.req.param('x')` with `c.req.valid('param').x`
   d. Replace `c.req.query()` with `c.req.valid('query')` + add query schema to route
   e. Remove `zValidator()` middleware from handler chain
   f. Add explicit status code to every `c.json()` call
5. Add response Zod schemas for every endpoint's success response

### api-keys.ts specifics

Tags: `['API Keys']`

Schemas to add:
```typescript
const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

const apiKeyWithTokenSchema = apiKeySchema.extend({
  token: z.string(),
});
```

Routes:
- `GET /` → response `{ keys: apiKeySchema[] }`
- `POST /` → request body `createKeySchema`, response 201 `apiKeyWithTokenSchema`
- `DELETE /{id}` → params `IdParam`, response `SuccessSchema`

### usage.ts specifics

Tags: `['Usage']`

Route:
- `GET /stats` → query `{ period: string? }`, response with usage stats object

### dashboard.ts specifics

Tags: `['Dashboard']`

Routes:
- `GET /stats` → query `{ period?, unit? }`, response with dashboard stats
- `GET /adoption` → query `{ period? }`, response with adoption metrics

### plugins.ts specifics

Tags: `['Plugins']`

Read the file first to determine exact endpoints, then apply the pattern.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate api-keys, usage, dashboard, plugins routes"
```

---

## Task 4: Migrate Admin Routes (admin, action-policies, disabled-actions, org-repos)

**Files:**
- Modify: `packages/worker/src/routes/admin.ts`
- Modify: `packages/worker/src/routes/action-policies.ts`
- Modify: `packages/worker/src/routes/disabled-actions.ts`
- Modify: `packages/worker/src/routes/org-repos.ts`

Tags: `['Admin']`, `['Action Policies']`, `['Disabled Actions']`, `['Organization Repos']`

Apply the standard migration pattern. These routes all require admin role — add `security: [{ Bearer: [] }]` to each route definition.

### admin.ts specifics

~15 endpoints covering org settings, LLM keys, invites, users, custom providers. Group sub-resources with tags:
- Org settings: `['Admin']`
- LLM keys: `['Admin', 'LLM Keys']`
- Invites: `['Admin', 'Invites']`
- Users: `['Admin', 'Users']`
- Custom providers: `['Admin', 'Custom Providers']`

### action-policies.ts specifics

3 endpoints: GET /, PUT /{id}, DELETE /{id}

### disabled-actions.ts specifics

2 endpoints: GET /, PUT /{service}

### org-repos.ts specifics

Two routers exported: `orgReposAdminRouter` (admin) and `orgReposReadRouter` (read). Migrate both.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate admin, action-policies, disabled-actions, org-repos routes"
```

---

## Task 5: Migrate Workflow Routes (workflows, triggers, executions)

**Files:**
- Modify: `packages/worker/src/routes/workflows.ts` (~13 endpoints)
- Modify: `packages/worker/src/routes/triggers.ts` (~9 endpoints)
- Modify: `packages/worker/src/routes/executions.ts` (~7 endpoints)

Tags: `['Workflows']`, `['Triggers']`, `['Executions']`

### workflows.ts specifics

Complex schemas already defined. Key additions:
- Response schema for workflow object
- Response schema for proposal object
- Proposal review/apply response schemas

### triggers.ts specifics

Has discriminated union configs (`webhookConfigSchema`, `scheduleConfigSchema`, `manualConfigSchema`). These should be converted to use `z` from `@hono/zod-openapi` instead of `zod`.

### executions.ts specifics

Response schemas for execution objects and step arrays.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate workflows, triggers, executions routes"
```

---

## Task 6: Migrate Session Routes (sessions, tasks, files, events)

**Files:**
- Modify: `packages/worker/src/routes/sessions.ts` (~25 endpoints)
- Modify: `packages/worker/src/routes/tasks.ts` (~4 endpoints)
- Modify: `packages/worker/src/routes/files.ts` (~7 endpoints)
- Modify: `packages/worker/src/routes/events.ts`

Tags: `['Sessions']`, `['Tasks']`, `['Files']`, `['Events']`

### sessions.ts specifics

This is the largest route file (~600 lines). Key considerations:
- **WebSocket endpoint** (`GET /:id/ws`): Keep as regular `.get()` — WebSocket upgrades can't be documented in OpenAPI
- **SSE endpoint** (`GET /:id/events`): Keep as regular `.get()` — streaming responses are not standard OpenAPI
- All other endpoints get full OpenAPI definitions
- Complex response schemas needed for session objects, messages, participants, share links, etc.

### tasks.ts specifics

4 endpoints nested under `/api/sessions/:sessionId/tasks`. Path param is `sessionId`, not `id`.

### files.ts specifics

File backup download (`GET /backup/:key`) returns binary — keep as regular `.get()`. Other endpoints get OpenAPI definitions.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate sessions, tasks, files, events routes"
```

---

## Task 7: Migrate User Routes (auth, orchestrator, personas, mailbox, channels)

**Files:**
- Modify: `packages/worker/src/routes/auth.ts` (~6 endpoints)
- Modify: `packages/worker/src/routes/orchestrator.ts` (~20+ endpoints)
- Modify: `packages/worker/src/routes/personas.ts` (~8 endpoints)
- Modify: `packages/worker/src/routes/mailbox.ts` (~3 endpoints)
- Modify: `packages/worker/src/routes/channels.ts` (1 endpoint)

Tags: `['Auth']`, `['Orchestrator']`, `['Memory']`, `['Notifications']`, `['Personas']`, `['Mailbox']`, `['Channels']`

### orchestrator.ts specifics

This is the second-largest file. Sub-group with tags:
- Orchestrator management: `['Orchestrator']`
- Memory CRUD: `['Memory']`
- Notifications: `['Notifications']`
- Identity links: `['Identity Links']`
- Org agents: `['Orchestrator']`

### personas.ts specifics

File management sub-routes (`PUT /:id/files`, `POST /:id/files`, `DELETE /:id/files/:fileId`) need nested param schemas.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate auth, orchestrator, personas, mailbox, channels routes"
```

---

## Task 8: Migrate External/Integration Routes (integrations, repos, action-invocations, invites)

**Files:**
- Modify: `packages/worker/src/routes/integrations.ts` (~8 endpoints)
- Modify: `packages/worker/src/routes/repos.ts` (~5 endpoints)
- Modify: `packages/worker/src/routes/action-invocations.ts` (~5 endpoints)
- Modify: `packages/worker/src/routes/invites.ts`

Tags: `['Integrations']`, `['Repos']`, `['Action Invocations']`, `['Invites']`

### integrations.ts specifics

OAuth redirect endpoints (`GET /:service/oauth`, `POST /:service/oauth/callback`) return redirects/tokens. Document the JSON responses.

### repos.ts specifics

Nested path params: `GET /:owner/:repo/pulls`, `GET /:owner/:repo/issues`.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate integrations, repos, action-invocations, invites routes"
```

---

## Task 9: Migrate Platform Routes (slack, telegram, webhooks, oauth, og, channel-webhooks, slack-events)

**Files:**
- Modify: `packages/worker/src/routes/slack.ts`
- Modify: `packages/worker/src/routes/telegram.ts`
- Modify: `packages/worker/src/routes/webhooks.ts`
- Modify: `packages/worker/src/routes/oauth.ts`
- Modify: `packages/worker/src/routes/og.ts`
- Modify: `packages/worker/src/routes/channel-webhooks.ts`
- Modify: `packages/worker/src/routes/slack-events.ts`

Tags: `['Slack']`, `['Telegram']`, `['Webhooks']`, `['OAuth']`, `['OG']`

These are mostly webhook receivers and OAuth flows. Some may have minimal value in OpenAPI (webhook receivers are called by external platforms, not API consumers). Migrate to OpenAPIHono routers for consistency, but it's acceptable to keep webhook handler endpoints as regular `.post()` if their schemas are complex/dynamic.

**Verify and commit:**

```bash
cd packages/worker && pnpm typecheck
git add -A && git commit -m "feat(openapi): migrate slack, telegram, webhooks, oauth, og routes"
```

---

## Task 10: Migrate Agent Route + Final Typecheck

**Files:**
- Modify: `packages/worker/src/routes/agent.ts`

Migrate the agent gateway router. Then do a full typecheck across all packages:

```bash
pnpm typecheck
```

Fix any remaining type errors. Start the dev worker and verify:

```bash
cd packages/worker && pnpm dev
# In another terminal:
curl http://localhost:8787/api/openapi.json | jq '.paths | keys | length'
# Should show the total number of documented paths
curl http://localhost:8787/api/docs
# Should return Swagger UI HTML
```

**Commit:**

```bash
git add -A && git commit -m "feat(openapi): migrate agent route, full typecheck pass"
```

---

## Task 11: Set Up Integration Test Infrastructure

**Files:**
- Create: `tests/integration/vitest.config.ts`
- Create: `tests/integration/setup.ts`
- Create: `tests/integration/client/index.ts`
- Modify: `package.json` (root — add devDependencies and script)

**Step 1: Install test dependencies at the root**

```bash
pnpm add -Dw openapi-typescript openapi-fetch vitest
```

**Step 2: Create Vitest config**

Create `tests/integration/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    globalSetup: './setup.ts',
    testTimeout: 30_000,
    hookTimeout: 15_000,
    sequence: {
      concurrent: false, // Run test files sequentially (some tests depend on created resources)
    },
  },
});
```

**Step 3: Create global setup**

Create `tests/integration/setup.ts`:

```typescript
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const API_TOKEN = process.env.API_TOKEN || 'test-api-token-12345';

export async function setup() {
  // Health check
  const healthRes = await fetch(`${WORKER_URL}/health`);
  if (!healthRes.ok) {
    throw new Error(`Worker not reachable at ${WORKER_URL}/health — is it running?`);
  }

  // Auth check
  const authRes = await fetch(`${WORKER_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!authRes.ok) {
    throw new Error(`API token invalid — got ${authRes.status} from /api/auth/me`);
  }

  console.log(`Integration tests: worker=${WORKER_URL}, user authenticated`);
}
```

**Step 4: Create typed API client**

Create `tests/integration/client/index.ts`:

```typescript
import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const API_TOKEN = process.env.API_TOKEN || 'test-api-token-12345';

export const client = createClient<paths>({
  baseUrl: WORKER_URL,
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});
```

**Step 5: Generate the typed schema**

Add to root `package.json` scripts:

```json
"generate:api-client": "openapi-typescript http://localhost:8787/api/openapi.json -o tests/integration/client/schema.d.ts"
```

Run it (worker must be running):

```bash
cd packages/worker && pnpm dev &
sleep 3
pnpm generate:api-client
kill %1
```

**Step 6: Verify the generated schema has content**

```bash
wc -l tests/integration/client/schema.d.ts
# Should be hundreds of lines
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add integration test infrastructure with typed OpenAPI client"
```

---

## Task 12: Write Smoke Tests

**Files:**
- Create: `tests/integration/smoke.test.ts`

The smoke test hits every list/read endpoint once to verify the API is responding. No mutations. Should complete in < 30 seconds.

```typescript
import { describe, it, expect } from 'vitest';
import { client } from './client/index.js';

describe('smoke tests', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${process.env.WORKER_URL || 'http://localhost:8787'}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('GET /api/auth/me returns user', async () => {
    const { data, error } = await client.GET('/api/auth/me');
    expect(error).toBeUndefined();
    expect(data?.user).toBeDefined();
    expect(data?.user?.email).toBeTruthy();
  });

  it('GET /api/sessions returns list', async () => {
    const { data, error } = await client.GET('/api/sessions');
    expect(error).toBeUndefined();
    expect(data?.sessions).toBeDefined();
  });

  it('GET /api/workflows returns list', async () => {
    const { data, error } = await client.GET('/api/workflows');
    expect(error).toBeUndefined();
    expect(data?.workflows).toBeDefined();
  });

  it('GET /api/triggers returns list', async () => {
    const { data, error } = await client.GET('/api/triggers');
    expect(error).toBeUndefined();
    expect(data?.triggers).toBeDefined();
  });

  it('GET /api/api-keys returns list', async () => {
    const { data, error } = await client.GET('/api/api-keys');
    expect(error).toBeUndefined();
    expect(data?.keys).toBeDefined();
  });

  it('GET /api/plugins returns list', async () => {
    const { data, error } = await client.GET('/api/plugins');
    expect(error).toBeUndefined();
  });

  it('GET /api/personas returns list', async () => {
    const { data, error } = await client.GET('/api/personas');
    expect(error).toBeUndefined();
    expect(data?.personas).toBeDefined();
  });

  it('GET /api/executions returns list', async () => {
    const { data, error } = await client.GET('/api/executions');
    expect(error).toBeUndefined();
    expect(data?.executions).toBeDefined();
  });

  it('GET /api/dashboard/stats returns stats', async () => {
    const { data, error } = await client.GET('/api/dashboard/stats');
    expect(error).toBeUndefined();
  });

  it('GET /api/usage/stats returns usage', async () => {
    const { data, error } = await client.GET('/api/usage/stats');
    expect(error).toBeUndefined();
  });

  it('GET /api/openapi.json returns spec', async () => {
    const res = await fetch(`${process.env.WORKER_URL || 'http://localhost:8787'}/api/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
  });
});
```

**Verify:**

```bash
cd tests/integration && npx vitest run smoke.test.ts
```

**Commit:**

```bash
git add -A && git commit -m "feat: add smoke tests for integration test harness"
```

---

## Task 13: Write P0 Test Suites — API Keys + Workflows + Triggers

**Files:**
- Create: `tests/integration/suites/api-keys.test.ts`
- Create: `tests/integration/suites/workflows.test.ts`
- Create: `tests/integration/suites/triggers.test.ts`

### api-keys.test.ts

Full CRUD lifecycle:

```typescript
import { describe, it, expect } from 'vitest';
import { client } from '../client/index.js';

describe('api-keys', () => {
  let createdKeyId: string;

  it('creates an API key', async () => {
    const { data, error } = await client.POST('/api/api-keys', {
      body: { name: `test-key-${Date.now()}` },
    });
    expect(error).toBeUndefined();
    expect(data?.id).toBeDefined();
    expect(data?.token).toBeDefined();
    expect(data?.token).toMatch(/^sk_/);
    createdKeyId = data!.id;
  });

  it('lists API keys and includes created key', async () => {
    const { data } = await client.GET('/api/api-keys');
    expect(data?.keys).toBeDefined();
    const found = data!.keys.find((k: any) => k.id === createdKeyId);
    expect(found).toBeDefined();
  });

  it('deletes the created API key', async () => {
    const { data, error } = await client.DELETE('/api/api-keys/{id}', {
      params: { path: { id: createdKeyId } },
    });
    expect(error).toBeUndefined();
    expect(data?.success).toBe(true);
  });

  it('deleted key no longer appears in list', async () => {
    const { data } = await client.GET('/api/api-keys');
    const found = data!.keys.find((k: any) => k.id === createdKeyId);
    expect(found).toBeUndefined();
  });
});
```

### workflows.test.ts

Full lifecycle: sync, list, get, update, delete.

```typescript
import { describe, it, expect } from 'vitest';
import { client } from '../client/index.js';

describe('workflows', () => {
  const workflowId = `test-wf-${Date.now()}`;

  it('syncs a workflow', async () => {
    const { data, error } = await client.POST('/api/workflows/sync', {
      body: {
        id: workflowId,
        name: 'Integration Test Workflow',
        description: 'Created by integration test',
        version: '1.0.0',
        data: {
          id: workflowId,
          name: 'Integration Test Workflow',
          steps: [{ id: 'step-1', name: 'Echo', type: 'tool', tool: 'bash', arguments: { command: 'echo test' } }],
        },
      },
    });
    expect(error).toBeUndefined();
    expect(data?.success).toBe(true);
  });

  it('lists workflows and includes synced workflow', async () => {
    const { data } = await client.GET('/api/workflows');
    const found = data!.workflows.find((w: any) => w.id === workflowId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Integration Test Workflow');
  });

  it('gets workflow by id', async () => {
    const { data } = await client.GET('/api/workflows/{id}', {
      params: { path: { id: workflowId } },
    });
    expect(data?.workflow).toBeDefined();
    expect(data!.workflow.id).toBe(workflowId);
  });

  it('updates workflow', async () => {
    const { data, error } = await client.PUT('/api/workflows/{id}', {
      params: { path: { id: workflowId } },
      body: { name: 'Updated Test Workflow', description: 'Updated by test' },
    });
    expect(error).toBeUndefined();
  });

  it('deletes workflow', async () => {
    const { data, error } = await client.DELETE('/api/workflows/{id}', {
      params: { path: { id: workflowId } },
    });
    expect(error).toBeUndefined();
    expect(data?.success).toBe(true);
  });
});
```

### triggers.test.ts

Depends on a workflow existing. Create workflow, create trigger, test trigger CRUD, cleanup.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { client } from '../client/index.js';

describe('triggers', () => {
  const workflowId = `test-trigger-wf-${Date.now()}`;
  let triggerId: string;

  beforeAll(async () => {
    await client.POST('/api/workflows/sync', {
      body: {
        id: workflowId,
        name: 'Trigger Test Workflow',
        version: '1.0.0',
        data: { id: workflowId, name: 'Trigger Test', steps: [] },
      },
    });
  });

  afterAll(async () => {
    await client.DELETE('/api/workflows/{id}', {
      params: { path: { id: workflowId } },
    });
  });

  it('creates a manual trigger', async () => {
    const { data, error } = await client.POST('/api/triggers', {
      body: {
        workflowId,
        name: `test-trigger-${Date.now()}`,
        enabled: true,
        config: { type: 'manual' },
      },
    });
    expect(error).toBeUndefined();
    expect(data?.id).toBeDefined();
    triggerId = data!.id;
  });

  it('lists triggers', async () => {
    const { data } = await client.GET('/api/triggers');
    expect(data?.triggers).toBeDefined();
    const found = data!.triggers.find((t: any) => t.id === triggerId);
    expect(found).toBeDefined();
  });

  it('gets trigger by id', async () => {
    const { data } = await client.GET('/api/triggers/{id}', {
      params: { path: { id: triggerId } },
    });
    expect(data?.trigger).toBeDefined();
  });

  it('disables trigger', async () => {
    const { data, error } = await client.POST('/api/triggers/{id}/disable', {
      params: { path: { id: triggerId } },
    });
    expect(error).toBeUndefined();
  });

  it('enables trigger', async () => {
    const { data, error } = await client.POST('/api/triggers/{id}/enable', {
      params: { path: { id: triggerId } },
    });
    expect(error).toBeUndefined();
  });

  it('deletes trigger', async () => {
    const { data, error } = await client.DELETE('/api/triggers/{id}', {
      params: { path: { id: triggerId } },
    });
    expect(error).toBeUndefined();
    expect(data?.success).toBe(true);
  });
});
```

**Verify:**

```bash
cd tests/integration && npx vitest run suites/
```

**Commit:**

```bash
git add -A && git commit -m "feat: add P0 integration test suites (api-keys, workflows, triggers)"
```

---

## Task 14: Write P0 Test Suites — Sessions + Plugins

**Files:**
- Create: `tests/integration/suites/sessions.test.ts`
- Create: `tests/integration/suites/plugins.test.ts`

### sessions.test.ts

Session lifecycle: create, list, get, update, delete. Skip sandbox-dependent operations (messages, hibernate/wake).

```typescript
import { describe, it, expect } from 'vitest';
import { client } from '../client/index.js';

describe('sessions', () => {
  let sessionId: string;

  it('creates a session', async () => {
    const { data, error } = await client.POST('/api/sessions', {
      body: { workspace: `integ-test-${Date.now()}` },
    });
    expect(error).toBeUndefined();
    expect(data?.session?.id).toBeDefined();
    sessionId = data!.session.id;
  });

  it('lists sessions', async () => {
    const { data } = await client.GET('/api/sessions');
    expect(data?.sessions).toBeDefined();
    expect(data!.sessions.length).toBeGreaterThan(0);
  });

  it('gets session by id', async () => {
    const { data } = await client.GET('/api/sessions/{id}', {
      params: { path: { id: sessionId } },
    });
    expect(data?.session).toBeDefined();
    expect(data!.session.id).toBe(sessionId);
  });

  it('updates session title', async () => {
    const { error } = await client.PATCH('/api/sessions/{id}', {
      params: { path: { id: sessionId } },
      body: { title: 'Updated by integration test' },
    });
    expect(error).toBeUndefined();
  });

  it('gets participants', async () => {
    const { data } = await client.GET('/api/sessions/{id}/participants', {
      params: { path: { id: sessionId } },
    });
    expect(data?.participants).toBeDefined();
  });

  it('gets children (empty)', async () => {
    const { data } = await client.GET('/api/sessions/{id}/children', {
      params: { path: { id: sessionId } },
    });
    expect(data?.children).toBeDefined();
  });

  it('deletes session', async () => {
    const { data, error } = await client.DELETE('/api/sessions/{id}', {
      params: { path: { id: sessionId } },
    });
    expect(error).toBeUndefined();
    expect(data?.success).toBe(true);
  });
});
```

### plugins.test.ts

List plugins, verify response shape.

```typescript
import { describe, it, expect } from 'vitest';
import { client } from '../client/index.js';

describe('plugins', () => {
  it('lists plugins', async () => {
    const { data, error } = await client.GET('/api/plugins');
    expect(error).toBeUndefined();
    // Verify we get back an array-like structure
    expect(data).toBeDefined();
  });
});
```

**Verify and commit:**

```bash
cd tests/integration && npx vitest run suites/
git add -A && git commit -m "feat: add P0 integration test suites (sessions, plugins)"
```

---

## Task 15: Write P1 Test Suites

**Files:**
- Create: `tests/integration/suites/executions.test.ts`
- Create: `tests/integration/suites/dashboard.test.ts`
- Create: `tests/integration/suites/personas.test.ts`
- Create: `tests/integration/suites/tasks.test.ts`
- Create: `tests/integration/suites/events.test.ts`

Each follows the same pattern: exercise CRUD where applicable, verify response shapes.

### executions.test.ts

List executions, verify empty or populated response.

### dashboard.test.ts

GET /stats and /adoption, verify response structure.

### personas.test.ts

Full CRUD: create persona, list, get, update, file management, delete.

### tasks.test.ts

Requires a session. Create session, create task, update task, list tasks, cleanup.

### events.test.ts

List events, verify response.

**Verify and commit:**

```bash
cd tests/integration && npx vitest run suites/
git add -A && git commit -m "feat: add P1 integration test suites (executions, dashboard, personas, tasks, events)"
```

---

## Task 16: Add Makefile Targets

**Files:**
- Modify: `Makefile`

Add these targets to the Testing section:

```makefile
# ==========================================
# Integration Tests (OpenAPI)
# ==========================================

test-smoke: ## Run smoke tests against live worker
	@echo "$(GREEN)Running smoke tests against $(WORKER_URL)...$(NC)"
	WORKER_URL=$(WORKER_URL) API_TOKEN=$(API_TOKEN) npx vitest run --config tests/integration/vitest.config.ts smoke.test.ts

test-api: ## Run full API integration test suite
	@echo "$(GREEN)Running integration tests against $(WORKER_URL)...$(NC)"
	WORKER_URL=$(WORKER_URL) API_TOKEN=$(API_TOKEN) npx vitest run --config tests/integration/vitest.config.ts

generate-api-client: ## Generate typed API client from OpenAPI spec
	@echo "$(GREEN)Generating API client from $(WORKER_URL)/api/openapi.json...$(NC)"
	npx openapi-typescript $(WORKER_URL)/api/openapi.json -o tests/integration/client/schema.d.ts
	@echo "$(GREEN)✓ Client generated at tests/integration/client/schema.d.ts$(NC)"

openapi-spec: ## Dump OpenAPI spec to file
	@echo "$(GREEN)Fetching OpenAPI spec...$(NC)"
	curl -sf $(WORKER_URL)/api/openapi.json | jq . > openapi.json
	@echo "$(GREEN)✓ Spec saved to openapi.json$(NC)"
```

Also update the existing `test-integration` target to call `test-api`:

```makefile
test-integration: test-api ## Run integration tests
```

**Commit:**

```bash
git add Makefile && git commit -m "feat: add Makefile targets for integration tests and API client generation"
```

---

## Task 17: Final Verification

**Step 1:** Start the dev worker and run the full suite:

```bash
make dev-worker &
sleep 3
make db-setup
make generate-api-client
make test-smoke
make test-api
```

**Step 2:** Verify the OpenAPI docs page works:

Open `http://localhost:8787/api/docs` in a browser. Verify:
- All endpoints are listed
- Try a request from the Swagger UI
- Check that auth works (authorize with the test token)

**Step 3:** Verify the spec has reasonable coverage:

```bash
curl -s http://localhost:8787/api/openapi.json | jq '.paths | keys | length'
# Should be 50+ paths
```

**Step 4:** Final commit with any fixes:

```bash
git add -A && git commit -m "chore: final integration test fixes and verification"
```
