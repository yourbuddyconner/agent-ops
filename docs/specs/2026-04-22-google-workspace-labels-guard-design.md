# Google Workspace Plugin Consolidation & Drive Labels Guard

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-22

## Problem

Google Drive contains sensitive data (financial/comp info, customer contracts, legal documents, credential tracking docs). The current Google integration uses the full `drive` OAuth scope, which means a connected user's Valet agent can access anything that user can see in Drive. This creates two risks:

1. **Centralized access** — Valet holds OAuth tokens for many users. A platform compromise could exfiltrate the union of all users' accessible files.
2. **Cross-user lateral access** — A bug in session isolation could let one user's agent access files via another user's token.

The full `drive` scope is necessary for the product to function (the more restrictive `drive.file` scope requires a browser-based picker for every file access, which is a non-starter for Slack/Telegram channels). Instead of reducing the OAuth scope, we add an application-layer guard using Google Drive Labels as an allowlist: files must carry an admin-specified label to be accessible to agents.

Separately, the current architecture splits Google Drive, Docs, and Sheets into three independent plugins with separate OAuth connections. Since all three operate on Drive files and share the same permission boundary, they should be consolidated into a single `google-workspace` plugin. This simplifies the labels guard (one plugin, one guard) and reduces user friction (one OAuth connection instead of three).

## What This Spec Covers

- Consolidating `plugin-google-drive`, `plugin-google-docs`, and `plugin-google-sheets` into `plugin-google-workspace`
- The Drive Labels guard: org-level, toggleable, default-deny allowlist
- Admin settings UI for configuring the guard
- Skills restructuring for the consolidated plugin
- `ActionContext` extension to pass org config into plugins

## What This Spec Does NOT Cover

- Gmail and Calendar integrations (different data domains, different permission boundaries)
- Per-user overrides or exemptions to the guard
- Label field-value filtering (e.g. "label X where status = approved") — presence-only check
- Audit logging of guard denials (future work)
- Changes to the `drive` OAuth scope

---

## 1. Plugin Consolidation

### Motivation

Google Docs and Sheets are Drive files. They share OAuth credentials, the same permission model, and the labels guard applies uniformly. Three separate plugins means three OAuth connections per user, three credential entries, and a guard that must coordinate across packages.

### Structure

```
packages/plugin-google-workspace/
  plugin.yaml
  package.json
  tsconfig.json
  skills/
    google-drive.md           # Drive guidance + cross-cutting "when to use which" table + guard awareness
    google-docs.md            # Docs-specific guidance (markdown patterns, section editing)
    google-sheets.md          # Sheets-specific guidance (A1 notation, formatting)
  src/actions/
    provider.ts               # Single OAuth provider, combined scopes
    actions.ts                # Aggregated ActionSource, delegates to app-specific modules
    drive-actions.ts          # drive.* actions (16)
    docs-actions.ts           # docs.* actions (15)
    sheets-actions.ts         # sheets.* actions (11)
    drive-api.ts              # Drive API fetch helpers
    docs-api.ts               # Docs API helpers
    sheets-api.ts             # Sheets API helpers
    labels-guard.ts           # Label-based access guard
```

### OAuth

Single provider with combined scopes:

- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.labels.readonly` (new — required both to enumerate available labels for the admin picker via the Labels API, and to read `labelInfo` on individual files during per-action guard checks)

The `drive.labels.readonly` scope allows reading labels only. The agent cannot apply or remove labels through the Labels API. The `drive` scope does grant access to `files.modifyLabels`, but since no action exposes that endpoint and the agent never receives raw OAuth tokens (all tool execution goes through the defined action pipeline), this is not a vector.

### Service Name

The new service name is `google_workspace`. This is a breaking change — existing `google_drive`, `google_docs`, and `google_sheets` integrations and credentials will stop working. Users reconnect once through the unified `google_workspace` OAuth flow. Existing action policy rules referencing old service names need updating.

### Action IDs

Action IDs are unchanged: `drive.list_files`, `docs.read_document`, `sheets.read_range`, etc. The namespace prefix (`drive.`, `docs.`, `sheets.`) distinguishes actions within the consolidated plugin.

Note: although action IDs are preserved, several tables key rows on `(service, action_id)` — so existing `disabled_actions` and `action_policies` rows for `(google_drive, drive.list_files)` will **not** match lookups for `(google_workspace, drive.list_files)`. These must be migrated or deleted (see Old Plugin Cleanup).

### Old Plugin Cleanup

The three old plugin directories (`plugin-google-drive`, `plugin-google-docs`, `plugin-google-sheets`) are deleted. Registry generation (`make generate-registries`) picks up the new `plugin-google-workspace` package. Registry regeneration and old plugin deletion must happen atomically (same deployment) to avoid duplicate skill slugs.

**D1 migration** cleans up all tables that reference old service names:

```sql
-- Credentials and integrations
DELETE FROM credentials WHERE provider IN ('google_drive','google_docs','google_sheets');
DELETE FROM integrations WHERE service IN ('google_drive','google_docs','google_sheets');

