# GitHub Dual Repo Provider Design

**Date:** 2026-03-16
**Status:** Draft
**Evolves:** `2026-03-12-identity-repo-providers.md`

## Problem

Valet currently has a single `githubRepoProvider` that handles both GitHub OAuth tokens and GitHub App installation tokens with conditional logic. Different deployment scenarios need different behaviors:

- **Individual developers / small teams** (e.g., Xiangan's team) want OAuth — commits attributed to the human, access to any repo the user can see, no admin setup required.
- **Enterprise / governed orgs** (e.g., Turnkey) want a GitHub App — commits attributed to `valet[bot]`, admin-controlled repo scope, no per-user GitHub login required.
- **Mixed orgs** need both — the App as a baseline so everyone (including non-developers) gets repo access, with optional personal OAuth for developers who want attribution.

## Design

### Principle: Separate Identity from Repo Access

GitHub OAuth login and GitHub OAuth repo access are two different concerns with different scopes:

- **Identity:** `read:user user:email` — proves who the user is. Linked to the user's email-based Valet account alongside other identity providers (Google, email/password).
- **Repo access (OAuth):** `repo` scope — grants access to the user's repositories. A separate OAuth flow from identity login.
- **Repo access (App):** GitHub App installation — grants access to repos the App is installed on. No per-user GitHub link required.

### Two Repo Providers, One Plugin

Split the current `githubRepoProvider` into two implementations within `plugin-github`:

**`GitHubOAuthRepoProvider`**
- `id: 'github-oauth'`
- Credential type: `token`
- `listRepos` → `/user/repos` (user's accessible repos)
- `mintToken` → passthrough (OAuth tokens don't expire)
- Git user: the authenticated user's GitHub name/email
- Commits attributed to the human

**`GitHubAppRepoProvider`**
- `id: 'github-app'`
- Credential type: `installation`
- `listRepos` → `/installation/repositories` (repos the App is installed on)
- `mintToken` → mints short-lived installation token via RS256 JWT
- Git user: `valet[bot]` / `valet[bot]@users.noreply.github.com`
- Commits attributed to the bot

Shared utilities remain common within the plugin: GitHub API client (`githubFetch`), URL pattern matching (`/github\.com/`), repo mapping (`mapGitHubRepo`), and the `mintInstallationToken` helper.

### Generic Credential Resolution in Core

A new `RepoCredentialResolver` in the worker core resolves which provider and credential to use for a given session. This is **not** GitHub-specific — it's a generic mechanism that any repo provider plugin participates in.

```
resolveRepoCredential(userId, orgId, repoUrl):
  1. Match URL to provider family (github.com → GitHub providers)
  2. Check: does user have a personal repo credential for this family?
     → Yes: return { provider: GitHubOAuthRepoProvider, credential }
  3. Check: does org have an org-level repo credential for this family?
     → Yes: return { provider: GitHubAppRepoProvider, credential }
  4. Neither → error: no repo access configured
```

**Priority order:** user-level credentials > org-level credentials.

This is a platform-level policy, not plugin logic. The plugins are stateless and handle one credential type each. They don't know about each other or the fallback chain.

### No Org-Level Mode Config

There is no toggle for "OAuth mode" vs "App mode." Both can coexist:

- The GitHub App installation is the **org baseline**. Once an admin installs it, every user in the org gets repo access automatically. Non-developers (sales, BD) can use Valet without linking a GitHub account.
- Personal GitHub OAuth is an **optional upgrade**. Developers who want commits attributed to them link their GitHub account with `repo` scope. When present, their personal token takes precedence.

Resolution is automatic based on available credentials.

### Session Flow

1. Session starts for user X on org Y, targeting `github.com/foo/bar`
2. `RepoCredentialResolver` runs the priority chain
3. **If user X has a linked GitHub OAuth repo credential:**
   - Uses `GitHubOAuthRepoProvider`
   - Git user: user's GitHub name/email
   - Commits attributed to the human
4. **If not, but org Y has a GitHub App installation:**
   - Uses `GitHubAppRepoProvider`
   - Mints short-lived installation token
   - Git user: `valet[bot]`
   - Commits attributed to the bot
5. **Neither:** error — "Link your GitHub account or ask an org admin to install the GitHub App"
6. Git credential helper works identically in both cases (already credential-source-agnostic)

### What Doesn't Change

- **Git credential helper** (`packages/runner/src/git-setup.ts`) — already calls `/git/credentials` and receives a token. No changes needed.
- **GitHub identity provider** (`packages/plugin-github/src/identity.ts`) — stays as login-only with `read:user user:email` scopes. Independent of repo access.
- **GitHub actions** (`packages/plugin-github/src/actions/`) — PR creation, issue comments, etc. These use whatever token is available and are unaffected by the provider split.
- **Plugin registry auto-generation** — `generate-plugin-registry.ts` discovers and registers both providers from the same plugin package.

## File Changes

### New / Split
- `packages/plugin-github/src/repo-oauth.ts` — `GitHubOAuthRepoProvider`
- `packages/plugin-github/src/repo-app.ts` — `GitHubAppRepoProvider`
- `packages/plugin-github/src/repo-shared.ts` — shared utilities (mapGitHubRepo, mintInstallationToken, URL patterns)
- `packages/worker/src/repos/resolver.ts` — generic `RepoCredentialResolver`

### Modified
- `packages/worker/src/repos/registry.ts` — support multiple providers per URL pattern
- `packages/worker/src/routes/repo-providers.ts` — org-level App installation storage (change `ownerType` from `'user'` to `'org'`)
- Session creation logic — use `RepoCredentialResolver` instead of direct provider lookup

### Removed
- `packages/plugin-github/src/repo.ts` — replaced by the split files

## Future Considerations

- **GitLab, Bitbucket, GitHub Enterprise** — same pattern applies: user OAuth + org-level App/token, generic resolver picks the best available credential.
- **SSH key auth** — could be another credential type in the priority chain, slotting in as a user-level or org-level credential.
- **Per-repo overrides** — not in scope, but the resolver could be extended to check repo-specific credentials before user/org-level ones.
