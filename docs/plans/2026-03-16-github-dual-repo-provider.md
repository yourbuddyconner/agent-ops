# GitHub Dual Repo Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the single `githubRepoProvider` into two implementations (OAuth + App) with a generic credential resolver that picks the best available credential per session — user OAuth token preferred, org App installation as fallback.

**Architecture:** Two `RepoProvider` implementations in `plugin-github` share common utilities. A new generic `RepoCredentialResolver` in the worker core resolves which provider + credential pair to use based on available credentials with user-level preferred over org-level. The plugin registry script is updated to discover multiple repo providers per plugin.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, D1 (SQLite), Bun

**Design Spec:** `docs/plans/2026-03-16-github-dual-repo-provider-design.md`

---

## Chunk 1: Extract Shared Utilities

Foundation — pull shared code out of `repo.ts` so the two providers can import it.

### Task 1: Create shared utilities file

**Files:**
- Create: `packages/plugin-github/src/repo-shared.ts`
- Modify: `packages/plugin-github/src/repo.ts` (verify imports still work after extraction)

**Step 1: Create `repo-shared.ts` with extracted utilities**

Extract the following from `repo.ts` into `repo-shared.ts`:
- `pemToArrayBuffer()` (lines 12-17)
- `base64url()` (lines 20-29)
- `mintInstallationToken()` (lines 31-73)
- `mapGitHubRepo()` (lines 75-88)
- Shared constants: `GITHUB_URL_PATTERNS`

```typescript
// packages/plugin-github/src/repo-shared.ts
import { githubFetch } from './actions/api.js';
import type { RepoCredential, RepoValidation, SessionRepoEnv } from '@valet/sdk/repos';

export const GITHUB_URL_PATTERNS = [/github\.com/];

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(data: ArrayBuffer | Uint8Array | string): string {
  let b64: string;
  if (typeof data === 'string') {
    b64 = btoa(data);
  } else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    b64 = btoa(String.fromCharCode(...bytes));
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64url(signature)}`;

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Valet',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to mint installation token: ${res.status}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

export function mapGitHubRepo(r: any) {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    private: r.private,
    description: r.description ?? null,
    updatedAt: r.updated_at,
    language: r.language ?? null,
  };
}

/** Shared validateRepo — works with any token regardless of source. */
export async function validateGitHubRepo(credential: RepoCredential, repoUrl: string): Promise<RepoValidation> {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return { accessible: false, error: 'Invalid GitHub URL' };
  const [, owner, repo] = match;
  if (!credential.accessToken) {
    return { accessible: false, error: 'No access token available — mint a token first' };
  }
  const res = await githubFetch(`/repos/${owner}/${repo}`, credential.accessToken);
  if (!res.ok) return { accessible: false, error: `Repository not accessible: ${res.status}` };
  const data = (await res.json()) as {
    full_name: string;
    default_branch: string;
    private: boolean;
    clone_url: string;
    permissions?: { push: boolean; pull: boolean; admin: boolean };
  };
  return {
    accessible: true,
    permissions: data.permissions || { push: false, pull: true, admin: false },
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    private: data.private,
    cloneUrl: data.clone_url,
  };
}
```

**Step 2: Verify the existing `repo.ts` still works by importing from shared**

Temporarily update `repo.ts` to import from `./repo-shared.js` and verify the build passes. This is a sanity check before splitting into two files.

Run: `cd packages/plugin-github && npx tsc --noEmit`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add packages/plugin-github/src/repo-shared.ts
git commit -m "refactor(plugin-github): extract shared repo utilities"
```

---

## Chunk 2: Create the Two Repo Providers

### Task 2: Create `GitHubOAuthRepoProvider`

**Files:**
- Create: `packages/plugin-github/src/repo-oauth.ts`

**Step 1: Write the OAuth repo provider**

