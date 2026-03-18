# Explicit Provider Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the implicit credential priority chain with explicit provider selection on sessions, credential-type-aware repo listing, user preference settings, and scoped credential deletion.

**Architecture:** Sessions store a `repoProviderId` that is fixed for the session's lifetime. All in-session operations (token refresh, GitHub API calls, child sessions) use this stored provider. Repo listing queries each provider with its own credential type independently. Users can set a `preferredRepoProvider` to control which provider is used by default.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, D1 (SQLite), Vitest

**Design Spec:** `docs/plans/2026-03-16-github-dual-repo-provider-design.md`

---

## Chunk 1: Schema Changes

### Task 1: Add `repoProviderId` column to sessions table

**Files:**
- Modify: `packages/worker/src/lib/schema/sessions.ts:5-25`
- Modify: `packages/worker/src/lib/db.ts` (update createSession and getSession queries if needed)

**Step 1: Add column to schema**

Add after `personaId` (line 21):

```typescript
repoProviderId: text(),
```

Nullable — old sessions won't have it.

**Step 2: Run migration or ensure D1 auto-migrates**

Check how the project handles schema migrations. If using Drizzle migrations:

```bash
cd packages/worker && npx drizzle-kit generate
```

If using manual SQL, add:
```sql
ALTER TABLE sessions ADD COLUMN repo_provider_id TEXT;
```

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/worker/src/lib/schema/sessions.ts
git commit -m "feat(schema): add repoProviderId column to sessions table"
```

### Task 2: Add `preferredRepoProvider` column to users table

**Files:**
- Modify: `packages/worker/src/lib/schema/users.ts:4-29`

**Step 1: Add column to schema**

Add after existing preference fields:

```typescript
preferredRepoProvider: text(),
```

Nullable — `null` means "use first available."

**Step 2: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/worker/src/lib/schema/users.ts
git commit -m "feat(schema): add preferredRepoProvider column to users table"
```

---

## Chunk 2: Explicit Provider on Session Creation

### Task 3: Update `assembleRepoEnv` to accept explicit `repoProviderId`

**Files:**
- Modify: `packages/worker/src/lib/env-assembly.ts:147-260`

**Step 1: Add `repoProviderId` parameter**

Update the function signature to accept an optional `repoProviderId`:

```typescript
export async function assembleRepoEnv(
  appDb: AppDb,
  env: Env,
  userId: string,
  orgId: string | undefined,
  opts: { repoUrl?: string; branch?: string; ref?: string; repoProviderId?: string },
): Promise<{ envVars: Record<string, string>; gitConfig: Record<string, string>; token?: string; expiresAt?: string; repoProviderId?: string; error?: string }>
```

Note: the return type now includes `repoProviderId` so callers can store it.

**Step 2: Update resolution logic**

When `opts.repoProviderId` is provided, skip the credential priority chain and go directly to that provider:

```typescript
if (opts.repoProviderId) {
  // Explicit provider — use directly
  const provider = repoProviderRegistry.get(opts.repoProviderId);
  if (!provider) {
    return { envVars, gitConfig, error: `Repo provider '${opts.repoProviderId}' not registered` };
  }
  // Derive credential provider name and look up the specific credential type
  const credentialProvider = opts.repoProviderId.replace(/-(?:oauth|app)$/, '');
  const credentialType = opts.repoProviderId.endsWith('-oauth') ? 'oauth2' : 'app_install';
  // ... look up specific credential by type, not priority chain
}
```

When `opts.repoProviderId` is NOT provided, use the existing priority chain as fallback.

Always include the resolved `repoProviderId` in the return value.

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/worker/src/lib/env-assembly.ts
git commit -m "feat(worker): assembleRepoEnv accepts explicit repoProviderId"
```

### Task 4: Update session creation to resolve and store `repoProviderId`

**Files:**
- Modify: `packages/worker/src/services/sessions.ts:181-198` (CreateSessionParams)
- Modify: `packages/worker/src/services/sessions.ts:209-325` (createSession)
- Modify: `packages/worker/src/routes/sessions.ts:12-32` (request schema)

**Step 1: Add `repoProviderId` to CreateSessionParams**

```typescript
repoProviderId?: string;
```

**Step 2: Update session route schema**

Add to `createSessionSchema`:

```typescript
repoProviderId: z.string().optional(),
```

**Step 3: Pass through to `assembleRepoEnv`**

In `createSession`, pass the explicit provider (or resolve from user preference):

```typescript
// Resolve repoProviderId: explicit param > user preference > auto
let repoProviderId = params.repoProviderId;
if (!repoProviderId) {
  const userRow = await db.getUserById(appDb, params.userId);
  repoProviderId = userRow?.preferredRepoProvider ?? undefined;
}