-- Action policies and disabled actions (keyed on service)
DELETE FROM action_policies WHERE service IN ('google_drive','google_docs','google_sheets');
DELETE FROM disabled_actions WHERE service IN ('google_drive','google_docs','google_sheets');

-- Tool cache
DELETE FROM mcp_tool_cache WHERE service IN ('google_drive','google_docs','google_sheets');

-- Plugin registry rows (stale after content registry regeneration)
DELETE FROM org_plugins WHERE name IN ('google-drive','google-docs','google-sheets');
```

`action_invocations` rows referencing old service names are intentionally preserved as historical audit data.

**Code references** that must be updated to `google_workspace`:

| File | What to change |
|---|---|
| `packages/shared/src/types/index.ts` | `IntegrationService` union: replace `google_drive` with `google_workspace` |
| `packages/worker/src/lib/orchestrator-persona.ts` | Hardcoded `google_drive` service name in persona instructions |
| `packages/client/src/components/integrations/service-icons.tsx` | `SERVICE_ICONS` map: add `google_workspace` entry |
| `packages/client/src/components/integrations/integration-card.tsx` | `serviceLabels` map: add `google_workspace` label |
| `packages/client/src/routes/integrations/callback.tsx` | `GOOGLE_API_LINKS` map: add `google_workspace` entry |
| `tsconfig.json` (root) | Swap project references from old plugins to `plugin-google-workspace` |
| `packages/worker/tsconfig.json` | Same |
| `packages/worker/package.json` | Swap workspace deps from old `@valet/plugin-google-*` to `@valet/plugin-google-workspace` |

---

## 2. Skills

The consolidated plugin ships three skills (not four — no routing skill):

### `google-drive.md`, `google-docs.md`, `google-sheets.md`

Carry over from the existing per-plugin skills. Changes required:

**Cross-references:** Replace all references to separate plugins ("use the dedicated `google-docs` plugin") with references to the tool namespaces ("use the `docs.*` tools for content editing"). Remove language about separate OAuth connections — all three share a single `google_workspace` credential.

**"When to use which" table:** The existing decision table in `google-drive.md` (Drive vs Docs vs Sheets) stays in `google-drive.md` with updated wording. Since all persona-attached skills are loaded eagerly at session start, a separate routing skill would add ~100 lines of meta-instructions telling the agent to do something it's already done. The cross-cutting guidance belongs inline in the Drive skill, which is the natural entry point for file operations.

**Guard awareness (new section in `google-drive.md`):** Add a short section explaining the labels guard behavior:
- If an action returns "File not found or access denied" for a file the user believes exists, the org may have a Drive Labels guard configured. The file must be labeled by the file owner in Google Drive to be accessible.
- If search returns fewer results than expected, the guard may be filtering unlabeled files.
- Tell the user which file triggered the error and that they or their admin need to apply the required Drive label to the file in the Google Drive UI.

---

## 3. Drive Labels Guard

### Overview

An optional, org-wide, admin-configured guard that restricts which Google Drive files the agent can access. When enabled, files must carry at least one of the admin-specified labels to be readable, writable, or discoverable by the agent. Files without a required label are invisible to the agent.

This is a default-deny allowlist with OR logic: a file needs at least one of the configured labels, not all of them.

### Org Settings

Three new fields on `orgSettings`:

| Field | Type | Default | Description |
|---|---|---|---|
| `driveLabelsGuardEnabled` | boolean | `false` | Master toggle. When false, the guard is a complete no-op (zero overhead). |
| `driveRequiredLabelIds` | string[] | `[]` | Label IDs that grant access. OR logic — file needs at least one. |
| `driveLabelsFailMode` | `'deny'` \| `'allow'` | `'deny'` | Behavior when label checking is impossible (API error, unsupported account). Default deny. |

### Guard Behavior by Action Type

The guard is internal to `plugin-google-workspace`. The plugin's `execute` function checks guard config before dispatching to action handlers.

**List/search actions** (`drive.list_files`, `drive.search_files`, `docs.search_documents`):
- Inject a label filter into the Drive API `q` parameter
- For a single label: `'labels/{id}' in labels`
- For multiple required labels (OR): `('labels/{id1}' in labels OR 'labels/{id2}' in labels)` — the OR clause **must** be parenthesized when combined with other query terms via AND, otherwise Drive API operator precedence (AND binds tighter than OR) would cause the second label branch to match all files regardless of other filters
- `drive.search_files` and `docs.search_documents` currently use hardcoded query strings rather than composable query-part arrays (unlike `drive.list_files`). These must be refactored to use the array pattern during consolidation so the label filter can be cleanly injected.
- Unlabeled files never appear in results

**Read/get actions** (`drive.read_file`, `drive.get_file`, `drive.export_file`, `docs.read_document`, `docs.read_section`, `docs.get_document`, `docs.list_sections`, `docs.list_comments`, `sheets.get_spreadsheet`, `sheets.read_range`, `sheets.read_multiple_ranges`, `sheets.read_formatting`):
- Before executing, check the file's labels. The guard calls `files.get` with `includeLabels={comma-separated label IDs}&fields=labelInfo&supportsAllDrives=true`. The `supportsAllDrives` parameter is required — without it, files in shared drives return 404.
- Where an action already makes a `files.get` call for metadata (e.g. `drive.read_file` fetches `id,name,mimeType,size`), extend that existing call to include `includeLabels` and `labelInfo` in the `fields` parameter rather than making a separate preflight request. For actions that don't already fetch metadata (e.g. `drive.export_file`, `docs.read_document`), the guard adds a standalone `files.get` call.
- The `labelInfo.labels` array in the response contains only applied labels that matched the requested IDs. An empty array means no required label is present.
- If `labelInfo.labels.length === 0`, return `{ success: false, error: "File not found or access denied" }`. The error message is intentionally indistinguishable from a 404 or permission error to avoid leaking file existence to the agent.

**Write/modify actions** (`drive.update_content`, `drive.update_metadata`, `drive.copy_file`, `drive.share_file`, `drive.list_permissions`, `drive.remove_permission`, `drive.trash_file`, `drive.untrash_file`, `drive.delete_file`, `docs.replace_document`, `docs.append_content`, `docs.replace_section`, `docs.insert_section`, `docs.delete_section`, `docs.update_document`, `docs.create_comment`, `docs.reply_to_comment`, `sheets.write_range`, `sheets.append_rows`, `sheets.clear_range`, `sheets.format_cells`, `sheets.add_sheet`, `sheets.delete_sheet`):
- Same per-file label check as read actions — verify label before allowing the operation
- **`drive.copy_file`** additionally auto-labels the new copy after success (same as create actions), since Google does not guarantee label inheritance on copy

**Create actions** (`drive.create_file`, `drive.create_folder`, `docs.create_document`, `sheets.create_spreadsheet`):
- Execute the create normally
- After successful creation, apply the first label from `driveRequiredLabelIds` to the new file via `files.modifyLabels`
- If auto-labeling fails (e.g. the user lacks Applier permissions on the label, or the API errors), **delete the newly created file and return an error**: `{ success: false, error: "Failed to create file: could not apply required Drive label" }`. A silent success that produces an inaccessible file is worse than a clear failure. The admin should ensure users have Applier permissions on the configured labels — this is a Google Workspace admin setting on the label itself.

### Guard Bypass

The guard is a complete no-op when `driveLabelsGuardEnabled` is `false`. No API calls, no latency impact.

If `driveLabelsGuardEnabled` is `true` but `driveRequiredLabelIds` is empty, the guard **denies all file operations**. An enabled guard with no configured labels means "nothing is allowed" — not "everything is allowed." This prevents a misconfigured org from silently getting no protection.

### No Caching

The per-file label check calls `files.get` for metadata on every action. This adds ~50-100ms per action. Google's per-user quota is 12,000 requests/minute, which an agent will not approach. Skipping the cache means label changes take effect immediately and the implementation stays simple.

### Error Handling

When the label check itself fails (API error, network issue, unsupported account):
- If `driveLabelsFailMode` is `'deny'` (default): reject the action
- If `driveLabelsFailMode` is `'allow'`: skip the guard, allow the action

### Labels and OAuth Tokens

Users manage labels through the Google Drive UI as a self-service opt-in/opt-out. Applying a label to a file makes it accessible to their Valet agent; removing the label revokes access. No `modifyLabels` action is exposed in the plugin's action set — the agent operates exclusively through defined actions and never receives raw OAuth tokens.

### Audit Trail

Guard denials flow through the existing invocation lifecycle: `invokeAction` records the invocation as `status='executed'` (policy approved), then the plugin returns `{ success: false }`, and `markFailed` updates the row to `status='failed'`. The error string distinguishes guard denials from other failures. A dedicated `denial_reason` column or audit event is deferred to the audit logging work noted in "What This Spec Does NOT Cover."

### Guard Completeness

The guard is enforced inside the plugin — there is no worker-layer backstop. To prevent regressions when new actions are added, the plugin must include a test that enumerates all registered action IDs and asserts every one is classified in `labels-guard.ts` (as list/search, read/get, write/modify, or create). An unclassified action fails the test.

---

## 4. ActionContext Extension

The plugin needs org-level guard configuration at execution time. Currently `ActionContext` contains `credentials`, `userId`, `orgId`, and a few other fields. It does not carry org settings.

Add an optional `guardConfig` field:

```typescript
export interface ActionContext {
  credentials: IntegrationCredentials;
  userId: string;
  orgId?: string;
  callerIdentity?: CallerIdentity;
  analytics?: Analytics;
  attribution?: { name: string; email: string };
  /** Org-level guard configuration, passed by the worker at execution time. */
  guardConfig?: Record<string, unknown>;
}
```

Threading `guardConfig` from org settings to the plugin requires four coordinated changes:

1. **SDK type** — add `guardConfig?: Record<string, unknown>` to `ActionContext` in `packages/sdk/src/integrations/index.ts`
2. **`ExecuteActionOpts`** — add `guardConfig?: Record<string, unknown>` to the opts type in `session-tools.ts`
3. **`executeAction` call sites** — thread `guardConfig` into the `ActionContext` object built at the `actionSource.execute()` call (and the auth-retry call that re-invokes `execute`)
4. **`SessionAgentDO`** — add a typed instance field (e.g. `private cachedGuardConfig: Record<string, unknown> | null = null`) populated on the first tool call of each turn via `getOrgSettings()`, with a short TTL (e.g. 60s) so mid-session config changes eventually propagate without requiring a D1 read on every action

The plugin reads `guardConfig` and validates it against a typed shape for its expected keys (`driveLabelsGuardEnabled`, `driveRequiredLabelIds`, `driveLabelsFailMode`).

Using `Record<string, unknown>` keeps the SDK generic — other plugins could use `guardConfig` for their own org-level settings without SDK changes.

The guard also applies to orchestrator sessions (both user and org orchestrators). Orchestrators follow the same org settings as regular sessions — there is no exemption. This is correct because the guard protects files, not sessions.

---

## 5. Admin Settings UI

### Feature Detection

When the admin opens the Google Workspace guard settings, the frontend calls:

```
GET /api/integrations/google_workspace/labels
```

This endpoint resolves credentials for `google_workspace` using the requesting admin's user ID (same `resolveCredentials` flow as other integration endpoints). If the admin hasn't connected Google Workspace yet, the endpoint returns the "no integration connected" outcome. The resolved token is used to call the Drive Labels API:

**Note on label visibility:** The `labels.list` call returns labels the requesting user has at least `READER` access to. If the admin configures a label that some users lack `READER` access to, those users' per-file `includeLabels` checks will return empty results for that label — effectively denying access. This is acceptable (it errs on the side of restriction), but admins should ensure the configured labels are visible org-wide.

```
GET https://drivelabels.googleapis.com/v2/labels?view=LABEL_VIEW_FULL
```

Three outcomes:
1. **Labels returned** — render the configuration UI
2. **API error / unsupported account** — render disabled state: "Drive Labels require Google Workspace Business Standard or higher"
3. **No integration connected** — prompt admin to connect Google Workspace first

### Configuration UI

Located in the admin settings panel (alongside existing org settings):

- **Toggle**: "Require Drive labels for agent access" (maps to `driveLabelsGuardEnabled`)
- **Label picker** (shown when toggle is on): multi-select from available labels returned by the API. Each label shows its name and type (badged/standard).
- **Fail mode selector**: "When labels can't be checked:" with options "Deny access" (default, recommended) and "Allow access" (with a warning that this weakens the guard)
- **Save** persists to org settings. This requires a new route (or extension of an existing admin settings route) that accepts the three guard fields, and an extension of `updateOrgSettings` in `packages/worker/src/lib/db/org.ts` to accept them.

### API Endpoint

```
GET /api/integrations/google_workspace/labels
```

Response:
```json
{
  "available": true,
  "labels": [
    { "id": "labels/abc123", "name": "Valet Access", "type": "ADMIN" },
    { "id": "labels/def456", "name": "Public", "type": "ADMIN" }
  ]
}
```

Or when unavailable:
```json
{
  "available": false,
  "reason": "Drive Labels API not available for this account type"
}
```

---

## 6. Database Changes

### Org Settings Schema

Add three columns to the `orgSettings` table:

```sql
ALTER TABLE org_settings ADD COLUMN drive_labels_guard_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_settings ADD COLUMN drive_required_label_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE org_settings ADD COLUMN drive_labels_fail_mode TEXT NOT NULL DEFAULT 'deny';
```

`drive_required_label_ids` stores a JSON array of label ID strings. `drive_labels_fail_mode` is constrained to `'deny'` or `'allow'` at the application layer.

### Drizzle Schema

Add corresponding fields to the `orgSettings` Drizzle schema in `packages/worker/src/lib/schema/org.ts` with appropriate types and defaults.

### Shared Types

Add `driveLabelsGuardEnabled`, `driveRequiredLabelIds`, and `driveLabelsFailMode` to the `OrgSettings` interface in `packages/shared/src/types/index.ts`. Update `rowToOrgSettings` in `packages/worker/src/lib/db/org.ts` to surface these fields. Extend `updateOrgSettings` to accept the three new fields in its update input.

### No New Tables

The guard configuration lives entirely in org settings. No separate tables for label allowlists.

---

## 7. Rollout

1. **Create `plugin-google-workspace`** — consolidate Drive + Docs + Sheets code, single provider, combined scopes, restructured skills
2. **Delete old plugins and clean up stale data** — remove `plugin-google-drive`, `plugin-google-docs`, `plugin-google-sheets`, regenerate registries. In the same migration, delete stale integration/credential rows for `google_drive`, `google_docs`, `google_sheets` so users aren't left in a broken state between deployment and cleanup. Users will see the integration as disconnected and need to reconnect via `google_workspace`.
3. **Extend `ActionContext`** — add `guardConfig` field to the SDK type. Wire `session-tools.ts::executeAction` to accept and thread `guardConfig` into the context. Update `SessionAgentDO` to fetch org settings on wake and pass guard fields to `executeAction`.
4. **Add org settings fields** — D1 migration for three new columns, Drizzle schema update, shared `OrgSettings` type update, `rowToOrgSettings` mapper update, `updateOrgSettings` extension, new or extended admin settings route to accept the guard fields.
5. **Implement labels guard** — `labels-guard.ts` in the plugin, integrated into the consolidated `execute` function
6. **Add labels API endpoint** — `GET /api/integrations/google_workspace/labels` for feature detection, using the requesting admin's resolved credentials
7. **Add admin settings UI** — toggle, label picker, fail mode selector