```typescript
// packages/plugin-github/src/repo-oauth.ts
import type { RepoProvider, RepoCredential, RepoList } from '@valet/sdk/repos';
import { githubFetch } from './actions/api.js';
import { GITHUB_URL_PATTERNS, mapGitHubRepo, validateGitHubRepo } from './repo-shared.js';

export const githubOAuthRepoProvider: RepoProvider = {
  id: 'github-oauth',
  displayName: 'GitHub (Personal)',
  icon: 'github',
  supportsOrgLevel: false,
  supportsPersonalLevel: true,
  urlPatterns: GITHUB_URL_PATTERNS,

  async listRepos(credential: RepoCredential, opts?) {
    if (!credential.accessToken) {
      throw new Error('GitHub repo listing requires an access token');
    }
    const token = credential.accessToken;
    const page = opts?.page || 1;
    const search = opts?.search;

    if (search) {
      const res = await githubFetch(
        `/search/repositories?q=${encodeURIComponent(search)}+in:name&per_page=30&page=${page}`,
        token,
      );
      const data = (await res.json()) as { items: any[]; total_count: number };
      return {
        repos: data.items.map(mapGitHubRepo),
        hasMore: data.total_count > page * 30,
      };
    }

    const res = await githubFetch(
      `/user/repos?per_page=30&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      token,
    );
    const repos = (await res.json()) as any[];
    return {
      repos: repos.map(mapGitHubRepo),
      hasMore: repos.length === 30,
    };
  },

  validateRepo: validateGitHubRepo,

  async assembleSessionEnv(credential, opts) {
    return {
      envVars: {
        REPO_URL: opts.repoUrl,
        ...(opts.branch ? { REPO_BRANCH: opts.branch } : {}),
        ...(opts.ref ? { REPO_REF: opts.ref } : {}),
      },
      gitConfig: {
        'user.name': opts.gitUser.name,
        'user.email': opts.gitUser.email,
      },
    };
  },

  async mintToken(credential) {
    if (!credential.accessToken) {
      throw new Error('OAuth credential has no access token');
    }
    return { accessToken: credential.accessToken, expiresAt: credential.expiresAt };
  },
};
```

**Step 2: Verify types**

Run: `cd packages/plugin-github && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/plugin-github/src/repo-oauth.ts
git commit -m "feat(plugin-github): add GitHubOAuthRepoProvider"
```

### Task 3: Create `GitHubAppRepoProvider`

**Files:**
- Create: `packages/plugin-github/src/repo-app.ts`

**Step 1: Write the App repo provider**

```typescript
// packages/plugin-github/src/repo-app.ts
import type { RepoProvider, RepoCredential, RepoList } from '@valet/sdk/repos';
import { githubFetch } from './actions/api.js';
import { GITHUB_URL_PATTERNS, mapGitHubRepo, mintInstallationToken, validateGitHubRepo } from './repo-shared.js';

