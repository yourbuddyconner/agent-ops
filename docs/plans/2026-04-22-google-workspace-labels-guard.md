# Google Workspace Plugin Consolidation & Drive Labels Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate three Google plugins into `plugin-google-workspace` and add an optional Drive Labels-based access guard.

**Architecture:** A single plugin package replaces `plugin-google-drive`, `plugin-google-docs`, and `plugin-google-sheets`. The plugin's `execute` function delegates to a labels guard before dispatching to action handlers. Guard configuration flows from org settings through `ActionContext.guardConfig`, populated by the DO from cached org settings.

**Tech Stack:** TypeScript, Cloudflare Workers (Hono, D1/Drizzle, Durable Objects), React (TanStack Query, Radix UI), Google Drive API v3, Google Drive Labels API v2

**Spec:** `docs/specs/2026-04-22-google-workspace-labels-guard-design.md`

---

## Task 1: Scaffold `plugin-google-workspace` Package

**Files:**
- Create: `packages/plugin-google-workspace/plugin.yaml`
- Create: `packages/plugin-google-workspace/package.json`
- Create: `packages/plugin-google-workspace/tsconfig.json`
- Create: `packages/plugin-google-workspace/src/actions/index.ts`

- [ ] **Step 1: Create `plugin.yaml`**

```yaml
name: google-workspace
version: 0.0.1
description: Google Workspace integration — Drive, Docs, and Sheets with unified OAuth and labels-based access guard
icon: "🏢"
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@valet/plugin-google-workspace",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./actions": "./src/actions/index.ts"
  },
  "dependencies": {
    "@valet/sdk": "workspace:*",
    "@valet/shared": "workspace:*",
    "unpdf": "^0.12.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.1.1"
  }
}
```

Note: `unpdf` is used by `drive.read_file` for PDF text extraction. Check `packages/plugin-google-drive/package.json` for the exact version and copy it.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../sdk" },
    { "path": "../shared" }
  ]
}
```

Check `packages/plugin-google-drive/tsconfig.json` for exact shape and copy it.

- [ ] **Step 4: Create `src/actions/index.ts`**

Placeholder that will be filled in Task 3:

```typescript
export { googleWorkspacePackage as default } from './actions.js';
```

- [ ] **Step 5: Run `pnpm install` to register the new workspace package**

Run: `pnpm install`

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-google-workspace/
git commit -m "feat: scaffold plugin-google-workspace package"
```

---

## Task 2: Create Unified Provider

**Files:**
- Create: `packages/plugin-google-workspace/src/actions/provider.ts`
- Reference: `packages/plugin-google-drive/src/actions/provider.ts` (copy and adapt)

- [ ] **Step 1: Copy the Drive provider as a starting point**

Copy `packages/plugin-google-drive/src/actions/provider.ts` to `packages/plugin-google-workspace/src/actions/provider.ts`.

- [ ] **Step 2: Update service name and scopes**

Change:
- Service: `'google_drive'` → `'google_workspace'`
- Display name: `'Google Drive'` → `'Google Workspace'`
- Scopes: combine all four scopes into one array:

```typescript
const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.labels.readonly',
];
```

- Entities: `['files', 'folders', 'permissions', 'documents', 'spreadsheets']`

