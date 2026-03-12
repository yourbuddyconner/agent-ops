# Identity & Repository Providers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Valet's GitHub OAuth into separate identity provider and repository provider plugin abstractions, replacing the `repo`-scoped OAuth with a GitHub App model and adding email/password login as the default.

**Architecture:** Two new SDK contracts (`IdentityProvider`, `RepoProvider`) join the existing `IntegrationProvider`. The credentials table gains polymorphic ownership (`owner_type`/`owner_id`) for org-level credentials. The runner takes over git config and repo cloning from `start.sh`. Login becomes provider-agnostic; repo access is scoped to GitHub App installations.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, D1 (SQLite), React, Zustand, TanStack Router/Query, Bun (runner), GitHub Apps API

**Design Spec:** `docs/specs/2026-03-12-identity-repo-providers-design.md`

---

## Chunk 1: SDK Contracts & Credential Schema

Foundation layer — defines the new type contracts and migrates the credential storage.

### Task 1: Add IdentityProvider and RepoProvider SDK contracts

**Files:**
- Create: `packages/sdk/src/identity/index.ts`
- Create: `packages/sdk/src/repos/index.ts`
- Modify: `packages/sdk/package.json` (add exports)
- Modify: `packages/sdk/tsconfig.json` (if needed)

- [ ] **Step 1: Create the IdentityProvider contract**

Create `packages/sdk/src/identity/index.ts`:

```typescript
// ─── Identity Provider Contract ──────────────────────────────────────────────

export type IdentityProtocol = 'oauth2' | 'oidc' | 'saml' | 'credentials';

export interface ProviderConfig {
  clientId?: string;
  clientSecret?: string;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  [key: string]: string | undefined;
}

export interface CallbackData {
  code?: string;
  samlResponse?: string;
  email?: string;
  password?: string;
  state?: string;
}

export interface IdentityResult {
  externalId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  username?: string;
}

export interface IdentityProvider {
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  readonly brandColor?: string;
  readonly protocol: IdentityProtocol;
  readonly configKeys: string[];  // env var keys needed (e.g. ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'])

  // Redirect URL for OAuth/OIDC/SAML. Not present on 'credentials' protocol.
  getAuthUrl?(config: ProviderConfig, callbackUrl: string, state: string): string;
  handleCallback(config: ProviderConfig, callbackData: CallbackData): Promise<IdentityResult>;
}

export interface IdentityProviderPackage {
  provider: IdentityProvider;
}
```

- [ ] **Step 2: Create the RepoProvider contract**

Create `packages/sdk/src/repos/index.ts`:

```typescript
import type { ActionSource, TriggerSource } from '../integrations/index.js';

// ─── Repository Provider Contract ────────────────────────────────────────────

export interface RepoCredential {
  type: 'installation' | 'token';
  installationId?: string;
  accessToken?: string;
  expiresAt?: string;
  metadata?: Record<string, string>;  // provider-specific config (e.g. appId, privateKey for GitHub App)
}

export interface SessionRepoEnv {
  envVars: Record<string, string>;
  gitConfig: Record<string, string>;
}

export interface RepoListItem {
  fullName: string;
  url: string;
  defaultBranch: string;
  private: boolean;
}

export interface RepoList {
  repos: RepoListItem[];
  hasMore: boolean;
}

export interface RepoValidation {
  accessible: boolean;
  permissions?: { push: boolean; pull: boolean; admin: boolean };
  error?: string;
}

export interface RepoProvider {
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  readonly supportsOrgLevel: boolean;
  readonly supportsPersonalLevel: boolean;
  readonly urlPatterns: RegExp[];  // patterns to match repo URLs (e.g. /github\.com/)

  listRepos(credential: RepoCredential, opts?: { page?: number; search?: string }): Promise<RepoList>;
  validateRepo(credential: RepoCredential, repoUrl: string): Promise<RepoValidation>;
  assembleSessionEnv(credential: RepoCredential, opts: {
    repoUrl: string;
    branch?: string;
    ref?: string;
    gitUser: { name: string; email: string };
  }): Promise<SessionRepoEnv>;
  mintToken(credential: RepoCredential): Promise<{ accessToken: string; expiresAt?: string }>;

  getActionSource?(credential: RepoCredential): ActionSource;
  getTriggerSource?(): TriggerSource;
}

export interface RepoProviderPackage {
  provider: RepoProvider;
}
```

- [ ] **Step 3: Add SDK package exports**

Add to `packages/sdk/package.json` exports map:

```json
"./identity": {
  "types": "./dist/identity/index.d.ts",
  "import": "./dist/identity/index.js"
},
"./repos": {
  "types": "./dist/repos/index.d.ts",
  "import": "./dist/repos/index.js"
}
```

Note: Match the existing SDK export pattern (all other exports point to `./dist/`, not `./src/`). Run the SDK build after adding new files.

- [ ] **Step 4: Typecheck**

Run: `cd packages/sdk && pnpm typecheck`
Expected: PASS — no consumers yet, just new exports

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/identity/ packages/sdk/src/repos/ packages/sdk/package.json
git commit -m "feat(sdk): add IdentityProvider and RepoProvider contracts"
```

---

### Task 2: Migrate credentials table to polymorphic owner

**Files:**
- Create: `packages/worker/migrations/NNNN_credentials_polymorphic_owner.sql`
- Modify: `packages/worker/src/lib/schema/credentials.ts`
- Modify: `packages/worker/src/lib/schema/index.ts` (if re-export changes)

- [ ] **Step 1: Determine next migration number**

Run: `ls packages/worker/migrations/ | tail -5`

Use the next sequential number (e.g., if last is `0055_name.sql`, use `0056`).

- [ ] **Step 2: Write the migration SQL**

Create `packages/worker/migrations/NNNN_credentials_polymorphic_owner.sql`:

```sql
-- Recreate credentials table with polymorphic owner (owner_type + owner_id)
-- SQLite does not support ALTER COLUMN, so we use the table-recreation pattern.