export const githubAppRepoProvider: RepoProvider = {
  id: 'github-app',
  displayName: 'GitHub (App)',
  icon: 'github',
  supportsOrgLevel: true,
  supportsPersonalLevel: false,
  urlPatterns: GITHUB_URL_PATTERNS,

  async listRepos(credential: RepoCredential, opts?) {
    if (!credential.accessToken) {
      throw new Error('GitHub repo listing requires an access token — mint a token first');
    }
    const token = credential.accessToken;
    const page = opts?.page || 1;
    const search = opts?.search;

    if (search) {
      const res = await githubFetch(
        `/search/repositories?q=${encodeURIComponent(search)}+in:name&per_page=30&page=${page}`,
        token,
      );
      const data = (await res.json()) as { items: any[]; total_count: number };
      return {
        repos: data.items.map(mapGitHubRepo),
        hasMore: data.total_count > page * 30,
      };
    }

    const res = await githubFetch(
      `/installation/repositories?per_page=30&page=${page}`,
      token,
    );
    const data = (await res.json()) as { repositories: any[]; total_count: number };
    return {
      repos: data.repositories.map(mapGitHubRepo),
      hasMore: data.total_count > page * 30,
    };
  },

  validateRepo: validateGitHubRepo,

  async assembleSessionEnv(credential, opts) {
    return {
      envVars: {
        REPO_URL: opts.repoUrl,
        ...(opts.branch ? { REPO_BRANCH: opts.branch } : {}),
        ...(opts.ref ? { REPO_REF: opts.ref } : {}),
      },
      gitConfig: {
        'user.name': 'valet[bot]',
        'user.email': 'valet[bot]@users.noreply.github.com',
      },
    };
  },

  async mintToken(credential) {
    if (!credential.installationId) {
      throw new Error('Cannot mint token without installationId');
    }
    const appId = credential.metadata?.appId || credential.metadata?.app_id;
    const privateKey = credential.metadata?.privateKey || credential.metadata?.private_key;
    if (!appId || !privateKey) {
      throw new Error('GitHub App credentials (appId, privateKey) not found in credential');
    }
    const result = await mintInstallationToken(credential.installationId, appId, privateKey);
    return { accessToken: result.token, expiresAt: result.expiresAt };
  },
};
```

**Step 2: Verify types**

Run: `cd packages/plugin-github && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/plugin-github/src/repo-app.ts
git commit -m "feat(plugin-github): add GitHubAppRepoProvider"
```

---

## Chunk 3: Update Plugin Exports and Registry

### Task 4: Update plugin-github package exports

The plugin currently exports a single `./repo` entry. We need to export both providers. The plugin registry script looks for `src/repo.ts` and finds a single `export const ... : RepoProvider`. We need to support multiple providers.

**Files:**
- Modify: `packages/plugin-github/package.json` (update exports)
- Modify: `packages/plugin-github/src/repo.ts` (re-export both providers)

**Step 1: Update `repo.ts` to re-export both providers**

Replace the entire contents of `packages/plugin-github/src/repo.ts` with:

```typescript
// Re-export both repo providers for plugin discovery
export { githubOAuthRepoProvider } from './repo-oauth.js';
export { githubAppRepoProvider } from './repo-app.js';
```

**Step 2: Verify types**

Run: `cd packages/plugin-github && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/plugin-github/src/repo.ts
git commit -m "refactor(plugin-github): re-export both repo providers from repo.ts"
```

### Task 5: Update plugin registry generation script

The script at `packages/worker/scripts/generate-plugin-registry.ts` (lines 140-143) currently looks for a single `export const (\w+)\s*:\s*RepoProvider` in `repo.ts`. It needs to find **all** exported `RepoProvider` constants.

**Files:**
- Modify: `packages/worker/scripts/generate-plugin-registry.ts:140-144`

**Step 1: Update the repo provider discovery logic**

Replace the single-match logic (lines 140-144) with a multi-match version:

```typescript
    const repoPath = resolve(pluginPath, 'src', 'repo.ts');
    if (existsSync(repoPath)) {
      const repoContent = readFileSync(repoPath, 'utf-8');
      const repoExportRegex = /export\s+(?:const\s+(\w+)\s*:\s*RepoProvider|\{\s*(\w+)\s*\})/g;
      let repoMatch;
      while ((repoMatch = repoExportRegex.exec(repoContent)) !== null) {
        const exportName = repoMatch[1] || repoMatch[2];
        if (exportName) repoPlugins.push({ name: dir, pkgName, exportName });
      }
    }
```

Note: The new `repo.ts` uses `export { name } from './file.js'` syntax, so the regex needs to match both `export const name: RepoProvider` and `export { name }`. Since `repo.ts` is now a re-export barrel, the simplest approach is to match named re-exports. The regex above handles both patterns.

**Step 2: Update the generated packages.ts template**

The template (lines 296-305) currently imports all from the same `./repo` export. Since we may have multiple exports from the same package, update the import generation:

```typescript
// ── Repo provider packages ─────────────────────────────────────────────────
mkdirSync(resolve(workerRoot, 'src/repos'), { recursive: true });
const repoLines = [
  HEADER,
  "import type { RepoProvider } from '@valet/sdk/repos';",
  ...repoPlugins.map((p, i) => `import { ${p.exportName} as rp${i} } from '${p.pkgName}/repo';`),
  '',
  `export const installedRepoProviders: RepoProvider[] = [${repoPlugins.map((_, i) => `rp${i}`).join(', ')}];`,
  '',
];
writeFileSync(resolve(workerRoot, 'src/repos/packages.ts'), repoLines.join('\n'));
```

This template already works for multiple exports from the same package — each gets its own import line with a unique alias. No change needed here.

**Step 3: Run the generator and verify output**

Run: `cd packages/worker && bun scripts/generate-plugin-registry.ts`
Expected output: `Generated plugin registries: ... 2 repo provider(s) ...`

Verify `packages/worker/src/repos/packages.ts` now contains:
```typescript
import { githubOAuthRepoProvider as rp0 } from '@valet/plugin-github/repo';
import { githubAppRepoProvider as rp1 } from '@valet/plugin-github/repo';