Everything else (OAuth URL building, token exchange, refresh logic) stays identical — all three old plugins used the same Google OAuth endpoints and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env vars.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/plugin-google-workspace && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-google-workspace/src/actions/provider.ts
git commit -m "feat(google-workspace): unified OAuth provider with combined scopes"
```

---

## Task 3: Consolidate Action Modules

**Files:**
- Create: `packages/plugin-google-workspace/src/actions/drive-api.ts`
- Create: `packages/plugin-google-workspace/src/actions/drive-actions.ts`
- Create: `packages/plugin-google-workspace/src/actions/docs-api.ts`
- Create: `packages/plugin-google-workspace/src/actions/docs-actions.ts`
- Create: `packages/plugin-google-workspace/src/actions/sheets-api.ts`
- Create: `packages/plugin-google-workspace/src/actions/sheets-actions.ts`
- Create: `packages/plugin-google-workspace/src/actions/actions.ts`
- Modify: `packages/plugin-google-workspace/src/actions/index.ts`

- [ ] **Step 1: Copy Drive action files**

Copy `packages/plugin-google-drive/src/actions/actions.ts` → `packages/plugin-google-workspace/src/actions/drive-actions.ts`.

If the old plugin has a separate API helper file (check for `api.ts` or `drive-api.ts` in `packages/plugin-google-drive/src/actions/`), copy it too. Otherwise, extract the `driveFetch`, `driveUploadFetch`, `escapeDriveQuery`, `driveError` helpers from the actions file into `drive-api.ts`.

Refactor `drive.search_files` to use a composable query-parts array (currently a hardcoded string). Change from:

```typescript
q: `fullText contains '${escapeDriveQuery(p.query)}' and trashed = false`,
```

To:

```typescript
const queryParts: string[] = [
  `fullText contains '${escapeDriveQuery(p.query)}'`,
  'trashed = false',
];
// ... label filter will be injected here by the guard
q: queryParts.join(' and '),
```

Export the action definitions array and execute function separately (not as an `ActionSource` — that's assembled in `actions.ts`):

```typescript
export const driveActionDefs: ActionDefinition[] = allActions;
export { executeAction as executeDriveAction };
```

- [ ] **Step 2: Copy Docs action files**

Same pattern. Copy `packages/plugin-google-docs/src/actions/actions.ts` → `docs-actions.ts`. Extract API helpers into `docs-api.ts`.

Refactor `docs.search_documents` to use composable query parts (same pattern as Drive search above):

```typescript
const queryParts: string[] = [
  `fullText contains '${escapeDriveQuery(p.query)}'`,
  `mimeType='application/vnd.google-apps.document'`,
  'trashed = false',
];
```

Export action defs and execute function:

```typescript
export const docsActionDefs: ActionDefinition[] = allActions;
export { executeAction as executeDocsAction };
```

- [ ] **Step 3: Copy Sheets action files**

Same pattern. Copy `packages/plugin-google-sheets/src/actions/actions.ts` → `sheets-actions.ts`. Extract API helpers into `sheets-api.ts`.

Export action defs and execute function:

```typescript
export const sheetsActionDefs: ActionDefinition[] = allActions;
export { executeAction as executeSheetsAction };
```

- [ ] **Step 4: Create the aggregated `actions.ts`**

```typescript
import type {
  ActionContext,
  ActionDefinition,
  ActionResult,
  ActionSource,
  IntegrationPackage,
} from '@valet/sdk/integrations';
import { googleWorkspaceProvider } from './provider.js';
import { driveActionDefs, executeDriveAction } from './drive-actions.js';
import { docsActionDefs, executeDocsAction } from './docs-actions.js';
import { sheetsActionDefs, executeSheetsAction } from './sheets-actions.js';

const allActions: ActionDefinition[] = [
  ...driveActionDefs,
  ...docsActionDefs,
  ...sheetsActionDefs,
];

async function executeAction(
  actionId: string,
  params: unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  // Dispatch to the correct sub-module based on action prefix
  if (actionId.startsWith('drive.')) return executeDriveAction(actionId, params, ctx);
  if (actionId.startsWith('docs.')) return executeDocsAction(actionId, params, ctx);
  if (actionId.startsWith('sheets.')) return executeSheetsAction(actionId, params, ctx);
  return { success: false, error: `Unknown action: ${actionId}` };
}

const actions: ActionSource = {
  listActions: () => allActions,
  execute: executeAction,
};

export const googleWorkspacePackage: IntegrationPackage = {
  name: 'google-workspace',
  version: '0.0.1',
  service: 'google_workspace',
  provider: googleWorkspaceProvider,
  actions,
};
```

- [ ] **Step 5: Update `index.ts`**

```typescript
export { googleWorkspacePackage as default } from './actions.js';
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd packages/plugin-google-workspace && pnpm typecheck`

Fix any import path issues. The most common problems will be relative imports within the copied files that need updating.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-google-workspace/src/actions/
git commit -m "feat(google-workspace): consolidate Drive, Docs, Sheets actions into single plugin"
```

---

## Task 4: Migrate Skills

**Files:**
- Create: `packages/plugin-google-workspace/skills/google-drive.md`
- Create: `packages/plugin-google-workspace/skills/google-docs.md`
- Create: `packages/plugin-google-workspace/skills/google-sheets.md`

- [ ] **Step 1: Copy existing skills**

```bash
cp packages/plugin-google-drive/skills/google-drive.md packages/plugin-google-workspace/skills/google-drive.md
cp packages/plugin-google-docs/skills/google-docs.md packages/plugin-google-workspace/skills/google-docs.md
cp packages/plugin-google-sheets/skills/google-sheets.md packages/plugin-google-workspace/skills/google-sheets.md
```

- [ ] **Step 2: Update cross-references in all three skills**

In all three files, replace:
- `"the dedicated \`google-docs\` plugin"` → `"the \`docs.*\` tools"`
- `"the dedicated \`google-sheets\` plugin"` → `"the \`sheets.*\` tools"`
- `"the dedicated \`google-drive\` plugin"` → `"the \`drive.*\` tools"`
- `"through the \`google-docs\` plugin"` → `"through the Google Workspace integration"`
- `"through the \`google-sheets\` plugin"` → `"through the Google Workspace integration"`
- Any mention of separate OAuth connections → "all three share a single Google Workspace credential"

- [ ] **Step 3: Add guard awareness section to `google-drive.md`**

Add before the "Tips" section at the end of `google-drive.md`:

```markdown
## Drive Labels Guard

Your organization may have a Drive Labels guard enabled. When active, only files with an admin-configured Google Drive label are accessible.

**If you get "File not found or access denied"** for a file the user says exists, the file likely doesn't have the required Drive label. Tell the user:
- The file needs a specific Google Drive label applied to be accessible to Valet
- They can apply the label in the Google Drive web UI (right-click → Labels)
- Their admin can tell them which label is required

**If search returns fewer results than expected**, the guard may be filtering out unlabeled files. Let the user know that only labeled files are visible.
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-google-workspace/skills/
git commit -m "feat(google-workspace): migrate and update skills with guard awareness"
```

---

## Task 5: Update Build Configuration and References

**Files:**
- Modify: `tsconfig.json` (root, lines 24-26)
- Modify: `packages/worker/tsconfig.json` (lines 21-23)
- Modify: `packages/worker/package.json` (lines 32-34)
- Modify: `packages/shared/src/types/index.ts` (line 8, `IntegrationService` type)
- Modify: `packages/worker/src/lib/orchestrator-persona.ts` (line 78)
- Modify: `packages/client/src/components/integrations/service-icons.tsx` (line 139)
- Modify: `packages/client/src/components/integrations/integration-card.tsx` (line 15)
- Modify: `packages/client/src/routes/integrations/callback.tsx` (lines 19-22)

- [ ] **Step 1: Update root `tsconfig.json`**

Remove the three old plugin references and add the new one. In the `references` array, replace:

```json
{ "path": "./packages/plugin-google-docs" },
{ "path": "./packages/plugin-google-drive" },
{ "path": "./packages/plugin-google-sheets" },
```

With:

```json
{ "path": "./packages/plugin-google-workspace" },
```

- [ ] **Step 2: Update `packages/worker/tsconfig.json`**

In the `references` array, replace:

```json
{ "path": "../plugin-google-docs" },
{ "path": "../plugin-google-drive" },
{ "path": "../plugin-google-sheets" },
```

With:

```json
{ "path": "../plugin-google-workspace" },
```

- [ ] **Step 3: Update `packages/worker/package.json`**

In `dependencies`, replace:

```json
"@valet/plugin-google-docs": "workspace:*",
"@valet/plugin-google-drive": "workspace:*",
"@valet/plugin-google-sheets": "workspace:*",
```

With:

```json
"@valet/plugin-google-workspace": "workspace:*",
```

- [ ] **Step 4: Update `IntegrationService` type**

In `packages/shared/src/types/index.ts`, replace `'google_drive'` with `'google_workspace'` in the `IntegrationService` union type. The type does not include `google_docs` or `google_sheets` (those were never in the union), so only the Drive entry needs changing.

- [ ] **Step 5: Update orchestrator persona**

In `packages/worker/src/lib/orchestrator-persona.ts`, find the hardcoded `google_drive` reference (~line 78) and replace with `google_workspace`. Update the `call_tool` example prefix from `google_drive:` to `google_workspace:`.

- [ ] **Step 6: Update frontend service icons**

In `packages/client/src/components/integrations/service-icons.tsx`, in the `SERVICE_ICONS` map (~line 139), replace:

```typescript
google_drive: GoogleDriveIcon,
```

With:

```typescript
google_workspace: GoogleDriveIcon,  // reuse Drive icon for now
```

- [ ] **Step 7: Update frontend service labels**

In `packages/client/src/components/integrations/integration-card.tsx`, in the `serviceLabels` map (~line 15), replace:

```typescript
google_drive: 'Google Drive',
```

With:

```typescript
google_workspace: 'Google Workspace',
```

- [ ] **Step 8: Update OAuth callback helper**

In `packages/client/src/routes/integrations/callback.tsx`, in `GOOGLE_API_LINKS` (~lines 19-22), replace the `google_drive` key:

```typescript
google_workspace: {
  name: 'Google Drive, Docs, Sheets, and Labels APIs',
  url: 'https://console.cloud.google.com/apis/library',
},
```

- [ ] **Step 9: Run `pnpm install` then typecheck**

Run: `pnpm install && pnpm typecheck`

This will likely fail because the old plugin packages are still referenced from generated registries. That's expected — we'll fix it in the next task.

- [ ] **Step 10: Commit**

```bash
git add tsconfig.json packages/worker/tsconfig.json packages/worker/package.json packages/shared/src/types/index.ts packages/worker/src/lib/orchestrator-persona.ts packages/client/src/components/integrations/service-icons.tsx packages/client/src/components/integrations/integration-card.tsx packages/client/src/routes/integrations/callback.tsx
git commit -m "feat: update build config and code references for google_workspace"
```

---

## Task 6: Delete Old Plugins and Regenerate Registries

**Files:**
- Delete: `packages/plugin-google-drive/` (entire directory)
- Delete: `packages/plugin-google-docs/` (entire directory)
- Delete: `packages/plugin-google-sheets/` (entire directory)
- Modify: `packages/worker/src/integrations/packages.ts` (auto-generated)
- Modify: `packages/worker/src/plugins/content-registry.ts` (auto-generated)

- [ ] **Step 1: Delete old plugin directories**

```bash
rm -rf packages/plugin-google-drive packages/plugin-google-docs packages/plugin-google-sheets
```

- [ ] **Step 2: Regenerate registries**