CREATE TABLE credentials_new (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL DEFAULT 'user',
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL DEFAULT 'oauth2',
  encrypted_data TEXT NOT NULL,
  metadata TEXT,
  scopes TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO credentials_new (id, owner_type, owner_id, provider, credential_type, encrypted_data, scopes, expires_at, created_at, updated_at)
  SELECT id, 'user', user_id, provider, COALESCE(credential_type, 'oauth2'), encrypted_data, scopes, expires_at, created_at, updated_at
  FROM credentials;

DROP TABLE credentials;
ALTER TABLE credentials_new RENAME TO credentials;

CREATE UNIQUE INDEX credentials_owner_unique ON credentials(owner_type, owner_id, provider, credential_type);
CREATE INDEX credentials_owner_lookup ON credentials(owner_type, owner_id);
CREATE INDEX credentials_provider ON credentials(provider);
```

- [ ] **Step 3: Update Drizzle schema**

Replace the contents of `packages/worker/src/lib/schema/credentials.ts`:

```typescript
import { sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const credentials = sqliteTable('credentials', {
  id: text().primaryKey(),
  ownerType: text().notNull().default('user'),
  ownerId: text().notNull(),
  provider: text().notNull(),
  credentialType: text().notNull().default('oauth2'),
  encryptedData: text().notNull(),
  metadata: text(),
  scopes: text(),
  expiresAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('credentials_owner_unique').on(table.ownerType, table.ownerId, table.provider, table.credentialType),
  index('credentials_owner_lookup').on(table.ownerType, table.ownerId),
  index('credentials_provider').on(table.provider),
]);
```

Note: Use the no-argument `text()` style to match existing codebase convention (see `users.ts`, existing `credentials.ts`). Check the exact import of `sql` — it may be `import { sql } from 'drizzle-orm';`.

- [ ] **Step 4: Verify schema re-export**

Check that `packages/worker/src/lib/schema/index.ts` re-exports credentials. It likely already does — confirm the export name matches.

- [ ] **Step 5: Do NOT commit yet**

The Drizzle schema now references `ownerType`/`ownerId` but the DB helpers and service still reference `userId`. Proceed directly to Task 3 — schema + DB helpers + service are committed together to avoid a broken intermediate state.

---

### Task 3: Update credentials DB helpers for polymorphic owner

**Files:**
- Modify: `packages/worker/src/lib/db/credentials.ts`

- [ ] **Step 1: Read the current DB helpers**

Read: `packages/worker/src/lib/db/credentials.ts`

Understand the existing functions and their callers. All functions currently take `userId` — they need to accept `ownerType`/`ownerId` instead.

- [ ] **Step 2: Update all credential DB helpers**

Replace `userId` parameter with `ownerType`/`ownerId` in all functions. Key changes:

- `getCredentialRow(db, ownerType, ownerId, provider, credentialType?)` — query by `owner_type`, `owner_id`, `provider`, optionally `credential_type`
- `upsertCredential(db, data)` — `data` includes `ownerType`, `ownerId` instead of `userId`. Conflict target changes to `(owner_type, owner_id, provider, credential_type)`
- `deleteCredential(db, ownerType, ownerId, provider)` — updated where clause
- `listCredentialsByUser(db, userId)` — becomes `listCredentialsByOwner(db, ownerType, ownerId)`
- `hasCredential(db, ownerType, ownerId, provider)` — updated where clause
- `getExpiringCredentials(db, windowSeconds)` — returns `ownerType`/`ownerId` instead of `userId`

Add a new helper for repo credential resolution:

```typescript
export async function resolveRepoCredential(
  db: AppDb,
  provider: string,
  orgId: string | undefined,
  userId: string,
): Promise<CredentialRow | null> {
  // Try org-level first
  if (orgId) {
    const orgCred = await getCredentialRow(db, 'org', orgId, provider, 'app_install');
    if (orgCred) return orgCred;
  }
  // Fall back to user-level
  return getCredentialRow(db, 'user', userId, provider, 'app_install');
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: FAIL — callers of old API signatures will break. Note the failures for Task 4.

- [ ] **Step 4: Do NOT commit yet**

Continue to Task 4 — the schema, DB helpers, and service callers must all compile before committing.

---

### Task 4: Update credentials service for polymorphic owner

**Files:**
- Modify: `packages/worker/src/services/credentials.ts`

- [ ] **Step 1: Read the current credentials service**

Read: `packages/worker/src/services/credentials.ts`

Understand how `getCredential`, `storeCredential`, `revokeCredential`, `listCredentials` use the DB helpers. These are the main public API surface.

- [ ] **Step 2: Update public API signatures**

All functions that currently take `userId: string` gain `ownerType: string` and `ownerId: string`:

- `getCredential(env, ownerType, ownerId, provider, options?)` — updated lookup
- `storeCredential(env, ownerType, ownerId, provider, credentialData, options?)` — `options` gains optional `metadata: Record<string, unknown>` for the new metadata column
- `revokeCredential(env, ownerType, ownerId, provider)` — updated delete
- `listCredentials(env, ownerType, ownerId)` — updated list

Add a convenience overload or wrapper for backward compat during migration:

```typescript
// Convenience for user-level credentials (most common case)
export function getUserCredential(env: Env, userId: string, provider: string, options?: CredentialOptions) {
  return getCredential(env, 'user', userId, provider, options);
}
```

- [ ] **Step 3: Update all callers of credentials service**

Search for all callers:

Run: `grep -rn "getCredential\|storeCredential\|revokeCredential\|listCredentials" packages/worker/src/ --include="*.ts" | grep -v "credentials.ts" | grep -v "node_modules"`

Update each caller to pass `ownerType`/`ownerId`. Key callers:
- `packages/worker/src/services/credentials.ts` — internal `getCredentialRow` call (~line 276), and `refreshExpiringCredentials` (~line 417) which iterates expiring credentials by `userId`
- `packages/worker/src/services/oauth.ts` — `storeCredential` calls in `handleGitHubCallback` and `handleGoogleCallback`
- `packages/worker/src/lib/env-assembly.ts` — `getCredential` in `assembleGitHubEnv` and `assembleCredentialEnv`
- `packages/worker/src/durable-objects/session-agent.ts` — credential resolution in `executeAction`
- `packages/worker/src/routes/integrations.ts` — credential CRUD routes
- `packages/worker/src/routes/repos.ts` — `getCredential` for GitHub token

For now, use `'user'` as `ownerType` for all existing callers — this preserves current behavior. Org-level credential usage comes in Chunk 3.

- [ ] **Step 4: Update DO credential cache key format**

In `packages/worker/src/durable-objects/session-agent.ts`, find the `credentialCache` map. Update cache key format from `userId:service` to `ownerType:ownerId:service:credentialType`.

- [ ] **Step 5: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS — all callers updated

- [ ] **Step 6: Commit Tasks 2, 3, and 4 together**

This single commit includes the migration, Drizzle schema, DB helpers, service, and all updated callers:

```bash
git add packages/worker/migrations/ packages/worker/src/lib/schema/credentials.ts packages/worker/src/lib/db/credentials.ts packages/worker/src/services/credentials.ts packages/worker/src/services/oauth.ts packages/worker/src/lib/env-assembly.ts packages/worker/src/durable-objects/session-agent.ts packages/worker/src/routes/integrations.ts packages/worker/src/routes/repos.ts
git commit -m "feat(worker): migrate credentials to polymorphic owner model

Recreates the credentials table with owner_type/owner_id replacing
user_id. Updates Drizzle schema, DB helpers, credentials service, and
all callers to use the new polymorphic owner pattern."
```

---

## Chunk 2: Identity Provider System

Implements the identity provider plugin abstraction, email/password login, and refactors the existing OAuth login flows.

### Task 5: Create email/password identity provider plugin

**Files:**
- Create: `packages/plugin-email-auth/plugin.yaml`
- Create: `packages/plugin-email-auth/package.json`
- Create: `packages/plugin-email-auth/tsconfig.json`
- Create: `packages/plugin-email-auth/src/identity.ts`
- Create: `packages/plugin-email-auth/src/index.ts`

- [ ] **Step 1: Create plugin directory and manifest**

Create `packages/plugin-email-auth/plugin.yaml`:

```yaml
name: email-auth
version: 0.1.0
description: Email/password identity provider
icon: key
enabled: true
```

Create `packages/plugin-email-auth/package.json`:

```json
{
  "name": "@valet/plugin-email-auth",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./identity": "./src/identity.ts"
  },
  "dependencies": {
    "@valet/sdk": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

Create `packages/plugin-email-auth/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Implement the email/password identity provider**

Create `packages/plugin-email-auth/src/identity.ts`:

```typescript
import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterStr, saltHex, hashHex] = stored.split(':');
  const iterations = parseInt(iterStr, 10);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === hashHex;
}

export const emailIdentityProvider: IdentityProvider = {
  id: 'email',
  displayName: 'Email',
  icon: 'key',
  protocol: 'credentials',
  configKeys: [],

  // No getAuthUrl — credentials protocol doesn't use redirects (method is optional on interface)

  async handleCallback(_config: ProviderConfig, data: CallbackData): Promise<IdentityResult> {
    if (!data.email || !data.password) {
      throw new Error('Email and password are required');
    }
    // Note: actual password verification against stored hash happens in the worker's
    // auth route, not here. This provider returns the identity claim.
    // The worker route calls verifyPassword() separately before calling handleCallback().
    return {
      externalId: data.email.toLowerCase(),
      email: data.email.toLowerCase(),
    };
  },
};

export { hashPassword, verifyPassword };
```

Create `packages/plugin-email-auth/src/index.ts`:

```typescript
export { emailIdentityProvider, hashPassword, verifyPassword } from './identity.js';
```

- [ ] **Step 3: Add to root workspace**

Add `"@valet/plugin-email-auth": "workspace:*"` to `packages/worker/package.json` dependencies.

Add tsconfig reference to root `tsconfig.json` and `packages/worker/tsconfig.json`.

- [ ] **Step 4: Run pnpm install**

Run: `pnpm install`

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-email-auth/ packages/worker/package.json pnpm-lock.yaml tsconfig.json packages/worker/tsconfig.json
git commit -m "feat: add email/password identity provider plugin"
```

---

### Task 6: Extract GitHub and Google identity providers from OAuth service

**Files:**
- Create: `packages/plugin-github/src/identity.ts`
- Modify: `packages/plugin-github/src/index.ts`
- Create: `packages/plugin-google/plugin.yaml` (if not exists — check first)
- Create: `packages/plugin-google/src/identity.ts` (or add to existing Google plugin)

- [ ] **Step 1: Check if a Google plugin exists**

Run: `ls packages/plugin-google*/ 2>/dev/null || echo "no google plugin"`

If Google plugins exist (google-calendar, google-drive, etc.), decide whether to add identity to one of them or create a new `plugin-google-auth` package. Likely create `packages/plugin-google-auth/` as a separate identity-only plugin.

- [ ] **Step 2: Create GitHub identity provider**

Create `packages/plugin-github/src/identity.ts`:

```typescript
import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

export const githubIdentityProvider: IdentityProvider = {
  id: 'github',
  displayName: 'GitHub',
  icon: 'github',
  brandColor: '#24292e',
  protocol: 'oauth2',
  configKeys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],

  getAuthUrl(config: ProviderConfig, callbackUrl: string, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId!,
      redirect_uri: callbackUrl,
      scope: 'read:user user:email',  // No repo scope!
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  },

  async handleCallback(config: ProviderConfig, data: CallbackData): Promise<IdentityResult> {
    if (!data.code) throw new Error('Missing authorization code');

    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: data.code,
      }),
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error || 'Token exchange failed');
    }

    // Fetch profile
    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Valet',
      },
    });
    if (!profileRes.ok) throw new Error('Failed to fetch GitHub profile');

    const profile = await profileRes.json() as {
      id: number; login: string; name: string | null; email: string | null; avatar_url: string;
    };

    // If email is private, fetch from /user/emails
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Valet',
        },
      });
      if (emailsRes.ok) {
        const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find(e => e.primary && e.verified);
        email = primary?.email || emails.find(e => e.verified)?.email || null;
      }
    }

    if (!email) throw new Error('No verified email found on GitHub account');

    return {
      externalId: String(profile.id),
      email,
      name: profile.name || profile.login,
      avatarUrl: profile.avatar_url,
      username: profile.login,
    };
  },
};
```

- [ ] **Step 3: Export from GitHub plugin**

Add to `packages/plugin-github/src/index.ts`:

```typescript
export { githubIdentityProvider } from './identity.js';
```

- [ ] **Step 4: Create Google identity provider**

Create `packages/plugin-google-auth/` with the same structure as email-auth. The `handleCallback` method does the existing Google token exchange + id_token decode logic from `packages/worker/src/services/oauth.ts`.

```typescript
export const googleIdentityProvider: IdentityProvider = {
  id: 'google',
  displayName: 'Google',
  icon: 'google',
  brandColor: '#4285f4',
  protocol: 'oidc',
  configKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  // ... getAuthUrl and handleCallback extracted from existing oauth.ts
};
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-github/src/identity.ts packages/plugin-github/src/index.ts packages/plugin-google-auth/
git commit -m "feat: extract GitHub and Google identity providers into plugins"
```

---

### Task 7: Create identity provider registry and generic auth routes

**Files:**
- Create: `packages/worker/src/identity/registry.ts`
- Modify: `packages/worker/src/routes/oauth.ts` (replace with generic identity provider routes)
- Modify: `packages/worker/src/services/oauth.ts` (refactor to use identity providers)
- Modify: `packages/worker/src/index.ts` (mount new routes)
- Modify: `packages/worker/src/env.ts` (add any new env vars)

- [ ] **Step 1: Create identity provider registry**

Create `packages/worker/src/identity/registry.ts`:

```typescript
import type { IdentityProvider } from '@valet/sdk/identity';