export const installedRepoProviders: RepoProvider[] = [rp0, rp1];
```

**Step 4: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/worker/scripts/generate-plugin-registry.ts packages/worker/src/repos/packages.ts
git commit -m "feat(worker): support multiple repo providers per plugin in registry"
```

---

## Chunk 4: Generic Credential Resolver

### Task 6: Update registry to support multiple providers per URL

**Files:**
- Modify: `packages/worker/src/repos/registry.ts`

**Step 1: Add `resolveAllByUrl` method**

```typescript
import type { RepoProvider } from '@valet/sdk/repos';
import { installedRepoProviders } from './packages.js';

class RepoProviderRegistry {
  private providers = new Map<string, RepoProvider>();

  register(provider: RepoProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): RepoProvider | undefined {
    return this.providers.get(id);
  }

  /** Resolve which repo provider handles a given URL (first match — legacy) */
  resolveByUrl(repoUrl: string): RepoProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.urlPatterns.some((p) => p.test(repoUrl))) {
        return provider;
      }
    }
    return undefined;
  }

  /** Return ALL providers whose URL patterns match. */
  resolveAllByUrl(repoUrl: string): RepoProvider[] {
    const matches: RepoProvider[] = [];
    for (const provider of this.providers.values()) {
      if (provider.urlPatterns.some((p) => p.test(repoUrl))) {
        matches.push(provider);
      }
    }
    return matches;
  }

  list(): RepoProvider[] {
    return Array.from(this.providers.values());
  }
}

export const repoProviderRegistry = new RepoProviderRegistry();

// Auto-register discovered repo providers
for (const provider of installedRepoProviders) {
  repoProviderRegistry.register(provider);
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/repos/registry.ts
git commit -m "feat(worker): add resolveAllByUrl to repo provider registry"
```

### Task 7: Update credential resolution priority

**Files:**
- Modify: `packages/worker/src/lib/db/credentials.ts:156-176`

**Step 1: Flip priority to user-first**

The current `resolveRepoCredential()` prefers org `app_install` first. Flip it to prefer user-level credentials first, with org-level as fallback. Also make it generic — accept an optional credential type filter so the env-assembly layer can query by specific provider IDs.

Replace `resolveRepoCredential` (lines 162-176) with:

```typescript
/**
 * Resolve a repo-level credential, preferring:
 * 1. user-level oauth2 (personal GitHub OAuth — commits as user)
 * 2. org-level app_install (GitHub App — commits as bot)
 * 3. user-level app_install (legacy fallback)
 */
export async function resolveRepoCredential(
  db: AppDb,
  provider: string,
  orgId: string | undefined,
  userId: string,
): Promise<{ credential: CredentialRow; credentialType: 'oauth2' | 'app_install' } | null> {
  // 1. User's personal OAuth token (highest priority)
  const userOAuth = await getCredentialRow(db, 'user', userId, provider, 'oauth2');
  if (userOAuth) return { credential: userOAuth, credentialType: 'oauth2' };
  // 2. Org-level app installation
  if (orgId) {
    const orgInstall = await getCredentialRow(db, 'org', orgId, provider, 'app_install');
    if (orgInstall) return { credential: orgInstall, credentialType: 'app_install' };
  }
  // 3. User-level app installation (legacy)
  const userInstall = await getCredentialRow(db, 'user', userId, provider, 'app_install');
  if (userInstall) return { credential: userInstall, credentialType: 'app_install' };
  return null;
}
```