Run: `make generate-registries`

This scans `packages/plugin-*/` and regenerates:
- `packages/worker/src/integrations/packages.ts` — will now include `@valet/plugin-google-workspace` instead of the three old packages
- `packages/worker/src/plugins/content-registry.ts` — will include the three skills from the new plugin
- `packages/worker/src/channels/packages.ts` — unchanged (no Google channels)

- [ ] **Step 3: Run `pnpm install` and verify typecheck**

Run: `pnpm install && pnpm typecheck`

This is the key verification that the consolidation compiles. Fix any remaining import issues.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: delete old Google plugins, regenerate registries for google_workspace"
```

---

## Task 7: D1 Migration — Clean Up Stale Data and Add Org Settings Fields

**Files:**
- Create: `packages/worker/migrations/0007_google_workspace_consolidation.sql` (check actual next number)
- Modify: `packages/worker/src/lib/schema/org.ts`
- Modify: `packages/shared/src/types/index.ts` (OrgSettings interface)
- Modify: `packages/worker/src/lib/db/org.ts` (rowToOrgSettings, updateOrgSettings)

- [ ] **Step 1: Determine the next migration number**

Run: `ls packages/worker/migrations/ | tail -5`

Use the next sequential number. The examples below assume `0007` — adjust if needed.

- [ ] **Step 2: Create the migration**

Create `packages/worker/migrations/0007_google_workspace_consolidation.sql`:

```sql
-- Clean up stale data from old Google plugins (google_drive, google_docs, google_sheets)
DELETE FROM credentials WHERE provider IN ('google_drive','google_docs','google_sheets');
DELETE FROM integrations WHERE service IN ('google_drive','google_docs','google_sheets');
DELETE FROM action_policies WHERE service IN ('google_drive','google_docs','google_sheets');
DELETE FROM disabled_actions WHERE service IN ('google_drive','google_docs','google_sheets');
DELETE FROM mcp_tool_cache WHERE service IN ('google_drive','google_docs','google_sheets');
DELETE FROM org_plugins WHERE name IN ('google-drive','google-docs','google-sheets');

-- Add Drive Labels guard settings to org_settings
ALTER TABLE org_settings ADD COLUMN drive_labels_guard_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_settings ADD COLUMN drive_required_label_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE org_settings ADD COLUMN drive_labels_fail_mode TEXT NOT NULL DEFAULT 'deny';
```

- [ ] **Step 3: Update Drizzle schema**

In `packages/worker/src/lib/schema/org.ts`, add to the `orgSettings` table definition:

```typescript
driveLabelsGuardEnabled: integer('drive_labels_guard_enabled').notNull().default(0),
driveRequiredLabelIds: text('drive_required_label_ids').notNull().default('[]'),
driveLabelsFailMode: text('drive_labels_fail_mode').notNull().default('deny'),
```

- [ ] **Step 4: Update shared `OrgSettings` type**

In `packages/shared/src/types/index.ts`, add to the `OrgSettings` interface:

```typescript
driveLabelsGuardEnabled: boolean;
driveRequiredLabelIds: string[];
driveLabelsFailMode: 'deny' | 'allow';
```

- [ ] **Step 5: Update `rowToOrgSettings` mapper**

In `packages/worker/src/lib/db/org.ts`, in the `rowToOrgSettings` function, add the three new fields. Map the integer column to boolean and parse the JSON array:

```typescript
driveLabelsGuardEnabled: Boolean(row.driveLabelsGuardEnabled),
driveRequiredLabelIds: JSON.parse(row.driveRequiredLabelIds || '[]') as string[],
driveLabelsFailMode: (row.driveLabelsFailMode || 'deny') as 'deny' | 'allow',
```

- [ ] **Step 6: Extend `updateOrgSettings` to accept the new fields**

In `packages/worker/src/lib/db/org.ts`, add the three fields to `updateOrgSettings`'s accepted input type. When setting them, serialize `driveRequiredLabelIds` to JSON and convert `driveLabelsGuardEnabled` boolean to integer:

```typescript
if (updates.driveLabelsGuardEnabled !== undefined) {
  set.driveLabelsGuardEnabled = updates.driveLabelsGuardEnabled ? 1 : 0;
}
if (updates.driveRequiredLabelIds !== undefined) {
  set.driveRequiredLabelIds = JSON.stringify(updates.driveRequiredLabelIds);
}
if (updates.driveLabelsFailMode !== undefined) {
  set.driveLabelsFailMode = updates.driveLabelsFailMode;
}
```

- [ ] **Step 7: Apply migration locally**

Run: `make db-migrate`

- [ ] **Step 8: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/worker/migrations/ packages/worker/src/lib/schema/org.ts packages/shared/src/types/index.ts packages/worker/src/lib/db/org.ts
git commit -m "feat: D1 migration for google_workspace consolidation and labels guard settings"
```

---

## Task 8: Extend `ActionContext` with `guardConfig`