class IdentityProviderRegistry {
  private providers = new Map<string, IdentityProvider>();

  register(provider: IdentityProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): IdentityProvider | undefined {
    return this.providers.get(id);
  }

  list(): IdentityProvider[] {
    return Array.from(this.providers.values());
  }

  listEnabled(): IdentityProvider[] {
    // TODO: filter by org settings once admin config is implemented
    return this.list();
  }
}

export const identityRegistry = new IdentityProviderRegistry();
```

The registry is initialized at worker startup by importing identity providers from the auto-generated registry (updated in Task 9).

- [ ] **Step 2: Add users table columns for email/password**

Create migration `packages/worker/migrations/NNNN_users_password_hash.sql`:

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN identity_provider TEXT;
```

Update the Drizzle schema for users accordingly.

- [ ] **Step 3: Refactor OAuth routes to generic identity provider routes**

Rewrite `packages/worker/src/routes/oauth.ts`. Note the route mount distinction:

**JSON API routes** (mounted under `/api/auth/` in `index.ts`):
- `GET /api/auth/providers` — returns list of enabled identity providers with display metadata (id, displayName, icon, brandColor, protocol). No auth required.

**Redirect-based auth routes** (mounted under `/auth/` in `index.ts`, same as current):
- `GET /auth/:provider` — redirect-based login. Looks up the IdentityProvider by ID, calls `getAuthUrl()`, redirects. Rejects if provider protocol is `'credentials'`.
- `GET /auth/:provider/callback` — handles OAuth/OIDC redirect callbacks. Calls `handleCallback()`.
- `POST /auth/:provider/callback` — handles SAML POST callbacks. Calls `handleCallback()`.
- `POST /auth/email/login` — email/password login. Validates email+password against stored hash, then calls `handleCallback()` to get identity result.
- `POST /auth/email/register` — email/password registration. Hashes password, creates user, returns session.