Note: The return type now includes `credentialType` so callers can map to the correct `RepoProvider`.

**Step 2: Commit**

```bash
git add packages/worker/src/lib/db/credentials.ts
git commit -m "feat(worker): flip repo credential priority to user-first"
```

### Task 8: Update `assembleRepoEnv` to use dual-provider resolution

**Files:**
- Modify: `packages/worker/src/lib/env-assembly.ts:147-247`

**Step 1: Update `assembleRepoEnv` to resolve provider from credential type**

The key change: instead of resolving a single provider by URL, resolve the credential first, then pick the matching provider based on credential type.

Replace `assembleRepoEnv` (lines 147-247) with:

```typescript
/**
 * Assemble repo env vars (token + repo/branch config) for a session,
 * using the repo provider registry to resolve the correct provider.
 *
 * Resolution priority:
 * 1. User's personal OAuth token → GitHubOAuthRepoProvider (commits as user)
 * 2. Org's App installation → GitHubAppRepoProvider (commits as bot)
 */
export async function assembleRepoEnv(
  appDb: AppDb,
  env: Env,
  userId: string,
  orgId: string | undefined,
  opts: { repoUrl?: string; branch?: string; ref?: string },
): Promise<{ envVars: Record<string, string>; gitConfig: Record<string, string>; token?: string; expiresAt?: string; error?: string }> {
  const envVars: Record<string, string> = {};
  const gitConfig: Record<string, string> = {};

  if (!opts.repoUrl) {
    return { envVars, gitConfig };
  }

  // 1. Find all providers that handle this URL
  const providers = repoProviderRegistry.resolveAllByUrl(opts.repoUrl);
  if (providers.length === 0) {
    return { envVars, gitConfig, error: `No repo provider found for URL: ${opts.repoUrl}` };
  }

  // Use the first provider's base ID for credential lookup
  // (all GitHub providers share 'github' as the credential provider name)
  const credentialProvider = providers[0].urlPatterns === providers[0].urlPatterns ? 'github' : providers[0].id;

  // 2. Resolve the credential (user-first priority)
  const resolved = await credentialDb.resolveRepoCredential(appDb, credentialProvider, orgId, userId);
  if (!resolved) {
    return {
      envVars,
      gitConfig,
      error: `No GitHub credentials found. Link your GitHub account or ask an org admin to install the GitHub App.`,
    };
  }

  // 3. Pick the right provider based on credential type
  const providerId = resolved.credentialType === 'oauth2' ? 'github-oauth' : 'github-app';
  const provider = repoProviderRegistry.get(providerId);
  if (!provider) {
    return { envVars, gitConfig, error: `Repo provider '${providerId}' not registered` };
  }

  const credRow = resolved.credential;

  // 4. Decrypt credential data and build RepoCredential
  let credData: Record<string, unknown>;
  try {
    const json = await decryptStringPBKDF2(credRow.encryptedData, env.ENCRYPTION_KEY);
    credData = JSON.parse(json);
  } catch {
    return {
      envVars,
      gitConfig,
      error: `Failed to decrypt GitHub credentials`,
    };
  }

  const metadata: Record<string, string> = credRow.metadata ? JSON.parse(credRow.metadata) : {};
  for (const [k, v] of Object.entries(credData)) {
    if (typeof v === 'string') metadata[k] = v;
  }
  const repoCredential: RepoCredential = {
    type: credRow.credentialType === 'app_install' ? 'installation' : 'token',
    installationId: metadata.installationId || metadata.installation_id,
    accessToken: (credData.access_token || credData.token) as string | undefined,
    expiresAt: credRow.expiresAt ?? undefined,
    metadata,
  };

  // 5. Mint a fresh token
  let freshToken: { accessToken: string; expiresAt?: string };
  try {
    freshToken = await provider.mintToken(repoCredential);
  } catch (err) {
    return {
      envVars,
      gitConfig,
      error: `Failed to mint GitHub token: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 6. Get git user info from users table (only used for OAuth provider)
  const userRow = await db.getUserById(appDb, userId);
  const gitUser = {
    name: userRow?.gitName || userRow?.name || 'Valet User',
    email: userRow?.gitEmail || userRow?.email || '',
  };

  // 7. Build a credential with the fresh token for assembleSessionEnv
  const freshCredential: RepoCredential = {
    ...repoCredential,
    accessToken: freshToken.accessToken,
    expiresAt: freshToken.expiresAt,
  };

  // 8. Call provider.assembleSessionEnv()
  // Note: App provider ignores gitUser and uses valet[bot] identity
  const sessionEnv = await provider.assembleSessionEnv(freshCredential, {
    repoUrl: opts.repoUrl,
    branch: opts.branch,
    ref: opts.ref,
    gitUser,
  });

  sessionEnv.envVars.REPO_PROVIDER_ID = provider.id;

  return {
    envVars: sessionEnv.envVars,
    gitConfig: sessionEnv.gitConfig,
    token: freshToken.accessToken,
    expiresAt: freshToken.expiresAt,
  };
}
```

**Important note on the `credentialProvider` mapping:** The credential DB stores credentials under the provider name `'github'` (not `'github-oauth'` or `'github-app'`). Both OAuth and App credentials use `'github'` as the `provider` column value, differentiated by `credentialType` (`'oauth2'` vs `'app_install'`). The new code needs to map from URL-matched providers back to the shared credential provider name `'github'`.

A cleaner approach: add a `credentialProvider` field to the `RepoProvider` interface so each provider declares which credential provider name it uses. For now, hardcoding `'github'` works since it's the only provider. Add a TODO for the generic version.

**Step 2: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/worker/src/lib/env-assembly.ts
git commit -m "feat(worker): use dual-provider credential resolution in assembleRepoEnv"
```