const repoEnv = await assembleRepoEnv(appDb, env, params.userId, orgId, {
  repoUrl: params.repoUrl,
  branch: params.branch,
  ref: params.ref,
  repoProviderId,
});
```

**Step 4: Store `repoProviderId` on session record**

In the `db.createSession()` call (~line 260), include:

```typescript
repoProviderId: repoEnv.repoProviderId,
```

**Step 5: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add packages/worker/src/services/sessions.ts packages/worker/src/routes/sessions.ts
git commit -m "feat(worker): resolve and store repoProviderId on session creation"
```

---

## Chunk 3: Session-Locked Provider for Token Refresh and DO Operations

### Task 5: Update token refresh to use session's stored provider

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts` — `handleRepoTokenRefresh` (~line 10077)

**Step 1: Read `repoProviderId` from session state**

The DO should have access to the session's `repoProviderId` (either via state or by querying the session record). Pass it to `assembleRepoEnv`:

```typescript
const repoProviderId = this.getStateValue('repoProviderId');

const repoEnv = await assembleRepoEnv(this.appDb, this.env, userId, orgId, {
  repoUrl,
  branch: gitState.branch ?? undefined,
  repoProviderId,
});
```

This ensures token refresh always uses the same provider the session started with. If the credential has been revoked, it fails explicitly instead of silently switching.

**Step 2: Ensure `repoProviderId` is available in DO state**

Check how the DO receives session data at initialization. The `repoProviderId` needs to be passed in the init message or loaded from the session record. Look at how `personaId` or `userId` are set in DO state for the pattern.

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(worker): token refresh uses session's stored repoProviderId"
```

### Task 6: Update DO's `getGitHubToken` to use session's provider

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts` — `getGitHubToken` (~line 7382)

**Step 1: Replace OAuth-only lookup with provider-aware resolution**

The current method only checks for `credentialType: 'oauth2'`. Update it to use the session's `repoProviderId`:

```typescript
private async getGitHubToken(): Promise<string | null> {
  const repoProviderId = this.getStateValue('repoProviderId');

  // If session has an explicit provider, use it
  if (repoProviderId) {
    return this.mintTokenForProvider(repoProviderId);
  }

  // Legacy fallback for old sessions without repoProviderId
  const userId = this.getStateValue('userId');
  if (!userId) return null;
  const result = await getCredential(this.env, 'user', userId, 'github', { credentialType: 'oauth2' });
  if (!result.ok) return null;
  return result.credential.accessToken;
}
```

**Step 2: Add `mintTokenForProvider` helper**

```typescript
private async mintTokenForProvider(repoProviderId: string): Promise<string | null> {
  const userId = this.getStateValue('userId');
  if (!userId) return null;

  const credentialProvider = repoProviderId.replace(/-(?:oauth|app)$/, '');
  const credentialType = repoProviderId.endsWith('-oauth') ? 'oauth2' : 'app_install';

  // Look for the specific credential type
  const appDb = getDb(this.env.DB);
  const orgId = await this.resolveOrgId();

  if (credentialType === 'oauth2') {
    // Try prompt author first (multiplayer attribution)
    const promptAuthorId = this.getStateValue('currentPromptAuthorId');
    if (promptAuthorId) {
      const authorResult = await getCredential(this.env, 'user', promptAuthorId, credentialProvider, { credentialType: 'oauth2' });
      if (authorResult.ok) return authorResult.credential.accessToken;
    }
    const result = await getCredential(this.env, 'user', userId, credentialProvider, { credentialType: 'oauth2' });
    return result.ok ? result.credential.accessToken : null;
  }

  // App install — mint a fresh token
  // Use the same resolution as assembleRepoEnv but for the specific credential type
  const credRow = await credentialDb.getCredentialRow(appDb, orgId ? 'org' : 'user', orgId || userId, credentialProvider, 'app_install');
  if (!credRow) return null;

  // Decrypt and mint (same pattern as getGitHubToken in repos.ts)
  const json = await decryptStringPBKDF2(credRow.encryptedData, this.env.ENCRYPTION_KEY);
  const credData = JSON.parse(json) as Record<string, unknown>;
  const metadata: Record<string, string> = credRow.metadata ? JSON.parse(credRow.metadata) : {};
  for (const [k, v] of Object.entries(credData)) {
    if (typeof v === 'string') metadata[k] = v;
  }

  const provider = repoProviderRegistry.get(repoProviderId);
  if (!provider) return null;

  const repoCredential: RepoCredential = {
    type: 'installation',
    installationId: metadata.installationId || metadata.installation_id,
    accessToken: (credData.access_token || credData.token) as string | undefined,
    metadata,
  };

  const freshToken = await provider.mintToken(repoCredential);
  return freshToken.accessToken;
}
```

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(worker): DO getGitHubToken uses session's repoProviderId"
```