**Files:**
- Modify: `packages/sdk/src/integrations/index.ts` (line 39-49, `ActionContext`)
- Modify: `packages/worker/src/services/session-tools.ts` (lines ~421-432 `executeAction`, lines ~482 and ~502 `execute` calls)
- Modify: `packages/worker/src/durable-objects/session-agent.ts` (add cached guard config, thread to executeAction)

- [ ] **Step 1: Add `guardConfig` to SDK `ActionContext`**

In `packages/sdk/src/integrations/index.ts`, add to the `ActionContext` interface (after the `attribution` field):

```typescript
/** Org-level guard configuration, passed by the worker at execution time. */
guardConfig?: Record<string, unknown>;
```

- [ ] **Step 2: Add `guardConfig` to `ExecuteActionOpts` in `session-tools.ts`**

Find the `ExecuteActionOpts` type (or the opts parameter type for `executeAction`) and add:

```typescript
guardConfig?: Record<string, unknown>;
```

- [ ] **Step 3: Thread `guardConfig` into `actionSource.execute` calls**

In `session-tools.ts`, find the `actionSource.execute()` call (~line 482) and the retry call (~line 502). Add `guardConfig: opts.guardConfig` to the `ActionContext` object passed to both calls:

```typescript
let actionResult = await actionSource.execute(actionId, params, {
  credentials,
  userId,
  attribution,
  callerIdentity,
  analytics: actionAnalytics,
  guardConfig: opts.guardConfig,  // ADD THIS
});
```

Do the same for the retry call.

- [ ] **Step 4: Add cached guard config to `SessionAgentDO`**

In `packages/worker/src/durable-objects/session-agent.ts`:

1. Add an instance field:
```typescript
private guardConfig: Record<string, unknown> | null = null;
private guardConfigExpiresAt = 0;
```

2. Add a method to load guard config with TTL:
```typescript
private async getGuardConfig(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (this.guardConfig && now < this.guardConfigExpiresAt) {
    return this.guardConfig;
  }
  const settings = await getOrgSettings(this.appDb);
  this.guardConfig = {
    driveLabelsGuardEnabled: settings.driveLabelsGuardEnabled,
    driveRequiredLabelIds: settings.driveRequiredLabelIds,
    driveLabelsFailMode: settings.driveLabelsFailMode,
  };
  this.guardConfigExpiresAt = now + 60_000; // 60s TTL
  return this.guardConfig;
}
```

3. In the method that calls `executeAction` (find `executeActionAndSend` or equivalent), load guard config and pass it:
```typescript
const guardConfig = await this.getGuardConfig();
// ... pass guardConfig in the opts to executeAction
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/integrations/index.ts packages/worker/src/services/session-tools.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat: extend ActionContext with guardConfig, thread from DO to plugin execution"
```

---

## Task 9: Implement Labels Guard

**Files:**
- Create: `packages/plugin-google-workspace/src/actions/labels-guard.ts`
- Create: `packages/plugin-google-workspace/src/actions/__tests__/labels-guard.test.ts`
- Modify: `packages/plugin-google-workspace/src/actions/actions.ts` (integrate guard into execute)

- [ ] **Step 1: Write the guard completeness test**

Create `packages/plugin-google-workspace/src/actions/__tests__/labels-guard.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { driveActionDefs } from '../drive-actions.js';
import { docsActionDefs } from '../docs-actions.js';
import { sheetsActionDefs } from '../sheets-actions.js';
import {
  LIST_SEARCH_ACTIONS,
  READ_GET_ACTIONS,
  WRITE_MODIFY_ACTIONS,
  CREATE_ACTIONS,
} from '../labels-guard.js';

describe('labels-guard action classification', () => {
  it('every registered action is classified in exactly one guard category', () => {
    const allActionIds = [
      ...driveActionDefs.map((a) => a.id),
      ...docsActionDefs.map((a) => a.id),
      ...sheetsActionDefs.map((a) => a.id),
    ];

    const allClassified = new Set([
      ...LIST_SEARCH_ACTIONS,
      ...READ_GET_ACTIONS,
      ...WRITE_MODIFY_ACTIONS,
      ...CREATE_ACTIONS,
    ]);

    for (const id of allActionIds) {
      expect(allClassified.has(id), `Action "${id}" is not classified in labels-guard.ts`).toBe(true);
    }

    // No duplicates across categories
    const total = LIST_SEARCH_ACTIONS.length + READ_GET_ACTIONS.length
      + WRITE_MODIFY_ACTIONS.length + CREATE_ACTIONS.length;
    expect(total).toBe(allClassified.size);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (guard module doesn't exist yet)

Run: `cd packages/plugin-google-workspace && npx vitest run src/actions/__tests__/labels-guard.test.ts`

Expected: FAIL — cannot import `labels-guard.js`

- [ ] **Step 3: Create `labels-guard.ts`**

```typescript
import type { ActionContext, ActionResult } from '@valet/sdk/integrations';

// ─── Guard Config Shape ─────────────────────────────────────────────────────