---

## Chunk 5: Update Credential Storage for OAuth Repo Access

### Task 9: Separate GitHub identity OAuth from repo OAuth

Currently, `githubIdentityProvider` requests `read:user user:email` scopes. Users who want repo access via OAuth need a **separate** credential with `repo` scope. This requires a new OAuth flow for linking GitHub repo access.

**Files:**
- Modify: `packages/worker/src/routes/repo-providers.ts` — add OAuth link flow for `github-oauth` provider
- Check: `packages/worker/src/routes/oauth.ts` — understand existing OAuth flow to reuse

**Step 1: Add an OAuth link endpoint for the `github-oauth` repo provider**

Add a new route to `repo-providers.ts` that initiates a GitHub OAuth flow with `repo` scope. This is separate from the identity login flow.

```typescript
// GET /api/repo-providers/github-oauth/link
// Initiates GitHub OAuth with `repo` scope for repo access
repoProviderRouter.get('/github-oauth/link', async (c) => {
  const user = c.get('user');

  const clientId = c.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const state = await signJWT(
    { sub: user.id, purpose: 'repo-link', iat: now, exp: now + 10 * 60 } as any,
    c.env.ENCRYPTION_KEY,
  );

  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';
  const redirectUri = `${frontendUrl.replace(/\/$/, '')}/auth/github/repo-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo',
    state,
  });

  return c.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});
