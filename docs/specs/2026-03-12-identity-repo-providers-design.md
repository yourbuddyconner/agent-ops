# Design: Identity Providers & Repository Providers

**Date:** 2026-03-12
**Status:** Draft
**Addresses:** GitHub issue #32 (code.storage support), GitHub OAuth repo scope concern

## Problem

Valet's GitHub OAuth flow serves double duty — it's both the login mechanism and the repo access grant. The `repo` scope grants read/write access to every repository the user can access on GitHub. This is overly broad for a platform that runs autonomous code agents, and it prevents supporting alternative repository backends (code.storage, GitLab, etc.) or alternative identity providers (Keycloak/SAML, email/password).

## Solution

Split identity and repository access into two independent plugin abstractions:

1. **Identity Providers** — handle user authentication (login). No repo access.
2. **Repository Providers** — handle repo enumeration, credential injection, and provider-specific agent tools. No login concerns.

Both are independently configurable by org admins. A fresh deployment defaults to email/password identity; org admins enable additional providers as needed.

## Design

### 1. IdentityProvider Contract

A new SDK contract for login. Protocol-agnostic — supports OAuth, OIDC, SAML, and direct credentials (email/password).

```typescript
interface IdentityProvider {
  readonly id: string;                       // 'github', 'google', 'keycloak', 'email'
  readonly displayName: string;
  readonly icon: string;                     // icon identifier: 'github', 'google', 'key', etc.
  readonly brandColor?: string;              // button color: '#24292e', '#4285f4', etc.
  readonly protocol: 'oauth2' | 'oidc' | 'saml' | 'credentials';

  // Phase 1: generate the redirect URL (OAuth/OIDC/SAML)
  // Required for redirect-based protocols. Not present on 'credentials' protocol.
  getAuthUrl(config: ProviderConfig, callbackUrl: string, state: string): string;

  // Phase 2: process the callback or direct login
  // OAuth/OIDC: code exchange. SAML: assertion parsing. Credentials: password verification.
  handleCallback(config: ProviderConfig, callbackData: CallbackData): Promise<IdentityResult>;
}

// Provider-specific config resolved from env vars + org admin overrides
interface ProviderConfig {
  // OAuth/OIDC
  clientId?: string;
  clientSecret?: string;
  // SAML
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  // Generic
  [key: string]: string | undefined;
}

// What the callback receives — varies by protocol
interface CallbackData {
  code?: string;             // OAuth/OIDC: authorization code
  samlResponse?: string;     // SAML: POST body
  email?: string;            // Credentials: email
  password?: string;         // Credentials: password
  state?: string;            // CSRF validation
}

interface IdentityResult {
  externalId: string;        // GitHub user ID, Google sub, email address
  email: string;
  name?: string;
  avatarUrl?: string;
  username?: string;          // GitHub login, etc.
}
```

**Login flow:**

1. Login page queries `GET /api/auth/providers` — returns enabled identity providers.
2. For redirect-based providers (OAuth/OIDC/SAML): user clicks button, worker calls `getAuthUrl()`, redirects out, callback returns to generic `GET/POST /auth/:provider/callback`, worker calls `handleCallback()`.
3. For credentials protocol (email/password): login form POSTs directly to `POST /auth/email/login`, worker calls `handleCallback()` with email+password.
4. All paths produce an `IdentityResult`. Existing user-upsert logic (find by external ID, then email, then create) becomes provider-agnostic. The `auth_sessions` table's `provider` column stores the identity provider ID (e.g., `'github'`, `'google'`, `'email'`, `'keycloak'`).

**Scopes:**

- GitHub OAuth login: `read:user user:email` only. No `repo`.
- Google OAuth login: `openid email profile` (unchanged).
- SAML/Keycloak: no scopes concept, identity assertion only.
- Email/password: no external call at all.

**Default state for fresh deployments:** email/password enabled, all others disabled until configured.

### 2. RepoProvider Contract

A new SDK contract for runtime repository operations. Receives already-configured credentials — does not handle setup/installation flows.

