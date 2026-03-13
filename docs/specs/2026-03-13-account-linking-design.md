# Account Linking & Auth Provider Management

## Problem

Users can log in via GitHub or Google, but these create separate accounts when the emails differ. There's no way to link a GitHub account and a Google account into a single user. Organizations with email domain whitelists can't support users who need both providers (e.g., corporate Google login + personal GitHub for repo access).

## Decisions

- **Unified identity table.** Extend `user_identity_links` for both auth and channel identities rather than creating a separate table. A `kind` column (`'auth'` | `'channel'`) distinguishes them.
- **No account merging.** If a provider identity or email is already associated with another user, the link is blocked. Admins can delete the orphaned account to resolve conflicts.
- **Clean break from legacy columns.** Remove `githubId`, `githubUsername`, and `identityProvider` from the `users` table. All users re-authenticate through the new flow.
- **Settings-driven linking.** Users link additional providers from a settings page, not during login.
- **Domain gating is the front door.** It applies to all login attempts equally, regardless of provider. Linking bypasses domain gating (you're already authenticated).
- **Plugin-declared profile fields.** Each identity provider plugin declares the profile fields it contributes and the settings page renders them dynamically.

## Data Model

### Extended `user_identity_links`

New columns added to the existing table:

| Column | Type | Notes |
|--------|------|-------|
| `kind` | text, not null | `'auth'` or `'channel'` — no default, must be explicit |
| `email` | text, nullable | Email from this provider |
| `avatarUrl` | text, nullable | Provider profile image |
| `metadata` | text (JSON), nullable | Provider-specific data (e.g. `{"githubUsername": "conner"}`) |

Existing columns unchanged: `id`, `userId`, `provider`, `externalId`, `externalName`, `teamId`, `createdAt`.

Existing unique constraint `(provider, externalId)` remains — prevents duplicate links across both kinds.

The migration sets `kind = 'channel'` for all existing rows (they are all channel identities today).

**Schema file move:** The Drizzle schema for `user_identity_links` moves from `schema/channels.ts` to `schema/identity.ts` since the table now serves both auth and channel concerns. `schema/channels.ts` retains `channelBindings` only.

### New table: `user_emails`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID |
| `userId` | text FK → users.id | cascade delete |
| `email` | text, unique | Globally unique across all users |
| `sourceProvider` | text | Which provider contributed this email |
| `isPrimary` | integer (boolean) | Exactly one true per user |
| `createdAt` | text | |

The unique constraint on `email` enforces the "block if already taken" policy. When linking would introduce a conflicting email, the operation returns an error.

### Extended `org_settings`

| Column | Type | Notes |
|--------|------|-------|
| `enabledAuthProviders` | text (JSON) | e.g. `["google", "email"]`. Null = all available. |

### Removed from `users`

- `githubId` — moves to `user_identity_links.externalId` where `provider = 'github'`
- `githubUsername` — moves to `user_identity_links.metadata`
- `identityProvider` — replaced by the auth identity links themselves

Kept on `users`: `email` (synced from whichever `user_emails` row is primary), `passwordHash` (for email/password provider).

**`users.email` sync:** When the user changes their primary email (via the primary email selector), the API handler updates both `user_emails.isPrimary` and `users.email` in a single D1 transaction. No background sync or triggers — it's a direct application-level write on the same request.

## Identity Provider Plugin Contract

Each provider plugin declares the profile fields it contributes. The settings page renders these dynamically — no hardcoded provider sections in the frontend.

```typescript
interface IdentityProviderProfileField {
  key: string;              // e.g. 'username', 'email'
  label: string;            // e.g. 'GitHub Username'
  type: 'text' | 'email' | 'url';
  readOnly: boolean;
  value: (metadata: Record<string, unknown>) => string | undefined;
}

interface IdentityProvider {
  id: string;
  name: string;             // "GitHub", "Google"
  icon: string;
  profileFields: IdentityProviderProfileField[];
  // ... existing handleCallback, getAuthUrl, etc.
}
```

GitHub declares: username (read-only), email (read-only).
Google declares: email (read-only).
Email/password declares: email (read-only).

The identity provider plugin system already exists (`packages/worker/src/identity/registry.ts`) with auto-discovery via `make generate-registries`. The `profileFields` array is a new addition to the existing `IdentityProvider` contract in `@valet/sdk/identity`. No new registry type is needed — identity providers are already a first-class plugin kind.

## Login Flow

### Login page

1. Frontend calls `GET /api/auth/providers`
2. Endpoint filters by `org_settings.enabledAuthProviders`
3. Renders only enabled provider buttons

### Login resolution (`finalizeIdentityLogin`)

1. Look up `user_identity_links WHERE kind = 'auth' AND provider = ? AND externalId = ?`
2. If found: log in as that user (domain gating checks the identity's email)
3. If not found: check `user_emails WHERE email = ?` for email-based match
4. If not found: create new user + auth identity link + `user_emails` row (in a D1 transaction)
5. Domain gating applies to the provider's email, not the user's primary email

The legacy `handleGitHubCallback` and `handleGoogleCallback` functions in `oauth.ts` are deleted. All login flows go through the generic `finalizeIdentityLogin` path using the identity provider plugin system. The existing `IdentityResult` contract already supports this — the plugins return the result, `finalizeIdentityLogin` resolves the user.

### Deployment-level configuration

OAuth client IDs and secrets remain environment variables (`GITHUB_CLIENT_ID`, etc.). The org-level `enabledAuthProviders` setting controls which of the configured providers are shown on the login page.

- Personal deployment: enable GitHub + Google, no domain gating
- Work deployment: enable Google only, domain-gate to company domain

## Account Linking Flow

### Linking (Settings page → "Linked Accounts")

1. User clicks "Link GitHub" (or another unlinked provider)
2. Frontend initiates OAuth flow with `?intent=link` in the state JWT
3. OAuth callback completes, producing an `IdentityResult`
4. **Guard: identity conflict** — if `(provider, externalId)` already exists in `user_identity_links` for a different user, return error: "This account is already linked to another user"
5. **Guard: email conflict** — if the provider's email exists in `user_emails` for a different user, return error: "This email is associated with another account"
6. Insert `user_identity_links` row with `kind = 'auth'`
7. Insert `user_emails` row if the provider's email is new for this user
8. If the user now has multiple emails, prompt to select primary
9. Store OAuth credentials (same as today's login flow)

### Unlinking

1. User clicks "Unlink" on a linked provider
2. **Guard: domain gating safety** — if this is the last auth identity whose email satisfies the org's domain gating, block with error
3. **Guard: last provider** — if this is the user's only auth identity, block (can't have zero login methods)
4. Delete the `user_identity_links` row
5. Remove the provider's email from `user_emails` if it is not primary and no other linked provider shares the same email
6. Revoke stored OAuth credentials for that provider

## Admin Settings: Auth Providers

New section on the org admin page between Access Control and Invites.

"Authentication Providers" — lists all registered identity providers with enable/disable toggles. Controls what appears on the login page. Disabling a provider does not affect existing linked accounts — users keep their links, they just can't use that provider as a direct login path.

Default: all configured providers enabled (null = all).

## User Settings: Linked Accounts

New section on the user settings page.

- Lists each linked auth provider with profile fields rendered from the plugin's `profileFields` schema
- "Link [Provider]" buttons for available but unlinked providers
- "Unlink" button with safety guards (last provider, domain gating)
- Primary email selector when multiple emails exist across linked providers

## API Contracts

### Auth providers (unauthenticated)

- `GET /api/auth/providers` — returns enabled auth providers for the login page
  - Response: `{ providers: Array<{ id: string; name: string; icon: string }> }`
  - Filters by `org_settings.enabledAuthProviders`

### Linking (authenticated)

- `POST /api/auth/link/:provider` — initiates OAuth flow for linking (returns redirect URL with `intent=link` in state JWT)
- `GET /auth/:provider/callback` — handles both login and link callbacks (distinguished by `intent` in state JWT). On link: validates session, runs guards, creates identity link + email row.
- `DELETE /api/auth/link/:provider` — unlinks a provider (runs safety guards, deletes identity link + email + credential)

### Identity links (authenticated)

- `GET /api/auth/me/identities` — returns the user's auth identity links with profile fields
  - Response: `{ identities: Array<{ id, provider, externalId, email, externalName, metadata, createdAt }>, profileFields: Record<provider, IdentityProviderProfileField[]> }`

### Primary email (authenticated)

- `GET /api/auth/me/emails` — returns user's email list with primary flag
- `PUT /api/auth/me/emails/primary` — sets primary email (must be one the user owns in `user_emails`)
  - Request: `{ email: string }`
  - Updates both `user_emails.isPrimary` and `users.email` in a D1 transaction
  - **Guard:** primary email must satisfy org domain gating if enabled

### Admin: auth providers (admin-only)

- `PUT /api/admin/auth-providers` — sets enabled auth providers
  - Request: `{ providers: string[] }` (e.g. `["google", "email"]`)
  - Updates `org_settings.enabledAuthProviders`

### Callers that need updating

- `GET /api/auth/me` — stop reading `githubId`/`githubUsername` from users table; read from identity links instead. Update `gitConfig` backfill to source GitHub username from identity link metadata.
- `getUserGitConfig` in `lib/db/users.ts` — stop returning `githubUsername`; join through identity links or accept it as a parameter.
- `OrgSettings` type in `@valet/shared` — add `enabledAuthProviders?: string[]`.
- `getOrgSettings`/`updateOrgSettings` in `lib/db/org.ts` — handle the new column.

## What This Spec Does NOT Cover

- Account merging (out of scope — admin deletes orphaned accounts)
- MCP/OAuth provider linking (separate concern, handled by integrations)
- Channel identity links (unchanged, just share the table)
- Migration of existing users (clean break — everyone re-authenticates)
