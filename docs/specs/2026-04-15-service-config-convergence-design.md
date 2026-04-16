# Service Config Convergence

**Date:** 2026-04-15
**Status:** Approved
**Depends on:** Nothing
**Depended on by:** Bootstrap Registry

## Problem

Org-level service credentials are spread across four separate tables, each with its own encryption pattern, DB helpers, and read/write paths:

| Table | What it stores | Encrypted? |
|---|---|---|
| `org_service_configs` | GitHub App, Slack bot (new path) | Yes (AES-GCM) |
| `org_api_keys` | LLM provider keys (Anthropic, OpenAI, Google, Parallel) | Yes (AES-GCM) |
| `custom_providers` | Custom LLM endpoints (base URL, API key, model list) | Yes (AES-GCM) |
| `mcp_oauth_clients` | MCP OAuth client metadata | No |
| `org_slack_installs` | Slack bot (legacy, being migrated) | Yes (AES-GCM) |

This fragmentation makes it hard to build a generic bootstrap system (env-var-based setup at startup), auditing requires checking multiple tables, and every new integration copies boilerplate from a different source. The Slack migration already proved the convergence pattern works — `org_service_configs` reads first, falls back to legacy, auto-migrates on read.

## Target state

Everything moves to `org_service_configs`. The table already has the right shape:

```sql
CREATE TABLE org_service_configs (
  service TEXT PRIMARY KEY,       -- e.g., 'github', 'slack', 'llm:anthropic'
  encrypted_config TEXT NOT NULL, -- AES-GCM encrypted JSON (secrets)
  metadata TEXT,                  -- plaintext JSON (non-secret config)
  configured_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Config** (encrypted): anything that's a secret — API keys, private keys, bot tokens, client secrets.

**Metadata** (plaintext): everything else — model lists, display names, base URLs, team names, feature flags. This stays readable without decryption so the UI can render config state cheaply.

## Service key convention

Keys use a flat namespace with colon separators for sub-categories:

| Service key | Migrated from | Config (encrypted) | Metadata (plaintext) |
|---|---|---|---|
| `github` | `org_service_configs` (already there) | appId, privateKey, webhookSecret, oauthClientId, oauthClientSecret | appOwner, appName, appOwnerType, allowPersonalInstallations, allowAnonymousGitHubAccess |
| `slack` | `org_slack_installs` (migration in progress) | botToken, signingSecret | teamId, teamName, botUserId, appId |
| `llm:anthropic` | `org_api_keys` | apiKey | models (JSON array), showAllModels |
| `llm:openai` | `org_api_keys` | apiKey | models, showAllModels |
| `llm:google` | `org_api_keys` | apiKey | models, showAllModels |
| `llm:parallel` | `org_api_keys` | apiKey | models, showAllModels |
| `custom-llm:<providerId>` | `custom_providers` | apiKey | displayName, baseUrl, models, showAllModels |
| `mcp-oauth:<service>` | `mcp_oauth_clients` | clientSecret | clientId, authorizationEndpoint, tokenEndpoint, registrationEndpoint, scopesSupported, metadata |

## What changes per table

### `org_api_keys` → `llm:<provider>`

**Current read path:** `assembleProviderEnv()` calls `getOrgApiKey(db, provider)` which queries `org_api_keys WHERE provider = ?`.

**New read path:** `assembleProviderEnv()` calls `getServiceConfig(db, encryptionKey, 'llm:' + provider)`. The `apiKey` is in `config`, model restrictions are in `metadata`.

**Current write path:** `PUT /api/admin/llm-keys/:provider` calls `setOrgApiKey()`.

**New write path:** Same route calls `setServiceConfig(db, encryptionKey, 'llm:' + provider, { apiKey }, { models, showAllModels }, userId)`.

**Model config updates:** `updateOrgApiKeyModelConfig()` becomes `updateServiceMetadata('llm:' + provider, { models, showAllModels })` — no decryption needed.

**Listing:** `GET /api/admin/llm-keys` currently calls `listOrgApiKeys()`. New implementation queries `org_service_configs WHERE service LIKE 'llm:%'` and reads metadata only (no decryption).

**Migration:** Dual-read with fallback. New code checks `org_service_configs` first, falls back to `org_api_keys`, auto-migrates on read. Same pattern as the Slack migration.

### `custom_providers` → `custom-llm:<providerId>`

**Current read path:** `assembleCustomProviders()` calls `getAllCustomProvidersWithKeys()`.

**New read path:** Query `org_service_configs WHERE service LIKE 'custom-llm:%'`. Decrypt each row's config for the API key. Read model list and base URL from metadata.

**Current write path:** `PUT /api/admin/custom-providers/:providerId` calls `upsertCustomProvider()`.

**New write path:** Same route calls `setServiceConfig(db, encryptionKey, 'custom-llm:' + providerId, { apiKey }, { displayName, baseUrl, models, showAllModels }, userId)`.

**Migration:** Same dual-read pattern.

### `mcp_oauth_clients` → `mcp-oauth:<service>`

**Current state:** Not encrypted. Stores OAuth client metadata from dynamic registration.

**New state:** Client secret (if present) moves to encrypted config. Everything else is metadata. This fixes the existing issue of storing client secrets in plaintext.

**Current read/write:** `getMcpOAuthClient()` and `insertMcpOAuthClientIfNotExists()` — idempotent insert.

**New read/write:** `getServiceConfig(db, encryptionKey, 'mcp-oauth:' + service)` and `setServiceConfig()` with the same first-write-wins semantics (check existence before write).

**Migration:** Same dual-read pattern.

### `org_slack_installs` (complete existing migration)

Already migrating. The remaining work is:
1. Remove the legacy fallback read path in `getOrgSlackInstall()`.
2. Drop the `org_slack_installs` table in a future migration (after a release cycle to ensure all rows have been auto-migrated).

## Shared helpers

The existing `service-configs.ts` helpers (`getServiceConfig`, `setServiceConfig`, `getServiceMetadata`, `updateServiceMetadata`, `deleteServiceConfig`) already cover all the patterns needed. No new generic helpers are required.

Add one new helper for prefix-based listing:

```ts
export async function listServiceConfigs<TMeta>(
  db: AppDb,
  prefix: string,
): Promise<Array<{ service: string; metadata: TMeta; configuredBy: string | null; updatedAt: string }>>
```

This reads metadata only (no decryption) for all rows where `service LIKE '<prefix>%'`. Used by the LLM keys listing endpoint and custom providers listing endpoint.

## Migration strategy

Each table follows the same three-phase pattern (already proven by the Slack migration):

**Phase 1 — Dual-read:** Write new rows to `org_service_configs`. Read from `org_service_configs` first; if not found, read from legacy table and auto-migrate the row. No user-facing changes.

**Phase 2 — Write-only new:** After one release cycle, remove the legacy write path. Legacy reads remain as fallback.

**Phase 3 — Drop legacy:** After confirming no legacy rows remain (or after a reasonable time window), remove the legacy read fallback and drop the old table via migration.

The tables can be migrated independently. Recommended order:
1. `org_api_keys` (simplest — 4 providers, straightforward key/value)
2. `custom_providers` (similar shape, just more metadata)
3. `mcp_oauth_clients` (adds encryption for client secrets)
4. `org_slack_installs` (finish existing migration — just drop legacy fallback)

## Admin route changes

All admin routes keep their existing URL structure. The only change is the underlying storage call:

| Route | Current helper | New helper |
|---|---|---|
| `GET /api/admin/llm-keys` | `listOrgApiKeys()` | `listServiceConfigs('llm:')` |
| `PUT /api/admin/llm-keys/:provider` | `setOrgApiKey()` | `setServiceConfig('llm:' + provider, ...)` |
| `DELETE /api/admin/llm-keys/:provider` | `deleteOrgApiKey()` | `deleteServiceConfig('llm:' + provider)` |
| `GET /api/admin/custom-providers` | `listCustomProviders()` | `listServiceConfigs('custom-llm:')` |
| `PUT /api/admin/custom-providers/:id` | `upsertCustomProvider()` | `setServiceConfig('custom-llm:' + id, ...)` |
| `DELETE /api/admin/custom-providers/:id` | `deleteCustomProvider()` | `deleteServiceConfig('custom-llm:' + id)` |

## Not in scope

- Changing the `org_service_configs` table schema (it already has the right shape)
- User-level credentials (`credentials` table — different ownership model, stays separate)
- `org_settings` (org metadata, not service credentials)
- `org_plugins` / `org_plugin_artifacts` (extension system, not credentials)
- `github_installations` (installation tracking, not service config)
- Bootstrap registry (separate spec, builds on this convergence)
