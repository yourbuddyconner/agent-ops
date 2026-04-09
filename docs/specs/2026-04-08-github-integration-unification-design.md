# GitHub Integration Unification Design

**Goal:** Make GitHub tools visible to all org users when a GitHub App is installed, remove the legacy built-in `list-repos` handler, and add a generic credential resolution endpoint so sandboxes can fetch credentials on demand.

**Status:** Design

**Does NOT cover:** Integration sandbox hooks (generic plugin lifecycle hooks at sandbox creation), pre-baked sandbox images for repos, GitLab/Bitbucket support, personal GitHub identity linking for commit attribution.

---

## Problem Statement

Three issues prevent the GitHub integration from working after a GitHub App is installed via the manifest flow:

1. **Tools are invisible.** `listTools` queries D1 for integration records, but no org-scoped integration record is created when the GitHub App is installed. Without the record, credential resolution is never attempted and all GitHub tools are hidden from the agent.

2. **Two `list_repos` implementations.** The built-in `list-repos` DO handler reads a static `org_repositories` D1 table. The GitHub plugin's `github.list_repos` action queries the GitHub API. The agent calls the built-in one (which returns nothing) instead of the plugin action (which would work).

3. **No way for the sandbox to fetch credentials.** Sandbox boot needs a GitHub token to clone repos, but tokens are currently baked into env vars at spawn time. Short-lived tokens (1-hour GitHub App installation tokens) can expire before the sandbox finishes booting. There's no way for sandbox processes to resolve credentials on demand.

---

## Design

### 1. Org-Scoped Integration Record

When the GitHub App install callback completes (in `repo-providers.ts`), create an org-scoped integration record in D1 for the `github` service. This is the record that `listTools` queries to discover available integrations.

The record should be created alongside the `app_install` credential that's already stored. If the record already exists (e.g., from a previous installation), update it.

When the admin deletes the GitHub config (DELETE `/api/admin/github/oauth`), delete the org-scoped integration record.

**Effect:** Any user in the org who calls `list_tools` will see GitHub tools, because `listTools` finds the org integration record, resolves the org `app_install` credential, mints an installation token, and returns the tool list.

### 2. Remove Built-in `list-repos` Handler

**Delete:**
- The `list-repos` WebSocket message handler in `session-agent.ts` that calls `listOrgRepositories`
- The `list-repos-result` handler in the Runner's `agent-client.ts`
- Any runner-side code that sends `list-repos` messages (e.g., `requestListRepos` method)

**Keep:**
- The `org_repositories` D1 table — internal infrastructure for future pre-baked sandbox images
- The `/api/repos` HTTP routes — admin UI uses these to manage registered repos
- The sandbox boot logic that reads `org_repositories` — unchanged for now; sessions spawned with a registered repo still work

**Agent behavior after removal:** The agent uses `call_tool` with `github:list_repos` to list repos. No built-in `list_repos` tool exists.

### 3. Custom GitHub Credential Resolver

Register a custom `CredentialResolver` for the `github` service in the `IntegrationRegistry`, replacing the `defaultCredentialResolver` for GitHub. This resolver lives in the GitHub plugin package (`packages/plugin-github/`).

**Resolution logic:**

```
resolveGitHubCredential(service, env, userId, scope, options):
  1. If scope is explicitly 'org':
     → look up org app_install credential
     → mint installation token via mintGitHubInstallationToken
     → return token

  2. If scope is explicitly 'user':
     → look up user oauth2 credential
     → return token (with refresh if expired)

  3. If scope is not specified (default):
     → try user oauth2 first (personal repos take priority)
     → if not found, try org app_install
     → if neither found, return not_found error
```

The resolver is registered during `IntegrationRegistry.init()` alongside the existing Slack resolver.