### Task 7: Update child session credential injection

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts` (~line 3619-3646)

**Step 1: Pass parent's `repoProviderId` to child session**

When spawning child sessions, include the parent's `repoProviderId` in the spawn request so the child session inherits it:

```typescript
childSpawnRequest.repoProviderId = this.getStateValue('repoProviderId');
```

**Step 2: Update credential injection to use provider-aware resolution**

Replace the OAuth-only credential injection with a call that respects the parent's provider:

```typescript
if (!childSpawnRequest.envVars?.GITHUB_TOKEN) {
  const token = await this.getGitHubToken(); // now provider-aware
  if (token) {
    childSpawnRequest.envVars = childSpawnRequest.envVars || {};
    childSpawnRequest.envVars.GITHUB_TOKEN = token;
  }
}
```

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(worker): child sessions inherit parent's repoProviderId"
```

---

## Chunk 4: Credential-Type-Aware Repo Listing

### Task 8: Update repo listing to query each provider independently

**Files:**
- Modify: `packages/worker/src/routes/repos.ts:117-166` (GET /api/repos)
- Modify: `packages/worker/src/routes/repos.ts:19-59` (resolveRepoCredentialForProvider)

**Step 1: Replace `resolveRepoCredentialForProvider` with type-specific resolution**

The current function uses the priority chain, which gives the same credential to both providers. Instead, each provider should query for its own credential type:

```typescript
async function resolveCredentialForProviderDirect(
  env: Env,
  userId: string,
  provider: RepoProvider,
): Promise<RepoCredential | null> {
  const appDb = getDb(env.DB);
  const credentialProvider = provider.id.replace(/-(?:oauth|app)$/, '');
  const credentialType = provider.id.endsWith('-oauth') ? 'oauth2' : 'app_install';

  // For oauth providers, look for user-level oauth2
  if (credentialType === 'oauth2') {
    const credRow = await credentialDb.getCredentialRow(appDb, 'user', userId, credentialProvider, 'oauth2');
    if (!credRow) return null;
    // decrypt and build RepoCredential...
  }

  // For app providers, look for org-level then user-level app_install
  const orgSettings = await db.getOrgSettings(appDb);
  let credRow = orgSettings?.id
    ? await credentialDb.getCredentialRow(appDb, 'org', orgSettings.id, credentialProvider, 'app_install')
    : null;
  if (!credRow) {
    credRow = await credentialDb.getCredentialRow(appDb, 'user', userId, credentialProvider, 'app_install');
  }
  if (!credRow) return null;
  // decrypt and build RepoCredential...
}
```

**Step 2: Update GET /api/repos to use the new function**

Replace the call to `resolveRepoCredentialForProvider` with `resolveCredentialForProviderDirect`. Each provider gets its own credential, so the App provider gets an `app_install` credential even when OAuth exists.

**Step 3: Deduplicate merged results**

When both providers return results, deduplicate by `fullName`:

```typescript
const seen = new Set<string>();
const dedupedRepos = allRepos.filter(repo => {
  const key = repo.fullName as string;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

**Step 4: Write tests**

Add test cases in `packages/worker/src/routes/repos.test.ts` (or inline verification):
- OAuth user sees personal repos
- App-only user sees installation repos
- User with both sees merged, deduplicated repos

**Step 5: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add packages/worker/src/routes/repos.ts
git commit -m "feat(worker): repo listing queries each provider with its own credential type"
```

---

## Chunk 5: User Preference and Scoped Credential Deletion

### Task 9: Add user preference setting for repo provider

**Files:**
- Modify: `packages/worker/src/routes/auth.ts:70-82` (PATCH /api/auth/me)
- Modify: `packages/worker/src/lib/db.ts` (updateUserProfile)

**Step 1: Add `preferredRepoProvider` to the update profile schema**

In the PATCH route's validation schema, add:

```typescript
preferredRepoProvider: z.enum(['github-oauth', 'github-app']).nullable().optional(),
```

**Step 2: Include in `updateUserProfile` DB call**

Make sure the column is written when the user updates their preference.

**Step 3: Return in GET /api/auth/me response**

Include `preferredRepoProvider` in the user profile response so the UI can display it.

