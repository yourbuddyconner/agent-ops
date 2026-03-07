# OpenAPI + Integration Test Harness Design

**Date:** 2026-03-07
**Status:** Approved

## Goal

Add OpenAPI spec generation to the Valet worker API via `@hono/zod-openapi`, then build a typed integration test harness that exercises all features against a live worker.

## 1. OpenAPI Layer (`packages/worker`)

### Dependencies

- `@hono/zod-openapi` — OpenAPI route definitions with Zod schemas
- `@hono/swagger-ui` — Swagger UI page

### Route Migration

Migrate all route files from `new Hono()` to `new OpenAPIHono()`:

- Each endpoint becomes a `createRoute()` definition with:
  - Request params, query, body schemas (reuse existing Zod schemas)
  - Response schemas (new, derived from `packages/shared` types)
  - `.openapi()` metadata (descriptions, tags, examples)
- Query params get proper Zod schemas (currently parsed manually via `c.req.query()`)
- Error responses use a shared Zod schema: `{ error: string, code: string, requestId: string }`

### Spec Serving

- `GET /api/openapi.json` — raw OpenAPI 3.1 spec
- `GET /api/docs` — Swagger UI

### File Changes

Every file in `packages/worker/src/routes/*.ts` gets migrated. The `index.ts` entry point swaps `new Hono()` for `new OpenAPIHono()` and adds the doc/UI endpoints.

### Migration Pattern

Before:
```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const result = await doThing(body);
  return c.json(result, 201);
});
```

After:
```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

const router = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

const createRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Things'],
  request: { body: { content: { 'application/json': { schema: createSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: thingResponseSchema } }, description: 'Created' },
    400: { content: { 'application/json': { schema: errorSchema } }, description: 'Validation error' },
  },
});

router.openapi(createRoute, async (c) => {
  const body = c.req.valid('json');
  const result = await doThing(body);
  return c.json(result, 201);
});
```

## 2. Client Generation

### Dependencies

- `openapi-typescript` — generates TypeScript types from OpenAPI spec
- `openapi-fetch` — typed fetch client using those types

### Generated Client Location

`tests/integration/client/` — generated types + configured client instance.

### Generation Flow

1. Worker serves spec at `/api/openapi.json`
2. `make generate-api-client` fetches spec and runs `openapi-typescript` to produce `tests/integration/client/schema.d.ts`
3. `tests/integration/client/index.ts` creates a configured `openapi-fetch` client

## 3. Test Suite (`tests/integration/`)

### Structure

```
tests/integration/
├── vitest.config.ts          # env: WORKER_URL, API_TOKEN
├── setup.ts                  # globalSetup: health check, auth validation
├── client/
│   ├── schema.d.ts           # generated from OpenAPI spec
│   └── index.ts              # configured openapi-fetch instance
├── smoke.test.ts             # fast: auth + list endpoints (< 30s)
└── suites/
    ├── sessions.test.ts      # create, list, get, delete
    ├── workflows.test.ts     # sync, CRUD, proposals
    ├── triggers.test.ts      # CRUD, enable/disable
    ├── api-keys.test.ts      # create, list, delete
    ├── plugins.test.ts       # list, enable/disable
    ├── executions.test.ts    # list, get
    ├── files.test.ts         # upload, download
    ├── events.test.ts        # list
    ├── dashboard.test.ts     # get stats
    ├── personas.test.ts      # list, select
    └── tasks.test.ts         # CRUD
```

### Data Strategy (Hybrid)

- **Baseline:** Seeded user + API key (existing `seed-test-data.sql`)
- **Per-test:** Tests create resources via the API, no explicit teardown
- **Isolation:** Tests use unique names/prefixes to avoid collisions

### Test Pattern

```typescript
import { client } from '../client';

describe('sessions', () => {
  let sessionId: string;

  it('creates a session', async () => {
    const { data, error } = await client.POST('/api/sessions', {
      body: { workspace: `test-${Date.now()}` },
    });
    expect(error).toBeUndefined();
    expect(data?.id).toBeDefined();
    sessionId = data!.id;
  });

  it('lists sessions', async () => {
    const { data } = await client.GET('/api/sessions');
    expect(data?.sessions.length).toBeGreaterThan(0);
  });

  it('gets session by id', async () => {
    const { data } = await client.GET('/api/sessions/{id}', {
      params: { path: { id: sessionId } },
    });
    expect(data?.id).toBe(sessionId);
  });

  it('deletes session', async () => {
    const { error } = await client.DELETE('/api/sessions/{id}', {
      params: { path: { id: sessionId } },
    });
    expect(error).toBeUndefined();
  });
});
```

## 4. Makefile Targets

```makefile
test-smoke:          # Run smoke tests only
test-integration:    # Run full integration suite
generate-api-client: # Regenerate typed client from OpenAPI spec
openapi-spec:        # Dump spec to file (openapi.json)
```

All accept `WORKER_URL` (default: `http://localhost:8787`) and `API_TOKEN` (default: `test-api-token-12345`).

## 5. Priority Coverage

### P0 (must have)
- Sessions, Workflows, Triggers, API Keys, Plugins

### P1 (should have)
- Executions, Files, Events, Dashboard, Personas, Tasks, Action Policies, Disabled Actions

### P2 (skip for now — needs external services)
- Integrations (OAuth), Repos (GitHub), Orchestrator, Channels (Slack/Telegram)

## 6. Migration Order

All 32 route files migrated at once. Order within the PR:

1. Add dependencies (`@hono/zod-openapi`, `@hono/swagger-ui`)
2. Create shared response schemas (error, pagination)
3. Migrate `index.ts` to `OpenAPIHono`
4. Migrate all route files (alphabetical)
5. Add spec + docs endpoints
6. Set up test infrastructure
7. Write test suites