**Why the plugin owns this:** The credential resolution logic is GitHub-specific (app install token minting, PKCS#8 key handling, installation ID lookup). Keeping it in the plugin follows the pattern established by Slack's custom resolver.

### 4. `list_repos` Source Parameter

Add an optional `source` parameter to the `github.list_repos` action definition:

```typescript
params: z.object({
  source: z.enum(['org', 'personal']).optional().describe(
    'Which credential to use. "org" uses the GitHub App (org repos), "personal" uses your OAuth token (personal repos). Defaults to trying org first, then personal.'
  ),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
})
```

**Execution behavior:**
- `source: 'org'` → resolve credential with `scope: 'org'` → call `/installation/repositories`
- `source: 'personal'` → resolve credential with `scope: 'user'` → call `/user/repos`
- No source → resolve credential with default scope (tries user OAuth first, falls back to org app install). Call the appropriate endpoint based on which credential was returned (check `credentialType` on the result).

The `source` parameter is passed to the credential resolver via the action context. This requires threading a `scope` override from the action params through `executeAction` to `resolveCredentials`. The simplest way: the GitHub plugin's `executeAction` reads `source` from params and sets `scope` before credential resolution.

**Challenge:** Today, credential resolution happens in `session-tools.ts` before calling the plugin's `executeAction`. The plugin can't influence which credential is fetched. Two options:

**Option A:** The plugin's credential resolver reads action params from a thread-local or context object. This is invasive.

**Option B (recommended):** Add an optional `resolveScope` method to the `ActionSource` interface that the plugin can implement. `session-tools.ts` calls `actionSource.resolveScope(actionId, params)` before credential resolution to determine the scope. Default returns the integration's `isOrgScoped` flag. The GitHub plugin overrides it to read `source` from params.

```typescript
interface ActionSource {
  listActions(ctx: CredentialContext): ActionDefinition[];
  executeAction(ctx: ActionContext, actionId: string, params: unknown): Promise<ActionResult>;
  // NEW: optional scope resolution based on action params
  resolveScope?(actionId: string, params: unknown): 'user' | 'org' | undefined;
}
```

### 5. Session Spawn with Arbitrary Repo

The session spawn request accepts an optional `repo` parameter:

```typescript
interface SessionSpawnRequest {
  // ... existing fields ...
  repo?: string; // e.g., "owner/repo" or "https://github.com/owner/repo"
}
```

When `repo` is specified:
1. The spawn flow no longer reads `org_repositories` to determine what to clone.
2. The repo URL is passed to the sandbox as an env var (e.g., `SESSION_REPO=owner/repo`).
3. The sandbox boot script calls the Runner credential endpoint (Section 6) to get a token, then clones.

When `repo` is NOT specified:
- The current behavior is preserved — the sandbox uses whatever is configured in `org_repositories` (if anything). This is the backwards-compatible path.

**Future direction:** When pre-baked sandbox images are implemented, the spawn flow checks if a cached image exists for the `repo` and uses it instead of cloning fresh. The spawn request stays the same.

### 6. Runner Credential Endpoint

New endpoint on the Runner gateway (`packages/runner/src/gateway.ts`):

```
POST /api/credentials/resolve
Body: { service: string, scope?: 'user' | 'org', context?: Record<string, unknown> }
Response: { token: string, type: string, expiresAt?: string } | { error: string }
```

**Flow:**
1. Sandbox process (boot script, git credential helper, any tool) calls the endpoint
2. Runner receives request, sends WebSocket message to DO: `{ type: 'resolve-credential', requestId, service, scope, context }`
3. DO calls `integrationRegistry.resolveCredentials(service, env, userId, scope)` using the session's `userId`
4. DO returns `{ type: 'resolve-credential-result', requestId, token, type, expiresAt }` or error
5. Runner returns the token to the caller

**Security:** The endpoint is only accessible from inside the sandbox (localhost:9000, behind the auth gateway). The session's `userId` is used for credential resolution — the sandbox cannot request credentials for other users.

**Git credential helper integration:** The sandbox boot script can configure git to use this endpoint:

```bash
git config --global credential.helper '!f() {
  TOKEN=$(curl -s http://localhost:9000/api/credentials/resolve \
    -H "Content-Type: application/json" \
    -d "{\"service\": \"github\"}" | jq -r .token)
  echo "username=x-access-token"
  echo "password=$TOKEN"
}; f'
```

This means every `git clone`, `git push`, `git fetch` automatically resolves a fresh token. No pre-baked env vars needed, and tokens are always fresh.

**DO handler:** Add `resolve-credential` to the runner message handlers in `session-agent.ts`, alongside existing handlers like `list-tools` and `call-tool`.

---

## Migration

- **No D1 schema changes.** The org integration record uses the existing `integrations` table. The `org_repositories` table is unchanged.
- **Backwards compatible spawn.** Sessions without a `repo` param work as before.
- **Built-in `list-repos` removal** is a breaking change for any sandbox tool that calls it. Since the agent uses `call_tool` for GitHub actions, the impact is limited to the internal `list-repos` message handler which is no longer needed.
- **Old clients** that don't pass `repo` in spawn requests continue to work.

---

## Boundary

This spec covers:
- Org-level GitHub tool visibility
- Built-in `list-repos` removal
- Custom GitHub credential resolver
- `list_repos` source parameter
- Arbitrary repo in session spawn
- Runner credential resolution endpoint

This spec does NOT cover:
- Integration sandbox hooks (generic plugin lifecycle at sandbox creation)
- Pre-baked sandbox images
- GitLab/Bitbucket integration
- Personal GitHub identity linking (commit attribution)
- OAuth scope escalation UI