All callback paths converge on the same user-upsert and session-creation logic extracted from the current `handleGitHubCallback`/`handleGoogleCallback`.

- [ ] **Step 4: Extract common user-upsert logic from oauth service**

Refactor `packages/worker/src/services/oauth.ts`:

Extract the user find/create, email gating, invite handling, git config inference, and session creation into a shared function:

```typescript
export async function finalizeIdentityLogin(
  env: Env,
  identity: IdentityResult,
  providerId: string,
  inviteCode?: string,
): Promise<OAuthCallbackResult> {
  // ... email gating, user find/create, invite handling, session creation
  // Reuses existing logic from handleGitHubCallback/handleGoogleCallback
}
```

The provider-specific code (GitHub profile fetching, Google id_token decoding) is now in the identity provider plugins. The oauth service becomes a thin wrapper.

- [ ] **Step 5: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/identity/ packages/worker/src/routes/oauth.ts packages/worker/src/services/oauth.ts packages/worker/migrations/ packages/worker/src/lib/schema/
git commit -m "feat(worker): generic identity provider routes and registry"
```

---

### Task 8: Update login page for dynamic identity providers

**Files:**
- Modify: `packages/client/src/components/auth/login-form.tsx`
- Modify: `packages/client/src/routes/login.tsx` (if needed)
- Create: `packages/client/src/api/auth.ts` (query hook for providers)

- [ ] **Step 1: Create auth API hook**

Create `packages/client/src/api/auth.ts`:

```typescript
import { apiClient } from './client';

export interface AuthProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  brandColor?: string;
  protocol: 'oauth2' | 'oidc' | 'saml' | 'credentials';
}

export const authKeys = {
  providers: ['auth', 'providers'] as const,
};

export async function fetchAuthProviders(): Promise<AuthProviderInfo[]> {
  return apiClient<AuthProviderInfo[]>('/auth/providers');
}
```

- [ ] **Step 2: Update login form to be dynamic**

Modify `packages/client/src/components/auth/login-form.tsx`:

- Fetch providers via `useQuery({ queryKey: authKeys.providers, queryFn: fetchAuthProviders })`
- Render redirect-based providers (OAuth/OIDC/SAML) as branded buttons using `icon` and `brandColor`
- Render `credentials` protocol as an email/password form with register/login toggle
- Icon map: `{ github: <GithubIcon />, google: <GoogleIcon />, key: <KeyIcon />, shield: <ShieldIcon /> }`
- Skeleton loader while providers are loading

- [ ] **Step 3: Typecheck**

Run: `cd packages/client && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/api/auth.ts packages/client/src/components/auth/login-form.tsx
git commit -m "feat(client): dynamic login page based on enabled identity providers"
```

---

## Chunk 3: Repository Provider System

Implements the GitHub App repo provider, refactors session creation, and updates agent tool credential resolution.

### Task 9: Update generate-registries script for identity and repo providers

**Files:**
- Modify: `packages/worker/scripts/generate-plugin-registry.ts`

- [ ] **Step 1: Read the current script**

Read: `packages/worker/scripts/generate-plugin-registry.ts`

Understand how it discovers and generates registries for actions and channels.

- [ ] **Step 2: Add identity and repo provider discovery to the generator**

In `packages/worker/scripts/generate-plugin-registry.ts`, extend the main plugin scan loop. The existing loop checks `existsSync(resolve(pluginPath, 'src', 'actions', 'index.ts'))` for action plugins and `existsSync(resolve(pluginPath, 'src', 'channels', 'index.ts'))` for channel plugins. Add two new checks:

```typescript
// Inside the plugin directory iteration loop:
if (existsSync(resolve(pluginPath, 'src', 'identity.ts'))) {
  identityPlugins.push({ name: dir, pkgName });
}
if (existsSync(resolve(pluginPath, 'src', 'repo.ts'))) {
  repoPlugins.push({ name: dir, pkgName });
}
```

Add two new file-write blocks at the bottom of the script (following the pattern of the existing `writeFileSync` calls for `packages.ts` and `content-registry.ts`):

**Generate `packages/worker/src/identity/packages.ts`:**
- Import each discovered identity plugin's default export from `@valet/plugin-{name}/identity`
- Export as `installedIdentityProviders: IdentityProvider[]`

**Generate `packages/worker/src/repos/packages.ts`:**
- Import each discovered repo plugin's default export from `@valet/plugin-{name}/repo`
- Export as `installedRepoProviders: RepoProvider[]`

Follow the exact same code-generation pattern as the existing `installedIntegrations` and `installedChannels` arrays.

- [ ] **Step 3: Run the generator**

Run: `make generate-registries`
Expected: generates new `identity/packages.ts` and `repos/packages.ts` alongside existing registry files

- [ ] **Step 4: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: FAIL — `@valet/plugin-github/repo` doesn't exist yet. That's fine, this unblocks Task 10.

- [ ] **Step 5: Commit**

Commit both the modified script and the generated output files (existing pattern is to commit generated registries):

```bash
git add packages/worker/scripts/generate-plugin-registry.ts packages/worker/src/identity/packages.ts packages/worker/src/repos/packages.ts
git commit -m "feat(worker): extend registry generator for identity and repo providers"
```

---

### Task 10: Implement GitHub App repo provider

**Files:**
- Create: `packages/plugin-github/src/repo.ts`
- Modify: `packages/plugin-github/src/actions/provider.ts` (add `app_install` auth type)
- Modify: `packages/plugin-github/src/index.ts` (export repo provider)
- Modify: `packages/plugin-github/package.json` (add exports)

- [ ] **Step 1: Implement the GitHub repo provider**

Create `packages/plugin-github/src/repo.ts`:

```typescript
import type { RepoProvider, RepoCredential, RepoList, RepoValidation, SessionRepoEnv } from '@valet/sdk/repos';
import type { ActionSource } from '@valet/sdk/integrations';
import { githubFetch } from './actions/api.js';