```typescript
interface RepoProvider {
  readonly id: string;                       // 'github', 'code-storage'
  readonly displayName: string;
  readonly icon: string;
  readonly supportsOrgLevel: boolean;
  readonly supportsPersonalLevel: boolean;

  // Repo enumeration
  listRepos(credential: RepoCredential, opts?: {
    page?: number;
    search?: string;
  }): Promise<RepoList>;

  validateRepo(credential: RepoCredential, repoUrl: string): Promise<RepoValidation>;

  // Sandbox credential injection — full session setup (env vars + git config)
  assembleSessionEnv(credential: RepoCredential, opts: {
    repoUrl: string;
    branch?: string;
    ref?: string;
    gitUser: { name: string; email: string };
  }): Promise<SessionRepoEnv>;

  // Mint a fresh short-lived access token (for token refresh during long sessions)
  mintToken(credential: RepoCredential): Promise<{ accessToken: string; expiresAt?: string }>;

  // Provider-specific agent tools in their own namespace
  getActionSource?(credential: RepoCredential): ActionSource;
  getTriggerSource?(): TriggerSource;
}

interface RepoCredential {
  type: 'installation' | 'token';
  installationId?: string;         // GitHub App installation ID
  accessToken?: string;            // resolved/minted token
  expiresAt?: string;
}

interface SessionRepoEnv {
  envVars: Record<string, string>; // REPO_TOKEN, REPO_URL, etc.
  gitConfig: Record<string, string>; // user.name, user.email, etc.
}

interface RepoList {
  repos: Array<{
    fullName: string;              // 'org/repo'
    url: string;
    defaultBranch: string;
    private: boolean;
  }>;
  hasMore: boolean;
}

interface RepoValidation {
  accessible: boolean;
  permissions?: { push: boolean; pull: boolean; admin: boolean };
  error?: string;
}
```

**Separation from IntegrationProvider:**

The `RepoProvider` contract is runtime-only. Setup and installation flows (e.g., GitHub App installation, code.storage API key entry) are handled by the plugin's `IntegrationProvider`, which already supports OAuth, API key, and bot token auth types. A new `'app_install'` auth type covers the GitHub App redirect-based installation flow.

A GitHub plugin package exports three concerns:
- `IntegrationProvider` — handles GitHub App installation setup
- `RepoProvider` — runtime repo operations
- `IdentityProvider` — login with minimal scopes

These are independently registered and independently configurable.

**Agent tools:**

Each repo provider owns its own tool namespace. GitHub tools (`github.create_pull_request`, `github.list_issues`, etc.) and code.storage tools (`codestorage.create_merge_request`, etc.) are mutually exclusive per session — only the active session's repo provider tools are loaded. The existing 23 GitHub actions move behind `RepoProvider.getActionSource()` and use installation tokens instead of user OAuth tokens.

### 3. Data Model: Polymorphic Credentials

The existing `credentials` table extends to support org-level credentials via a polymorphic owner pattern.

**Schema migration:**

SQLite does not support `ALTER COLUMN` or `DROP COLUMN` (reliably). The migration uses the standard SQLite table-recreation pattern:

```sql
-- 1. Create new table with polymorphic owner
CREATE TABLE credentials_new (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,              -- 'user' | 'org'
  owner_id TEXT NOT NULL,                -- user ID or org ID
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL DEFAULT 'oauth2',
  encrypted_data TEXT NOT NULL,
  metadata TEXT,                         -- JSON: non-secret provider-specific data
  scopes TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Backfill from existing table
INSERT INTO credentials_new (id, owner_type, owner_id, provider, credential_type, encrypted_data, scopes, expires_at, created_at, updated_at)
  SELECT id, 'user', user_id, provider, COALESCE(credential_type, 'oauth2'), encrypted_data, scopes, expires_at, created_at, updated_at
  FROM credentials;

-- 3. Swap tables
DROP TABLE credentials;
ALTER TABLE credentials_new RENAME TO credentials;

-- 4. Create indexes
CREATE UNIQUE INDEX credentials_owner_unique
  ON credentials(owner_type, owner_id, provider, credential_type);
CREATE INDEX credentials_owner_lookup
  ON credentials(owner_type, owner_id);
```

Note: `owner_id` is not a foreign key — it references either `users(id)` or `organizations(id)` depending on `owner_type`. Cascade cleanup is handled in application code (user deletion and org deletion handlers).