**Step 4: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/worker/src/routes/auth.ts packages/worker/src/lib/db.ts
git commit -m "feat(worker): add preferredRepoProvider user setting"
```

### Task 10: Scope credential deletion by type

**Files:**
- Modify: `packages/worker/src/lib/db/credentials.ts:81-90` (deleteCredential)
- Modify: `packages/worker/src/services/credentials.ts` (revokeCredential)
- Modify: `packages/worker/src/routes/auth.ts:126-131` (DELETE endpoint)

**Step 1: Add `credentialType` filter to `deleteCredential`**

```typescript
export async function deleteCredential(
  db: AppDb,
  ownerType: string,
  ownerId: string,
  provider: string,
  credentialType?: string,
): Promise<void> {
  const conditions = [
    eq(credentials.ownerType, ownerType),
    eq(credentials.ownerId, ownerId),
    eq(credentials.provider, provider),
  ];
  if (credentialType) {
    conditions.push(eq(credentials.credentialType, credentialType));
  }
  await db.delete(credentials).where(and(...conditions));
}
```

**Step 2: Update route to accept optional credential type**

```
DELETE /api/auth/me/credentials/:provider?credentialType=oauth2
```

**Step 3: Pass through to revokeCredential**

```typescript
const credentialType = c.req.query('credentialType');
await revokeCredential(c.env, 'user', user.id, provider, credentialType);
```

**Step 4: Write test**

Add test to `credentials.test.ts`:
- Delete with `credentialType='oauth2'` only removes OAuth, leaves app_install
- Delete without `credentialType` removes all (backward compat)

**Step 5: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add packages/worker/src/lib/db/credentials.ts packages/worker/src/services/credentials.ts packages/worker/src/routes/auth.ts
git commit -m "feat(worker): scope credential deletion by credentialType"
```

---

## Chunk 6: Fix hasCredential and Validate Endpoint

### Task 11: Make `hasCredential` in auth response distinguish credential types

**Files:**
- Modify: `packages/worker/src/routes/auth.ts:14-51` (GET /api/auth/me)

**Step 1: Return credential types instead of boolean**

Instead of `hasGitHub: true/false`, return:

```typescript
github: {
  hasOAuth: boolean,
  hasAppInstall: boolean,
},
```

Check existing frontend usage of `hasGitHub` to understand the migration impact. The simplest approach may be to keep `hasGitHub` as a backward-compat field (true if either exists) and add the detailed fields alongside.

**Step 2: Query specific credential types**

```typescript
const [hasGitHubOAuth, hasGitHubApp] = await Promise.all([
  credentialDb.hasCredentialOfType(appDb, 'user', user.id, 'github', 'oauth2'),
  credentialDb.hasCredentialOfType(appDb, 'user', user.id, 'github', 'app_install'),
]);
```

Add `hasCredentialOfType` to credentials.ts if it doesn't exist (it's just `hasCredential` with a `credentialType` filter).

**Step 3: Commit**

```bash
git add packages/worker/src/routes/auth.ts packages/worker/src/lib/db/credentials.ts
git commit -m "feat(worker): distinguish OAuth vs App credential types in auth response"
```

### Task 12: Improve validate endpoint error messages for App scope

**Files:**
- Modify: `packages/worker/src/routes/repos.ts` (GET /api/repos/validate)

**Step 1: Add provider context to error messages**

When validation fails and the active provider is `github-app`, include a hint:

```typescript
if (!validation.accessible) {
  const hint = provider.id === 'github-app'
    ? ' The GitHub App may not be installed on this repository.'
    : '';
  return c.json({ valid: false, error: (validation.error || 'Repository not accessible') + hint });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/repos.ts
git commit -m "feat(worker): add provider-specific hints to repo validation errors"
```

---

## Chunk 7: Tests and Verification

### Task 13: Update credential priority chain tests

**Files:**
- Modify: `packages/worker/src/lib/db/credentials.test.ts`

**Step 1: Add tests for scoped deletion**

```typescript
describe('deleteCredential with credentialType filter', () => {
  it('deletes only the specified credential type', async () => { ... });
  it('deletes all types when no filter provided', async () => { ... });
});
```

**Step 2: Run tests**

Run: `cd packages/worker && npx vitest run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/worker/src/lib/db/credentials.test.ts
git commit -m "test: add scoped credential deletion tests"
```

### Task 14: End-to-end verification

**Step 1: Full type check**

Run: `cd packages/worker && npx tsc --noEmit && cd ../plugin-github && npx tsc --noEmit`
Expected: PASS

**Step 2: Run all tests**

Run: `cd packages/worker && npx vitest run`
Expected: All tests pass

**Step 3: Manual verification checklist**

- [ ] Session creation with explicit `repoProviderId='github-oauth'` uses OAuth credential
- [ ] Session creation with explicit `repoProviderId='github-app'` uses App credential
- [ ] Session creation without `repoProviderId` uses user's `preferredRepoProvider`
- [ ] Session creation with no preference uses first available credential
- [ ] Token refresh uses session's stored provider (no switching)
- [ ] DO `getGitHubToken` uses session's provider for PR creation, etc.
- [ ] Child sessions inherit parent's `repoProviderId`
- [ ] Repo listing shows repos from all available credentials
- [ ] Deleting OAuth credential leaves App credential intact
- [ ] `hasGitHub` in auth response distinguishes OAuth vs App
- [ ] App-only users can create PRs, list issues

**Step 4: Commit**

```bash
git commit -m "feat: explicit provider selection for GitHub dual repo provider"
```