async function mintInstallationToken(installationId: string, appId: string, privateKey: string): Promise<{ token: string; expiresAt: string }> {
  // Generate JWT signed with App private key
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: appId };

  // Sign JWT with RS256 using the App's private key
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${body}`)
  );
  const jwt = `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  // Request installation access token
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Valet',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to mint installation token: ${res.status}`);
  }

  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const githubRepoProvider: RepoProvider = {
  id: 'github',
  displayName: 'GitHub',
  icon: 'github',
  supportsOrgLevel: true,
  supportsPersonalLevel: true,
  urlPatterns: [/github\.com/],

  async listRepos(credential: RepoCredential, opts?) {
    const token = credential.accessToken!;
    const page = opts?.page || 1;
    const search = opts?.search;

    if (search) {
      const res = await githubFetch(`/search/repositories?q=${encodeURIComponent(search)}+in:name&per_page=30&page=${page}`, token);
      const data = await res.json() as { items: any[]; total_count: number };
      return {
        repos: data.items.map((r: any) => ({
          fullName: r.full_name,
          url: r.html_url,
          defaultBranch: r.default_branch,
          private: r.private,
        })),
        hasMore: data.total_count > page * 30,
      };
    }

    const res = await githubFetch(`/installation/repositories?per_page=30&page=${page}`, token);
    const data = await res.json() as { repositories: any[]; total_count: number };
    return {
      repos: data.repositories.map((r: any) => ({
        fullName: r.full_name,
        url: r.html_url,
        defaultBranch: r.default_branch,
        private: r.private,
      })),
      hasMore: data.total_count > page * 30,
    };
  },

  async validateRepo(credential: RepoCredential, repoUrl: string) {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return { accessible: false, error: 'Invalid GitHub URL' };
    const [, owner, repo] = match;
    const res = await githubFetch(`/repos/${owner}/${repo}`, credential.accessToken!);
    if (!res.ok) return { accessible: false, error: `Repository not accessible: ${res.status}` };
    const data = await res.json() as { permissions?: { push: boolean; pull: boolean; admin: boolean } };
    return {
      accessible: true,
      permissions: data.permissions || { push: false, pull: true, admin: false },
    };
  },

  async assembleSessionEnv(credential: RepoCredential, opts) {
    // Mint a fresh installation token if we have an installationId
    let token = credential.accessToken;
    if (!token && credential.installationId) {
      // App credentials must be passed in via credential.accessToken after minting
      throw new Error('Installation token must be pre-minted before assembleSessionEnv');
    }

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

  async mintToken(credential: RepoCredential) {
    if (!credential.installationId) {
      throw new Error('Cannot mint token without installationId');
    }
    // IMPORTANT: This runs in a Cloudflare Worker — no process.env.
    // The App ID and private key are stored in the credential metadata
    // (set during GitHub App installation in Task 12). The worker resolves
    // these from the org-level credential row before calling mintToken.
    const appId = credential.metadata?.appId;
    const privateKey = credential.metadata?.privateKey;
    if (!appId || !privateKey) {
      throw new Error('GitHub App credentials (appId, privateKey) not found in credential metadata');
    }
    const result = await mintInstallationToken(credential.installationId, appId, privateKey);
    return { accessToken: result.token, expiresAt: result.expiresAt };
  },

  // Agent tools — returns the existing GitHub ActionSource with the installation token
  getActionSource(credential: RepoCredential): ActionSource {
    // Import and return the existing actions, bound to this credential
    // The actual binding happens in the worker's action execution path
    const { githubActions } = require('./actions/index.js');
    return githubActions;
  },
};
```

Note: The `mintInstallationToken` function needs the GitHub App's private key. This will be stored as an org-level credential or env var. The exact passing mechanism depends on how the worker resolves the app config — likely `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` env vars in wrangler.toml, or encrypted in the credentials table as org-level config.

- [ ] **Step 2: Update IntegrationProvider for app_install auth type**

Modify `packages/plugin-github/src/actions/provider.ts`:

Update `authType` to `'app_install'` and add installation URL generation:

```typescript
export const githubProvider: IntegrationProvider = {
  service: 'github',
  displayName: 'GitHub',
  authType: 'app_install' as any,  // until SDK type is updated
  // ...
  getOAuthUrl(oauth, redirectUri, state) {
    // For app_install, this returns the GitHub App installation URL
    // The App slug comes from env vars
    return `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new?state=${state}`;
  },
  // ...
};
```

- [ ] **Step 3: Update exports and package.json**

Add to `packages/plugin-github/package.json` exports:

```json
"./identity": "./src/identity.ts",
"./repo": "./src/repo.ts"
```

Update `packages/plugin-github/src/index.ts` to export all three:

```typescript
export { githubProvider } from './actions/provider.js';
export { githubIdentityProvider } from './identity.js';
export { githubRepoProvider } from './repo.js';
export { githubActions } from './actions/index.js';
export { githubTriggers } from './actions/triggers.js';
```

- [ ] **Step 4: Add new env vars to worker env type**

Add to `packages/worker/src/env.ts`:

```typescript
GITHUB_APP_ID: string;
GITHUB_APP_PRIVATE_KEY: string;
GITHUB_APP_SLUG: string;
GITHUB_APP_WEBHOOK_SECRET?: string;
```

- [ ] **Step 5: Regenerate registries**

Run: `make generate-registries`

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-github/ packages/worker/src/env.ts
git commit -m "feat(github): implement GitHub App repo provider and identity provider"
```

---

### Task 11: Create repo provider registry and refactor session creation

**Files:**
- Create: `packages/worker/src/repos/registry.ts`
- Modify: `packages/worker/src/lib/env-assembly.ts` (replace `assembleGitHubEnv` with generic `assembleRepoEnv`)
- Modify: `packages/worker/src/services/sessions.ts` (use repo provider for session creation)
- Modify: `packages/worker/src/routes/repos.ts` (dispatch to repo provider)
- Modify: `packages/worker/src/routes/sessions.ts` (use new env assembly)

- [ ] **Step 1: Create repo provider registry**

Create `packages/worker/src/repos/registry.ts`:

```typescript
import type { RepoProvider } from '@valet/sdk/repos';

class RepoProviderRegistry {
  private providers = new Map<string, RepoProvider>();

  register(provider: RepoProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): RepoProvider | undefined {
    return this.providers.get(id);
  }

  /** Resolve which repo provider handles a given URL */
  resolveByUrl(repoUrl: string): RepoProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.urlPatterns.some(p => p.test(repoUrl))) {
        return provider;
      }
    }
    return undefined;
  }

  list(): RepoProvider[] {
    return Array.from(this.providers.values());
  }
}

export const repoProviderRegistry = new RepoProviderRegistry();
```

- [ ] **Step 2: Replace assembleGitHubEnv with assembleRepoEnv**

Modify `packages/worker/src/lib/env-assembly.ts`:

Replace `assembleGitHubEnv` with a provider-agnostic function:

```typescript
import { repoProviderRegistry } from '../repos/registry.js';
import type { RepoCredential } from '@valet/sdk/repos';

export async function assembleRepoEnv(
  env: Env,
  userId: string,
  orgId: string | undefined,
  opts: { repoUrl?: string; branch?: string; ref?: string }
): Promise<{ envVars: Record<string, string>; gitConfig: Record<string, string>; error?: string }> {
  if (!opts.repoUrl) {
    return { envVars: {}, gitConfig: {} };
  }

  const provider = repoProviderRegistry.resolveByUrl(opts.repoUrl);
  if (!provider) {
    return { envVars: {}, gitConfig: {}, error: `No repository provider found for ${opts.repoUrl}` };
  }

  // Resolve credential (org-level then user-level)
  const credResult = await resolveRepoCredential(env, provider.id, orgId, userId);
  if (!credResult.ok) {
    return { envVars: {}, gitConfig: {}, error: credResult.error };
  }

  // Mint a fresh token
  const tokenResult = await provider.mintToken(credResult.credential);

  // Fetch git user info
  const appDb = getDb(env.DB);
  const userRow = await appDb.prepare('SELECT git_name, git_email, name, email, github_username FROM users WHERE id = ?')
    .bind(userId).first();

  const gitUser = {
    name: userRow?.git_name || userRow?.name || userRow?.github_username || 'Valet User',
    email: userRow?.git_email || userRow?.email || '',
  };

  const sessionEnv = await provider.assembleSessionEnv(
    { ...credResult.credential, accessToken: tokenResult.accessToken, expiresAt: tokenResult.expiresAt },
    { repoUrl: opts.repoUrl, branch: opts.branch, ref: opts.ref, gitUser }
  );

  return {
    envVars: sessionEnv.envVars,
    gitConfig: sessionEnv.gitConfig,
  };
}
```

- [ ] **Step 3: Update session creation callers**

Search for all calls to `assembleGitHubEnv` and replace with `assembleRepoEnv`:

Run: `grep -rn "assembleGitHubEnv" packages/worker/src/ --include="*.ts"`

Update each call site. The main ones are in session routes and the SessionAgent DO.

- [ ] **Step 4: Update repos routes**

Modify `packages/worker/src/routes/repos.ts`:

- `GET /api/repos` — dispatch to the resolved repo provider's `listRepos()` instead of directly calling GitHub API
- `GET /api/repos/validate` — dispatch to repo provider's `validateRepo()`

- [ ] **Step 5: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/repos/ packages/worker/src/lib/env-assembly.ts packages/worker/src/routes/repos.ts packages/worker/src/routes/sessions.ts packages/worker/src/services/sessions.ts
git commit -m "feat(worker): repo provider registry and provider-agnostic session creation"
```

---

### Task 12: GitHub App installation setup routes

**Files:**
- Create: `packages/worker/src/routes/repo-providers.ts`
- Modify: `packages/worker/src/index.ts` (mount new routes)

- [ ] **Step 1: Create repo provider admin routes**

Create `packages/worker/src/routes/repo-providers.ts`:

```typescript
import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { repoProviderRegistry } from '../repos/registry.js';

export const repoProviderRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// List available repo providers
repoProviderRouter.get('/', async (c) => {
  const providers = repoProviderRegistry.list();
  return c.json(providers.map(p => ({
    id: p.id,
    displayName: p.displayName,
    icon: p.icon,
    supportsOrgLevel: p.supportsOrgLevel,
    supportsPersonalLevel: p.supportsPersonalLevel,
  })));
});

// Get GitHub App installation URL (org or personal)
repoProviderRouter.get('/:provider/install', async (c) => {
  // Returns the installation URL for the GitHub App
  // Admin-only for org installs, any user for personal installs
  const providerId = c.req.param('provider');
  const level = c.req.query('level') || 'org';  // 'org' or 'personal'
  // ... generate installation URL and redirect
});

// GitHub App installation callback
repoProviderRouter.get('/:provider/install/callback', async (c) => {
  // GitHub redirects here with installation_id after app is installed
  // Store the installation credential in the credentials table
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');
  // ... store credential with owner_type='org' or 'user'
});

// List installations for a repo provider
repoProviderRouter.get('/:provider/installations', async (c) => {
  // List org-level and user-level installations
  // ... query credentials table
});
```

- [ ] **Step 2: Mount in worker index**

Add to `packages/worker/src/index.ts`:

```typescript
import { repoProviderRouter } from './routes/repo-providers.js';
app.route('/api/repo-providers', repoProviderRouter);
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/routes/repo-providers.ts packages/worker/src/index.ts
git commit -m "feat(worker): GitHub App installation setup routes"
```

---

## Chunk 4: Runner Changes

Moves git credential management and repo cloning from `start.sh` to the runner process.

### Task 13: Add git credential helper endpoint to runner gateway

**Files:**
- Modify: `packages/runner/src/gateway.ts`
- Create: `packages/runner/src/git-credentials.ts`

- [ ] **Step 1: Create git credentials manager**

Create `packages/runner/src/git-credentials.ts`:

```typescript
export class GitCredentialManager {
  private token: string | null = null;
  private expiresAt: number | null = null;
  private refreshCallback: (() => Promise<{ accessToken: string; expiresAt?: string }>) | null = null;

  setToken(token: string, expiresAt?: string) {
    this.token = token;
    this.expiresAt = expiresAt ? new Date(expiresAt).getTime() : null;
  }

  setRefreshCallback(cb: () => Promise<{ accessToken: string; expiresAt?: string }>) {
    this.refreshCallback = cb;
  }

  async getCredentials(host?: string): Promise<string> {
    // Check if token is expired (with 60s buffer)
    if (this.token && this.expiresAt && Date.now() > this.expiresAt - 60_000) {
      if (this.refreshCallback) {
        const result = await this.refreshCallback();
        this.setToken(result.accessToken, result.expiresAt);
      }
    }

    if (!this.token) {
      throw new Error('No git credential available');
    }

    // Return in git credential helper format
    return `username=oauth2\npassword=${this.token}\n`;
  }
}

export const gitCredentials = new GitCredentialManager();
```

- [ ] **Step 2: Add /git/credentials endpoint to gateway**

Modify `packages/runner/src/gateway.ts`:

Add a new route (no JWT auth required — this is called by the local git process):

```typescript
import { gitCredentials } from './git-credentials.js';

// Git credential helper endpoint — local access only
app.post('/git/credentials', async (c) => {
  try {
    const body = await c.req.text();
    // Parse git credential request (key=value lines)
    const lines = body.trim().split('\n');
    const params: Record<string, string> = {};
    for (const line of lines) {
      const [k, v] = line.split('=', 2);
      if (k && v) params[k] = v;
    }

    const result = await gitCredentials.getCredentials(params.host);
    return c.text(result);
  } catch (err) {
    return c.text('', 500);
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/runner && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/runner/src/git-credentials.ts packages/runner/src/gateway.ts
git commit -m "feat(runner): git credential helper endpoint"
```

---

### Task 14: Add git config setup and repo clone to runner startup

**Files:**
- Modify: `packages/runner/src/agent-client.ts` (handle new message types)
- Modify: `packages/runner/src/bin.ts` (git setup in startup sequence)
- Create: `packages/runner/src/git-setup.ts`
- Modify: `packages/runner/src/types.ts` (new message types)

- [ ] **Step 1: Add new WebSocket message types**

Modify `packages/runner/src/types.ts`:

Add to `DOToRunnerMessage` union:

```typescript
| { type: 'repo-config'; token: string; expiresAt?: string; gitConfig: Record<string, string>; repoUrl?: string; branch?: string; ref?: string }
| { type: 'repo-token-refreshed'; token: string; expiresAt?: string }
```

Add to `RunnerToDOMessage` union:

```typescript
| { type: 'repo:refresh-token' }
| { type: 'repo:clone-complete'; success: boolean; error?: string }
```

- [ ] **Step 2: Create git setup module**

Create `packages/runner/src/git-setup.ts`:

```typescript
import { $ } from 'bun';
import { gitCredentials } from './git-credentials.js';

export async function setupGitConfig(config: Record<string, string>) {
  for (const [key, value] of Object.entries(config)) {
    await $`git config --global ${key} ${value}`.quiet();
  }

  // Set up credential helper pointing to runner gateway
  await $`git config --global credential.helper '!f() { curl -s --data-binary @- http://localhost:9000/git/credentials; }; f'`.quiet();
}

export async function cloneRepo(opts: {
  repoUrl: string;
  branch?: string;
  ref?: string;
  workdir?: string;
}): Promise<{ success: boolean; error?: string }> {
  const workdir = opts.workdir || '/workspace';
  const repoName = opts.repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
  const clonePath = `${workdir}/${repoName}`;

  try {
    const args = ['git', 'clone', '--depth', '1'];
    if (opts.branch) {
      args.push('--branch', opts.branch, '--single-branch');
    }
    args.push(opts.repoUrl, clonePath);

    const result = await $`${args}`.quiet();

    if (opts.ref) {
      await $`cd ${clonePath} && git fetch origin ${opts.ref} && git checkout FETCH_HEAD`.quiet();
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
```

- [ ] **Step 3: Handle repo-config message in agent-client**

Modify `packages/runner/src/agent-client.ts`:

First, add a class field to `AgentClient`:

```typescript
private pendingTokenRefresh: ((result: { accessToken: string; expiresAt?: string }) => void) | null = null;
```

Add imports at top of file:

```typescript
import { gitCredentials } from './git-credentials.js';
import { setupGitConfig, cloneRepo } from './git-setup.js';
```

Add handlers in the `handleMessage` switch (use `this.send()` — the existing private method that handles buffering and open-state checks — not raw `ws.send`):

```typescript
case 'repo-config': {
  const { token, expiresAt, gitConfig, repoUrl, branch, ref } = msg;

  // Set token in credential manager
  gitCredentials.setToken(token, expiresAt);

  // Set up refresh callback
  gitCredentials.setRefreshCallback(async () => {
    this.send({ type: 'repo:refresh-token' });
    return new Promise((resolve) => {
      this.pendingTokenRefresh = resolve;
    });
  });

  // Apply git config
  await setupGitConfig(gitConfig);

  // Clone repo if URL provided
  if (repoUrl) {
    const result = await cloneRepo({ repoUrl, branch, ref });
    this.send({ type: 'repo:clone-complete', ...result });
  }
  break;
}

case 'repo-token-refreshed': {
  if (this.pendingTokenRefresh) {
    this.pendingTokenRefresh({ accessToken: msg.token, expiresAt: msg.expiresAt });
    this.pendingTokenRefresh = null;
  }
  break;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/runner && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/types.ts packages/runner/src/git-setup.ts packages/runner/src/agent-client.ts
git commit -m "feat(runner): git config setup, repo clone, and token refresh"
```

---

### Task 15: Update SessionAgent DO to send repo config and handle token refresh

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts`

- [ ] **Step 1: Read the relevant sections of session-agent.ts**

This file is very large. Read the sections that handle:
- Runner WebSocket connection setup (where initial config is sent)
- The `assembleGitHubEnv` call or where sandbox env vars are assembled
- The credential cache and resolution in `executeAction`

- [ ] **Step 2: Send repo-config message after runner connects**

After the runner WebSocket connects and the DO sends the initial `opencode-config` message, add a `repo-config` message:

```typescript
// After sending opencode-config, send repo credentials
if (this.repoProvider && this.repoCredential) {
  const tokenResult = await this.repoProvider.mintToken(this.repoCredential);
  this.sendToRunner({
    type: 'repo-config',
    token: tokenResult.accessToken,
    expiresAt: tokenResult.expiresAt,
    gitConfig: this.sessionRepoEnv.gitConfig,
    repoUrl: this.session.repoUrl,
    branch: this.session.branch,
    ref: this.session.ref,
  });
}
```

- [ ] **Step 3: Handle repo:refresh-token message**

Add handler for the `repo:refresh-token` message from the runner:

```typescript
case 'repo:refresh-token': {
  if (this.repoProvider && this.repoCredential) {
    const tokenResult = await this.repoProvider.mintToken(this.repoCredential);
    this.sendToRunner({
      type: 'repo-token-refreshed',
      token: tokenResult.accessToken,
      expiresAt: tokenResult.expiresAt,
    });
  }
  break;
}
```

- [ ] **Step 4: Update action execution credential resolution**

In the `executeAction` method, when the action belongs to the repo provider's namespace, use the installation token instead of the user's OAuth token. The repo provider's `getActionSource()` already binds to the credential.

- [ ] **Step 5: Typecheck**

Run: `cd packages/worker && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(worker): DO sends repo config to runner and handles token refresh"
```

---

### Task 16: Clean up start.sh git configuration

**Files:**
- Modify: `docker/start.sh`

- [ ] **Step 1: Remove git credential configuration and repo clone from start.sh**

Remove the following from `docker/start.sh`:
- `git config --global user.name` from `GIT_USER_NAME` (~lines 38-48)
- `git config --global user.email` from `GIT_USER_EMAIL`
- `git config --global credential.helper` using `GITHUB_TOKEN`
- The repo cloning section (~lines 57-80)
- Update the "Repo Context Injection" block (~lines 82-107): it currently uses `CLONE_DIR` and `WORK_DIR` derived from the clone. Since the runner now handles cloning, simplify this to write a minimal context file using `REPO_URL`/`REPO_BRANCH` env vars (which are still injected) at a known path like `/workspace/.valet/persona/00-repo-context.md`. The runner can update it after cloning.

Keep:
- Global gitignore for `.valet/`, `.opencode/`
- OS-level service startup (Xvfb, code-server, TTYD)
- Runner startup

**Note on ordering:** Code-server and TTYD start in `start.sh` with `WORK_DIR` before the runner clones. After this change, they'll initially open `/workspace` (the default). Once the runner clones the repo, the user navigates into the repo directory. This is an acceptable UX tradeoff for the pre-prod phase — a follow-up could have the runner signal code-server to switch directories after clone.

- [ ] **Step 2: Remove GITHUB_TOKEN from sandbox env assembly**

In `packages/worker/src/lib/env-assembly.ts`, the old `assembleGitHubEnv` should already be replaced by Task 11. Verify that `GITHUB_TOKEN` is no longer injected as a sandbox env var. The token is now delivered via WebSocket `repo-config` message.

Keep `REPO_URL` and `REPO_BRANCH` in env vars for reference by other tools (e.g., OpenCode persona context), but they're no longer used for git operations.

- [ ] **Step 3: Commit**

```bash
git add docker/start.sh packages/worker/src/lib/env-assembly.ts
git commit -m "refactor: remove git credential config and repo clone from start.sh"
```

---

### Task 17: Add IntegrationProvider authType 'app_install' to SDK

**Note:** Run this task before Task 10 so the GitHub App provider doesn't need `as any` casts.

**Files:**
- Modify: `packages/sdk/src/integrations/index.ts`

- [ ] **Step 1: Extend authType union**

In the `IntegrationProvider` interface, update:

```typescript
readonly authType: 'oauth2' | 'bot_token' | 'api_key' | 'app_install' | 'none';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (additive change)

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/integrations/index.ts
git commit -m "feat(sdk): add 'app_install' auth type to IntegrationProvider"
```

---

### Task 18: Final typecheck and integration verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS — all packages compile

- [ ] **Step 2: Verify registry generation**

Run: `make generate-registries`
Expected: generates identity and repo provider registries without errors

- [ ] **Step 3: Verify no stale references**

Search for remaining references to the old patterns:

```bash
grep -rn "assembleGitHubEnv" packages/ --include="*.ts"
grep -rn "'repo read:user" packages/ --include="*.ts"
grep -rn "GITHUB_TOKEN" packages/runner/ docker/ --include="*.ts" --include="*.sh"
```

Fix any remaining references.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: clean up stale references to old GitHub OAuth flow"
```

---

## Task Dependency Graph

```
Task 1 (SDK contracts)
  ├→ Task 17 (SDK authType 'app_install') — run before Task 10
  └→ Tasks 2+3+4 (credential migration + DB helpers + service — committed together)
       ├→ Task 5 (email/password plugin)
       ├→ Task 6 (GitHub/Google identity plugins)
       │    └→ Task 7 (identity registry + auth routes)
       │         └→ Task 8 (login page frontend)
       ├→ Task 9 (generate-registries update)
       │    └→ Task 10 (GitHub App repo provider) — requires Task 17
       │         └→ Task 11 (repo registry + session creation)
       │              └→ Task 12 (App installation routes)
       └→ Task 13 (runner credential helper)
            └→ Task 14 (runner git setup + clone)
                 └→ Task 15 (DO repo config messages)
                      └→ Task 16 (start.sh cleanup)

Task 18 (final verification) — depends on all above
```