**Example rows after migration:**

| owner_type | owner_id | provider | credential_type | encrypted_data | metadata |
|------------|----------|----------|-----------------|----------------|----------|
| user | usr_123 | github | oauth2 | (identity token) | `null` |
| org | org_456 | github | app_install | (app private key) | `{"installationId":"12345","account":"myorg","repoAccess":"all"}` |
| user | usr_123 | github | app_install | (app private key ref) | `{"installationId":"67890","account":"myusername","repoAccess":["repo1","repo2"]}` |
| user | usr_123 | google | oauth2 | (google token) | `null` |

**Credential resolution at session creation:**

1. Determine repo provider from the repo URL (pattern matching or explicit selection).
2. Look up org-level installation: `owner_type='org', owner_id=:orgId, provider=:provider, credential_type='app_install'`.
3. Fall back to user-level personal installation: `owner_type='user', owner_id=:userId, provider=:provider, credential_type='app_install'`.
4. If no installation found at either level, session creation fails with a clear error: "No {provider} installation covers this repo. Ask your org admin to install the Valet app, or install it on your personal account."
5. Pass resolved credential to `repoProvider.assembleSessionEnv()`.

**Credential cache in SessionAgentDO:**

The existing in-memory cache (`credentialCache` map) extends its key format from `userId:service` to `owner_type:owner_id:service:credential_type`.

### 4. Sandbox Credential Injection & Token Refresh

**Runner-managed git configuration:**

All git configuration moves from `start.sh` to the runner process. At startup, after the runner connects to the DO and receives session config:

1. Runner receives repo provider credentials and git config from the DO over the WebSocket.
2. Runner applies git config via `git config --global` subprocess calls.
3. Runner serves a credential helper endpoint on its local HTTP gateway (port 9000).

**Runner-hosted credential helper:**

```bash
# Runner writes this git config:
git config --global credential.helper \
  '!f() { curl -s --data-binary @- http://localhost:9000/git/credentials; }; f'
```

Git pipes the request context (`protocol`, `host`, etc.) to the credential helper's stdin. The shell wrapper forwards this to the runner endpoint via `--data-binary @-`, allowing the runner to discriminate by host if needed (e.g., multiple git remotes).

The runner's Hono gateway (`/git/credentials` endpoint):
- Parses the git credential request (host, protocol).
- Returns credentials in git's required `key=value\n` format: `username=oauth2\npassword=<token>\n`.
- If the token is expired, requests a refresh from the DO over the WebSocket, waits for the response, returns the fresh token.
- Provider-agnostic — works identically for GitHub App tokens (1-hour TTL) and code.storage JWTs.

**Token refresh flow:**

1. Git operation triggers the credential helper.
2. Runner checks token expiry in memory.
3. If expired, sends `repo:refresh-token` message over WebSocket to DO.
4. DO resolves the repo provider, calls `mintToken()` to get a fresh access token.
5. DO sends new token back over WebSocket.
6. Runner updates in-memory token, credential helper returns it to git.

**Repo clone moves to the runner:**

Currently `start.sh` clones the repo at sandbox boot using env vars. Since the runner now owns git credential configuration and receives credentials from the DO after connecting, the repo clone must also move to the runner. The sequence:

1. `start.sh` starts OS-level services (Xvfb, code-server, ttyd) — no git operations.
2. Runner starts, connects to DO via WebSocket, receives session config including repo credentials.
3. Runner applies git config and sets up the credential helper endpoint.
4. Runner clones the repo (shallow, single-branch for ephemeral sessions).
5. Runner signals "ready" to the DO.

This eliminates the current ordering dependency where `start.sh` needs `GITHUB_TOKEN` as an env var before the runner connects. The sandbox env vars still include `REPO_URL` and `REPO_BRANCH` for reference, but `REPO_TOKEN` is no longer injected as an env var — it's held only in runner memory and served via the credential helper.

### 5. Plugin Structure

**GitHub plugin (`packages/plugin-github/`) exports:**

