# Bootstrap Registry

**Date:** 2026-04-15
**Status:** Approved
**Depends on:** Service Config Convergence (all service credentials on `org_service_configs`)

## Problem

Integrations like the GitHub App, Slack bot, and LLM providers require manual UI setup or OAuth flows before they work. In CI, staging, and fresh deployments, there's no human to click through setup wizards. We need a way to auto-configure services from environment variables at startup, and the mechanism should be generic so each plugin owns its own bootstrap logic.

## Design

Each plugin that needs env-var-based setup exports a **bootstrap descriptor**. The worker runs all registered descriptors on first request (or via an internal endpoint). The descriptors are compiled into the worker at build time by extending the existing `generate-plugin-registry.ts` script.

### Bootstrap descriptor contract

Each plugin optionally exports a `src/bootstrap.ts` file:

```ts
import type { BootstrapDescriptor } from '@valet/sdk/bootstrap';

export const bootstrap: BootstrapDescriptor = {
  service: 'github',              // org_service_configs service key
  envVars: {                      // maps config/metadata fields to env var names
    config: {
      appId: 'GITHUB_APP_ID',
      privateKey: 'GITHUB_APP_PRIVATE_KEY',
      webhookSecret: 'GITHUB_APP_WEBHOOK_SECRET',
      oauthClientId: 'GITHUB_APP_CLIENT_ID',
      oauthClientSecret: 'GITHUB_APP_CLIENT_SECRET',
    },
    metadata: {
      appName: 'GITHUB_APP_NAME',
    },
  },
  required: ['appId', 'privateKey'],  // skip bootstrap if these env vars are missing
};
```

The descriptor is declarative — it maps env var names to `org_service_configs` fields. No custom write functions. The bootstrap runner handles encryption, upsert, and idempotency using the standard `setServiceConfig` / `getServiceConfig` helpers.

### Why declarative, not imperative

With the service config convergence done, every service stores config and metadata in the same shape. The bootstrap runner doesn't need plugin-specific write logic — it just reads the declared env vars, splits them into config (encrypted) and metadata (plaintext) buckets, and calls `setServiceConfig`. This keeps the bootstrap code in one place and prevents plugins from reaching into DB internals.

### Bootstrap runner

`packages/worker/src/services/bootstrap.ts`:

```ts
export async function bootstrapFromEnv(
  env: Env,
  db: AppDb,
  descriptors: BootstrapDescriptor[],
): Promise<{ bootstrapped: string[]; skipped: string[] }>
```

For each descriptor:

1. Check if `org_service_configs` already has a row for this service. If yes, skip (existing config takes precedence over env vars).
2. Read all declared env vars from `env`. If any `required` field is missing, skip.
3. Build the config object (fields listed in `envVars.config`) and metadata object (fields listed in `envVars.metadata`).
4. Call `setServiceConfig(db, env.ENCRYPTION_KEY, descriptor.service, config, metadata, null)` — `configuredBy` is null for env-based bootstrap.
5. Log what was bootstrapped and what was skipped.

The runner is called once on the first request to the worker (gated by a module-level flag) or explicitly via `POST /api/internal/bootstrap` (admin-only, for manual re-runs).

### Registry generation

The existing `generate-plugin-registry.ts` already scans `packages/plugin-*/` and generates typed registries. Add a new output:

`packages/worker/src/bootstrap/packages.ts` (auto-generated):

```ts
// AUTO-GENERATED — do not edit
import { bootstrap as github } from '@valet/plugin-github/bootstrap';
import { bootstrap as slack } from '@valet/plugin-slack/bootstrap';

export const bootstrapDescriptors = [github, slack];
```

The generator checks for `src/bootstrap.ts` in each plugin directory. Only plugins that export a bootstrap descriptor are included.

### SDK type

`packages/sdk/src/bootstrap.ts`:

```ts
export interface BootstrapDescriptor {
  /** org_service_configs service key */
  service: string;
  /** Maps config/metadata fields to env var names */
  envVars: {
    config?: Record<string, string>;
    metadata?: Record<string, string>;
  };
  /** Config fields that must be present to proceed. If any are missing from env, skip. */
  required?: string[];
}
```

### Which plugins get bootstrap descriptors

| Plugin | Service key | Required env vars | Optional env vars |
|---|---|---|---|
| `plugin-github` | `github` | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_NAME` |
| `plugin-slack` | `slack` | `SLACK_BOT_TOKEN` | `SLACK_SIGNING_SECRET`, `SLACK_TEAM_ID`, `SLACK_TEAM_NAME`, `SLACK_BOT_USER_ID`, `SLACK_APP_ID` |

LLM keys (`llm:anthropic`, etc.) don't need bootstrap descriptors because `assembleProviderEnv()` already falls back to env vars directly. The bootstrap registry is for configs that currently have no env-var path at all.

Custom providers could get a bootstrap descriptor in the future, but the variable-count-per-provider pattern (how many custom providers? what are their IDs?) doesn't fit the simple declarative model. That's a post-v1 extension if needed.

### Startup integration

In the worker's main request handler (or a middleware that runs once):

```ts
import { bootstrapDescriptors } from './bootstrap/packages.js';
import { bootstrapFromEnv } from './services/bootstrap.js';

let bootstrapped = false;

app.use('*', async (c, next) => {
  if (!bootstrapped) {
    bootstrapped = true;
    const result = await bootstrapFromEnv(c.env, getDb(c.env.DB), bootstrapDescriptors);
    if (result.bootstrapped.length > 0) {
      console.log('Bootstrapped services:', result.bootstrapped.join(', '));
    }
  }
  await next();
});
```

The flag is module-level so it runs once per worker isolate cold start. If the worker scales to multiple isolates, each runs bootstrap independently — `setServiceConfig` is idempotent (upsert), so concurrent bootstrap is safe.

### CI usage

GitHub Actions secrets store the integration env vars. The CI workflow sets them as wrangler vars or `.dev.vars` before starting the local worker:

```yaml
env:
  GITHUB_APP_ID: ${{ secrets.GITHUB_APP_ID }}
  GITHUB_APP_PRIVATE_KEY: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
  SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
  SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
```

On first request (the smoke test's first HTTP call), the worker auto-configures from these env vars. No separate seed step needed for integration config.

## Not in scope

- Custom provider bootstrap (variable-count entity, needs a different pattern)
- MCP OAuth client bootstrap (auto-discovered at runtime, not pre-configured)
- User-level credential bootstrap (per-user OAuth, can't be pre-configured)
- Rotating or updating existing config from env vars (env vars are only used when no DB row exists)
- Health check endpoint for bootstrap status (log output is sufficient for v1)