interface DriveLabelsGuardConfig {
  driveLabelsGuardEnabled: boolean;
  driveRequiredLabelIds: string[];
  driveLabelsFailMode: 'deny' | 'allow';
}

function parseGuardConfig(raw?: Record<string, unknown>): DriveLabelsGuardConfig | null {
  if (!raw || !raw.driveLabelsGuardEnabled) return null;
  return {
    driveLabelsGuardEnabled: Boolean(raw.driveLabelsGuardEnabled),
    driveRequiredLabelIds: Array.isArray(raw.driveRequiredLabelIds)
      ? (raw.driveRequiredLabelIds as string[])
      : [],
    driveLabelsFailMode: raw.driveLabelsFailMode === 'allow' ? 'allow' : 'deny',
  };
}

// ─── Action Classification ──────────────────────────────────────────────────

export const LIST_SEARCH_ACTIONS = [
  'drive.list_files',
  'drive.search_files',
  'docs.search_documents',
] as const;

export const READ_GET_ACTIONS = [
  'drive.read_file',
  'drive.get_file',
  'drive.export_file',
  'docs.read_document',
  'docs.read_section',
  'docs.get_document',
  'docs.list_sections',
  'docs.list_comments',
  'sheets.get_spreadsheet',
  'sheets.read_range',
  'sheets.read_multiple_ranges',
  'sheets.read_formatting',
] as const;

export const WRITE_MODIFY_ACTIONS = [
  'drive.update_content',
  'drive.update_metadata',
  'drive.copy_file',
  'drive.share_file',
  'drive.list_permissions',
  'drive.remove_permission',
  'drive.trash_file',
  'drive.untrash_file',
  'drive.delete_file',
  'docs.replace_document',
  'docs.append_content',
  'docs.replace_section',
  'docs.insert_section',
  'docs.delete_section',
  'docs.update_document',
  'docs.create_comment',
  'docs.reply_to_comment',
  'sheets.write_range',
  'sheets.append_rows',
  'sheets.clear_range',
  'sheets.format_cells',
  'sheets.add_sheet',
  'sheets.delete_sheet',
] as const;

export const CREATE_ACTIONS = [
  'drive.create_file',
  'drive.create_folder',
  'docs.create_document',
  'sheets.create_spreadsheet',
] as const;

// ─── Label Query Builder ────────────────────────────────────────────────────

/** Build a parenthesized OR filter clause for Drive API q parameter. */
export function buildLabelFilterClause(labelIds: string[]): string {
  if (labelIds.length === 0) return '';
  if (labelIds.length === 1) return `'labels/${labelIds[0]}' in labels`;
  const parts = labelIds.map((id) => `'labels/${id}' in labels`);
  return `(${parts.join(' OR ')})`;
}

// ─── Per-File Label Check ───────────────────────────────────────────────────

const DENIED: ActionResult = { success: false, error: 'File not found or access denied' };

/**
 * Check if a file has at least one of the required labels.
 * Returns null if the file passes, or an ActionResult error if denied.
 */
export async function checkFileLabel(
  fileId: string,
  token: string,
  config: DriveLabelsGuardConfig,
): Promise<ActionResult | null> {
  const labelIds = config.driveRequiredLabelIds;
  if (labelIds.length === 0) return DENIED; // enabled but no labels configured = deny all

  const params = new URLSearchParams({
    includeLabels: labelIds.join(','),
    fields: 'labelInfo',
    supportsAllDrives: 'true',
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      // API error — respect fail mode
      return config.driveLabelsFailMode === 'deny' ? DENIED : null;
    }

    const data = (await res.json()) as { labelInfo?: { labels?: unknown[] } };
    const labels = data.labelInfo?.labels ?? [];

    if (labels.length === 0) return DENIED;
    return null; // file has a required label — allow
  } catch {
    return config.driveLabelsFailMode === 'deny' ? DENIED : null;
  }
}

/**
 * Apply the first required label to a newly created file.
 * Returns true on success, false on failure.
 */