```
packages/plugin-github/
├── src/
│   ├── identity.ts          # IdentityProvider — login with read:user user:email
│   ├── provider.ts          # IntegrationProvider — GitHub App installation setup
│   ├── repo.ts              # RepoProvider — runtime repo operations
│   ├── actions/
│   │   ├── actions.ts       # ActionSource — 23 agent tools (github.* namespace)
│   │   ├── api.ts           # githubFetch helper
│   │   └── triggers.ts      # TriggerSource — webhook handling
│   └── index.ts             # Package exports
└── plugin.yaml
```

**Plugin registry changes:**

`make generate-registries` discovers and registers two new provider types:
- Identity providers — scanned from `packages/plugin-*/src/identity.ts`
- Repo providers — scanned from `packages/plugin-*/src/repo.ts`

**Email/password identity provider (`packages/plugin-email-auth/`):**

Built-in identity provider. Default enabled on fresh deployments. Handles password hashing (bcrypt/argon2), verification, and returns `IdentityResult` with `externalId` set to the email address. Password reset and email verification are optional methods on the contract for future implementation.

### 6. Login Page Rendering

The login page renders dynamically based on enabled identity providers. `GET /api/auth/providers` returns the list with display metadata:

```typescript
// Response from GET /api/auth/providers
interface AuthProviderInfo {
  id: string;
  displayName: string;
  icon: string;          // 'github', 'google', 'key', 'shield' (keycloak), etc.
  brandColor?: string;
  protocol: 'oauth2' | 'oidc' | 'saml' | 'credentials';
}
```

The frontend maintains a small icon map (GitHub logo SVG, Google logo SVG, generic lock icon, etc.) keyed by the `icon` identifier. For `protocol: 'credentials'`, it renders an email/password form. For all other protocols, it renders a branded button that initiates the redirect flow.

Plugins do not ship React components or CSS. The metadata contract (`displayName`, `icon`, `brandColor`, `protocol`) is sufficient for the frontend to render the correct UI. If a future provider needs a completely custom login widget, that can be addressed then.

### 7. Admin Configuration

**Identity providers (Settings > Authentication):**

- List of available identity providers with enable/disable toggles.
- Provider-specific configuration fields rendered based on `protocol` (OAuth: client ID/secret, SAML: entity ID/SSO URL/certificate, email/password: password policy).
- At least one identity provider must remain enabled (prevent lockout).
- Login page dynamically renders buttons/forms for enabled providers via `GET /api/auth/providers`.

**Repository providers (Settings > Repositories):**

- List of available repo providers with enable/disable toggles.
- Org-level installation status (e.g., "GitHub App installed on myorg — 12 repos").
- Install/reinstall button (redirects to GitHub App install page via IntegrationProvider).
- View accessible repos.

**User-level settings:**

- Personal repo provider installations (e.g., GitHub App on personal account).
- Falls back to personal installation when no org-level installation covers a repo.

**New Session flow:**

Repo picker shows repos from enabled repo providers. Provider determined by repo URL pattern matching or explicit provider selection if multiple are enabled.

### 8. Migration (Clean Cut)

This is a pre-production system. Migration is a clean cut:

1. Deploy the GitHub App and configure App ID + private key in env vars.
2. Run credential schema migration (add `owner_type`, `owner_id`, `metadata` columns; backfill existing rows; create new indexes).
3. Deploy updated login flow (GitHub OAuth drops `repo` scope).
4. Deploy updated plugin structure (GitHub plugin exports identity + repo + integration providers).
5. Deploy runner changes (git config management, credential helper endpoint).
6. Update `start.sh` to remove git credential configuration.
7. Org admin installs the GitHub App on relevant repos.
8. Existing sessions are invalidated — users create new sessions.

## What This Design Does NOT Cover

- **code.storage plugin implementation** — this design creates the abstractions; code.storage is a second implementation built on top.
- **Email verification and password reset flows** — the email/password identity provider handles login; account management flows are deferred.
- **Fine-grained repo permissions within Valet** — the design inherits whatever access the installation grants. Valet-level repo allowlists are a separate concern.
- **Multi-repo sessions** — a session has one repo provider and one repo.
- **GitHub Actions CI integration** — webhook triggers remain as-is; deeper CI integration is a separate effort.