```

**Step 2: Add callback handler for repo OAuth**

This callback exchanges the code for a token and stores it as a user-level `oauth2` credential under the `'github'` provider.

```typescript
// GET /auth/github/repo-callback — mounted outside /api/* (no auth middleware)
repoProviderCallbackRouter.get('/github-oauth/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code || !stateParam) {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=missing_params`);
  }

  const payload = await verifyJWT(stateParam, c.env.ENCRYPTION_KEY);
  if (!payload || !payload.sub || (payload as any).purpose !== 'repo-link') {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=invalid_state`);
  }
  const userId = payload.sub as string;

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return c.redirect(`${frontendUrl}/settings?tab=repositories&error=token_exchange_failed`);
  }

  // Store as user-level oauth2 credential for the 'github' provider
  await storeCredential(c.env, 'user', userId, 'github', {
    access_token: tokenData.access_token,
  }, {
    credentialType: 'oauth2',
  });

  return c.redirect(`${frontendUrl}/settings?tab=repositories&linked=true`);
});
```

**Step 3: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/worker/src/routes/repo-providers.ts
git commit -m "feat(worker): add GitHub OAuth repo-link flow with repo scope"
```

---

## Chunk 6: Update App Installation to Store at Org Level

### Task 10: Fix App installation callback to use org-level storage

**Files:**
- Modify: `packages/worker/src/routes/repo-providers.ts:76-130`

The current callback (line 104-108) always stores as `user`-level even when `level === 'org'`, with a `console.warn`. Update to properly store org-level credentials.

**Step 1: Update callback to support org-level storage**

This requires passing the `orgId` in the signed state JWT. Update the install URL generation (lines 24-47) to include `orgId`:

```typescript
repoProviderRouter.get('/:provider/install', async (c) => {
  const providerId = c.req.param('provider');
  const level = c.req.query('level') || 'personal';
  const user = c.get('user');

  if (providerId !== 'github') {
    return c.json({ error: 'Only GitHub App installation is supported' }, 400);
  }

  const appSlug = c.env.GITHUB_APP_SLUG;
  if (!appSlug) {
    return c.json({ error: 'GitHub App not configured' }, 500);
  }

  // For org-level installs, include the org ID in the state
  const orgId = c.get('orgId'); // assumes orgId is set by auth middleware
  if (level === 'org' && !orgId) {
    return c.json({ error: 'Org context required for org-level install' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const state = await signJWT(
    { sub: user.id, sid: level, orgId: level === 'org' ? orgId : undefined, iat: now, exp: now + 10 * 60 } as any,
    c.env.ENCRYPTION_KEY,
  );
  const installUrl = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  return c.json({ url: installUrl });
});
```

Update the callback (lines 76-130) to use orgId from the JWT:

```typescript
  const userId = payload.sub as string;
  const level = (payload as any).sid || 'personal';
  const orgId = (payload as any).orgId;

  const ownerType = level === 'org' && orgId ? 'org' as const : 'user' as const;
  const ownerId = level === 'org' && orgId ? orgId : userId;
```

**Step 2: Verify types**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/worker/src/routes/repo-providers.ts
git commit -m "feat(worker): store GitHub App installations at org level"
```

---

## Chunk 7: Cleanup and Verification

### Task 11: Remove old single-provider code

**Files:**
- Verify: `packages/plugin-github/src/repo.ts` only contains re-exports (done in Task 4)
- Verify: no other files import `githubRepoProvider` directly

**Step 1: Search for remaining references to `githubRepoProvider`**

Run: `grep -r "githubRepoProvider" packages/ --include="*.ts" -l`

Expected: Only `packages/plugin-github/src/repo.ts` (re-export barrel) and `packages/worker/src/repos/packages.ts` (auto-generated, should now reference both providers).

If any other files reference `githubRepoProvider`, update them.

**Step 2: Full type check**

Run: `cd packages/worker && npx tsc --noEmit && cd ../plugin-github && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: clean up references to old single github repo provider"
```

### Task 12: End-to-end verification

**Step 1: Run the full build**

Run: `bun run build` (or equivalent monorepo build command)
Expected: PASS — no type errors across all packages

**Step 2: Run existing tests**

Run: `bun test` (or equivalent)
Expected: All existing tests pass. Some may need updates if they reference `githubRepoProvider` directly.

**Step 3: Manual verification checklist**

- [ ] `resolveRepoCredential` returns user OAuth credential when both user OAuth and org App exist
- [ ] `resolveRepoCredential` returns org App credential when no user OAuth exists
- [ ] `assembleRepoEnv` picks `github-oauth` provider for OAuth credentials
- [ ] `assembleRepoEnv` picks `github-app` provider for App credentials
- [ ] App provider sets git user to `valet[bot]`
- [ ] OAuth provider sets git user to the human's name/email

**Step 4: Final commit**

```bash
git commit -m "feat: GitHub dual repo provider — OAuth + App with credential priority"
```