export async function applyLabel(
  fileId: string,
  token: string,
  labelId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/modifyLabels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          labelModifications: [{ labelId, fieldModifications: [] }],
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Delete a file (used to roll back a create when auto-labeling fails).
 */
export async function deleteFile(fileId: string, token: string): Promise<void> {
  try {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    // best-effort cleanup
  }
}

// ─── Guard Entrypoints ──────────────────────────────────────────────────────

export type GuardAction = 'list_search' | 'read_get' | 'write_modify' | 'create' | 'none';

export function classifyAction(actionId: string): GuardAction {
  if ((LIST_SEARCH_ACTIONS as readonly string[]).includes(actionId)) return 'list_search';
  if ((READ_GET_ACTIONS as readonly string[]).includes(actionId)) return 'read_get';
  if ((WRITE_MODIFY_ACTIONS as readonly string[]).includes(actionId)) return 'write_modify';
  if ((CREATE_ACTIONS as readonly string[]).includes(actionId)) return 'create';
  return 'none';
}

/**
 * Determine if the guard is active and return parsed config.
 * Returns null if the guard should be skipped (disabled).
 */
export function resolveGuard(ctx: ActionContext): DriveLabelsGuardConfig | null {
  return parseGuardConfig(ctx.guardConfig);
}
```

- [ ] **Step 4: Run the completeness test — expect PASS**

Run: `cd packages/plugin-google-workspace && npx vitest run src/actions/__tests__/labels-guard.test.ts`

Expected: PASS. If it fails, some action IDs are misclassified or missing — update the arrays.

- [ ] **Step 5: Integrate the guard into `actions.ts`**

Update the `executeAction` function in `actions.ts` to call the guard before dispatching:

```typescript
import {
  resolveGuard,
  classifyAction,
  checkFileLabel,
  applyLabel,
  deleteFile,
  buildLabelFilterClause,
} from './labels-guard.js';

async function executeAction(
  actionId: string,
  params: unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  const guard = resolveGuard(ctx);

  if (guard) {
    const classification = classifyAction(actionId);

    if (classification === 'list_search') {
      // Inject label filter into params — the sub-modules read this
      const labelFilter = buildLabelFilterClause(guard.driveRequiredLabelIds);
      if (!labelFilter) {
        // Guard enabled but no labels = deny all
        return { success: true, data: { files: [] } };
      }
      (params as Record<string, unknown>).__labelFilter = labelFilter;
    }

    if (classification === 'read_get' || classification === 'write_modify') {
      // Extract file ID from params (varies by action)
      const fileId = extractFileId(actionId, params as Record<string, unknown>);
      if (fileId) {
        const token = ctx.credentials.access_token || '';
        const denied = await checkFileLabel(fileId, token, guard);
        if (denied) return denied;
      }
    }
  }

  // Dispatch to sub-module
  let result: ActionResult;
  if (actionId.startsWith('drive.')) result = await executeDriveAction(actionId, params, ctx);
  else if (actionId.startsWith('docs.')) result = await executeDocsAction(actionId, params, ctx);
  else if (actionId.startsWith('sheets.')) result = await executeSheetsAction(actionId, params, ctx);
  else return { success: false, error: `Unknown action: ${actionId}` };

  // Post-execution: auto-label for create actions and copy
  if (guard && result.success) {
    const classification = classifyAction(actionId);
    const needsLabel = classification === 'create' || actionId === 'drive.copy_file';

    if (needsLabel && guard.driveRequiredLabelIds.length > 0) {
      const newFileId = extractCreatedFileId(actionId, result.data);
      if (newFileId) {
        const token = ctx.credentials.access_token || '';
        const labeled = await applyLabel(newFileId, token, guard.driveRequiredLabelIds[0]);
        if (!labeled) {
          // Roll back the create
          await deleteFile(newFileId, token);
          return {
            success: false,
            error: 'Failed to create file: could not apply required Drive label',
          };
        }
      }
    }
  }

  return result;
}

/** Extract file/document/spreadsheet ID from action params. */
function extractFileId(actionId: string, params: Record<string, unknown>): string | null {
  // Drive actions use fileId
  if (params.fileId) return params.fileId as string;
  // Docs actions use documentId
  if (params.documentId) return normalizeDocId(params.documentId as string);
  // Sheets actions use spreadsheetId
  if (params.spreadsheetId) return params.spreadsheetId as string;
  return null;
}

/** Extract the new file ID from a create action's result data. */
function extractCreatedFileId(actionId: string, data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return (d.id ?? d.documentId ?? d.spreadsheetId ?? null) as string | null;
}

/** Normalize a Google Docs URL to a bare document ID. */
function normalizeDocId(input: string): string {
  // Handle full URLs: https://docs.google.com/document/d/{id}/edit
  const match = input.match(/\/document\/d\/([^/]+)/);
  return match ? match[1] : input;
}
```

- [ ] **Step 6: Update list/search actions to read `__labelFilter`**

In `drive-actions.ts`, update the `drive.list_files` action handler to inject the filter:

```typescript
// After building queryParts array:
const labelFilter = (p as Record<string, unknown>).__labelFilter as string | undefined;
if (labelFilter) queryParts.push(labelFilter);
```

Do the same for `drive.search_files` and `docs.search_documents` (which were already refactored to use query-part arrays in Task 3).

- [ ] **Step 7: Run tests**

Run: `cd packages/plugin-google-workspace && npx vitest run`

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/plugin-google-workspace/src/actions/
git commit -m "feat(google-workspace): implement Drive Labels guard with completeness test"
```

---

## Task 10: Add Labels API Endpoint

**Files:**
- Modify: `packages/worker/src/routes/integrations.ts` (add new route)

- [ ] **Step 1: Add the labels endpoint**

In `packages/worker/src/routes/integrations.ts`, add a new GET route:

```typescript
integrationsRouter.get('/:service/labels', authMiddleware, async (c) => {
  const service = c.req.param('service');
  if (service !== 'google_workspace') {
    return c.json({ available: false, reason: 'Labels guard is only supported for Google Workspace' }, 400);
  }

  const user = c.get('user');
  const appDb = c.get('db');
  const env = c.env;

  // Resolve the user's Google Workspace credentials
  const credResult = await integrationRegistry.resolveCredentials(
    'google_workspace', env, user.id, {}
  );

  if (!credResult.credentials?.access_token) {
    return c.json({ available: false, reason: 'Google Workspace integration not connected' });
  }

  const token = credResult.credentials.access_token;

  try {
    const res = await fetch(
      'https://drivelabels.googleapis.com/v2/labels?view=LABEL_VIEW_FULL',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      return c.json({
        available: false,
        reason: 'Drive Labels API not available for this account type',
      });
    }

    const data = (await res.json()) as {
      labels?: Array<{ id: string; name: string; labelType: string; properties?: { title: string } }>;
    };

    const labels = (data.labels ?? []).map((l) => ({
      id: l.id,
      name: l.properties?.title ?? l.name ?? l.id,
      type: l.labelType ?? 'UNKNOWN',
    }));

    return c.json({ available: true, labels });
  } catch {
    return c.json({
      available: false,
      reason: 'Failed to fetch labels from Google Drive API',
    });
  }
});
```

Check how the existing routes in this file are structured and follow the same pattern. The route might need to be placed before any `/:service` catch-all routes.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/integrations.ts
git commit -m "feat: add GET /api/integrations/google_workspace/labels endpoint"
```

---

## Task 11: Add Admin Settings Route for Guard Config

**Files:**
- Modify: `packages/worker/src/routes/` (find the org settings route file, add guard fields)

- [ ] **Step 1: Find and extend the org settings update route**

Search for where org settings are updated via the API. Check `packages/worker/src/routes/org.ts` or the admin settings route. Add the three guard fields to the accepted update payload:

```typescript
driveLabelsGuardEnabled: z.boolean().optional(),
driveRequiredLabelIds: z.array(z.string()).optional(),
driveLabelsFailMode: z.enum(['deny', 'allow']).optional(),
```

If there is no existing org settings update route, create one:

```typescript
orgRouter.patch('/settings', adminMiddleware, async (c) => {
  const body = await c.req.json();
  // validate with zod schema
  const appDb = c.get('db');
  const updated = await updateOrgSettings(appDb, body);
  return c.json(updated);
});
```

Follow existing route patterns in the codebase.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/
git commit -m "feat: extend org settings route to accept Drive Labels guard config"
```

---

## Task 12: Add Admin Settings UI

**Files:**
- Modify: `packages/client/src/routes/settings/admin.tsx` (or create a new component)
- Create: `packages/client/src/api/drive-labels.ts` (query hook for labels endpoint)

- [ ] **Step 1: Create the API hook**

Create `packages/client/src/api/drive-labels.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

interface DriveLabel {
  id: string;
  name: string;
  type: string;
}

interface LabelsResponse {
  available: boolean;
  labels?: DriveLabel[];
  reason?: string;
}

export function useDriveLabels() {
  return useQuery({
    queryKey: ['integrations', 'google_workspace', 'labels'],
    queryFn: async (): Promise<LabelsResponse> => {
      const res = await apiClient('/api/integrations/google_workspace/labels');
      return res.json();
    },
  });
}
```

- [ ] **Step 2: Add the guard settings section to admin settings**

In the admin settings page (`packages/client/src/routes/settings/admin.tsx`), add a "Drive Labels Guard" section. Follow the existing patterns in this file for form sections. The section should include:

1. A toggle for `driveLabelsGuardEnabled`
2. When enabled, a multi-select populated from `useDriveLabels()` for label selection
3. A select for fail mode (`deny` / `allow`)
4. Appropriate disabled/loading states based on the labels query response
5. If `available: false`, show the reason text instead of the form

Check how existing settings sections handle state management and save. Follow the same pattern — likely uses the org settings mutation from `packages/client/src/api/org.ts` or similar.

- [ ] **Step 3: Test in the browser**

Run: `cd packages/client && pnpm dev`

Open the admin settings page and verify:
- The Drive Labels Guard section appears
- Toggle works
- Label picker loads (or shows disabled state if no Google Workspace connected)
- Save persists the settings

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/api/drive-labels.ts packages/client/src/routes/settings/admin.tsx
git commit -m "feat: admin settings UI for Drive Labels guard configuration"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`

- [ ] **Step 2: Run all tests**

Run: `pnpm test`

- [ ] **Step 3: Verify registry generation is clean**

Run: `make generate-registries && git diff --stat`

There should be no changes — registries should already be up to date.

- [ ] **Step 4: Verify no stale references to old service names**

Run: `grep -r "google_drive\|google_docs\|google_sheets\|plugin-google-drive\|plugin-google-docs\|plugin-google-sheets" packages/ --include="*.ts" --include="*.tsx" --include="*.json" -l`

Expected: no results (except possibly `action_invocations` related code that reads historical data, or migration files). Any other hits need fixing.

- [ ] **Step 5: Commit any final fixes**

If the grep found stale references, fix them and commit.
