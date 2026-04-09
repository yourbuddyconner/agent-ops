# GitHub Integration Unification Design

**Goal:** Make GitHub tools visible to all org users when a GitHub App is installed, and remove the legacy built-in `list-repos` handler.

**Status:** Design

**Does NOT cover:** Runner credential endpoint (separate spec), `list_repos` source parameter (future, plugin-internal), integration sandbox hooks, pre-baked sandbox images, GitLab/Bitbucket support, personal GitHub identity linking.

---

## Problem Statement

Two issues prevent the GitHub integration from working after a GitHub App is installed via the manifest flow:

1. **Tools are invisible.** `listTools` queries D1 for integration records, but no org-scoped integration record is created when the GitHub App is installed. Without the record, credential resolution is never attempted and all GitHub tools are hidden from the agent.

2. **`ownerId` mismatch.** The install callback stores credentials with `ownerId = orgId` (from `orgSettings.id`), but the default credential resolver looks up `ownerId = 'default'` for org scope. They never find each other.

Additionally, the built-in `list-repos` DO handler is a legacy artifact that predates the plugin system and should be removed.

---

## Design

### 1. Create Org Integration Record on Install

When the GitHub App install callback completes (in `repo-providers.ts`), insert an org-scoped integration record into the `integrations` table:

```typescript
await db.insert(integrations).values({
  id: crypto.randomUUID(),
  userId: userId,  // admin who installed (from signed JWT state)
  service: 'github',
  scope: 'org',
  status: 'active',
  config: { entities: [] },
}).onConflictDoNothing();
```

This uses the admin's real `userId` (satisfies the FK constraint to `users.id`) with `scope: 'org'` so `getOrgIntegrations` finds it.

### 2. Fix Unique Index to Include Scope

The `integrations` table has a unique index on `(userId, service)`. An admin who has personal GitHub OAuth AND installs the org app would collide.

**D1 migration:** Drop `idx_integrations_user_service` and recreate as `(userId, service, scope)`.

**Code change:** Update `ensureIntegration` in `packages/worker/src/lib/db/integrations.ts` — its `onConflictDoUpdate` target currently uses `[integrations.userId, integrations.service]`. After the migration, this must include `integrations.scope` or it will fail at runtime.

### 3. Fix `ownerId` Mismatch

The install callback in `repo-providers.ts` stores credentials with:
```typescript
await storeCredential(c.env, 'org', orgSettings.id, 'github', { ... });
```

The default credential resolver in `default.ts` looks up:
```typescript
getCredential(env, 'org', 'default', service, ...)
```

These don't match. **Fix:** Change the install callback to use `ownerId = 'default'` (matching the resolver), since the org ID is always `'default'` in the current single-org model. Verify all other `storeCredential` calls for org GitHub credentials use the same `ownerId`.

### 4. Handle App Lifecycle Events

The install callback handler in `repo-providers.ts` currently only handles `setup_action=install`. Add handling for:

- **`setup_action=install`** — store credentials + create org integration record (current behavior + new record)
- **`setup_action=update`** — refresh app metadata (permissions may have changed). Call the existing refresh logic.
- **`setup_action=delete`** — delete the org integration record + delete the `app_install` credential. Without this cleanup, `listTools` shows GitHub tools that fail on every call.

### 5. Remove Built-in `list-repos` Handler

**Delete:**
- The `list-repos` WebSocket message handler in `session-agent.ts` that calls `listOrgRepositories`
- The `list-repos-result` case handler in the Runner's `agent-client.ts`
- The `list-repos` and `list-repos-result` type definitions in `packages/shared/src/types/runner-protocol.ts`

**Keep:**
- The `org_repositories` D1 table — internal infrastructure for future pre-baked sandbox images
- The `/api/repos` HTTP routes — admin UI uses these
- The sandbox boot logic — unchanged

**Agent behavior after removal:** The agent uses `call_tool` with `github:list_repos` to list repos.

### 6. Delete on Admin Config Removal

When the admin deletes GitHub config (DELETE `/api/admin/github/oauth`), also delete the org-scoped integration record (`scope = 'org'`, `service = 'github'`). The `deleteOrgIntegrationByService` helper already exists in `packages/worker/src/lib/db/integrations.ts`.

---

## Why This Works

The existing pipeline already supports org credentials end-to-end:

1. `listTools` already queries `getOrgIntegrations` and merges with user integrations (session-tools.ts ~line 153)
2. The deduplication gives user integrations precedence (~line 161) — users with personal OAuth keep their personal credentials
3. The default credential resolver already handles `scope: 'org'` by looking up `ownerType='org'` credentials
4. `getCredential` already detects `credentialType='app_install'` and mints installation tokens via `mintGitHubInstallationToken`
5. `session-tools.ts` already passes `_credential_type` to actions so they can branch on token type

The only missing piece was the integration record insertion and the `ownerId` mismatch. No new abstractions needed.

---

## Migration

- **D1 migration:** Recreate unique index on `(userId, service, scope)`.
- **Code change:** Update `ensureIntegration` conflict target to include `scope`.
- **Backwards compatible:** Existing user-scoped integrations are unaffected.

---

## Boundary

This spec covers:
- Org-level GitHub tool visibility (integration record creation)
- `ownerId` mismatch fix
- Unique index migration
- App lifecycle event handling (install/update/delete)
- Built-in `list-repos` removal
- Admin config deletion cleanup

This spec does NOT cover:
- Runner credential endpoint (separate spec — right idea, separate timeline)
- `list_repos` source parameter (future, implement within plugin-github only)
- Integration sandbox hooks
- Pre-baked sandbox images
- `resolveScope` / SDK interface changes (unnecessary — default resolver handles the common case)
