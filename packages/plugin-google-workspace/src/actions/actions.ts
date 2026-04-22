import type { ActionContext, ActionDefinition, ActionResult, ActionSource, IntegrationPackage } from '@valet/sdk/integrations';
import { googleWorkspaceProvider } from './provider.js';
import { driveActionDefs, executeDriveAction } from './drive-actions.js';
import { docsActionDefs, executeDocsAction } from './docs-actions.js';
import { sheetsActionDefs, executeSheetsAction } from './sheets-actions.js';
import {
  resolveGuard,
  classifyAction,
  buildLabelFilterClause,
  checkFileLabel,
  applyLabel,
  deleteFile,
  extractFileId,
  extractCreatedFileId,
} from './labels-guard.js';

const allActions: ActionDefinition[] = [
  ...driveActionDefs,
  ...docsActionDefs,
  ...sheetsActionDefs,
];

function dispatchAction(
  actionId: string,
  params: unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (actionId.startsWith('drive.')) return executeDriveAction(actionId, params, ctx);
  if (actionId.startsWith('docs.')) return executeDocsAction(actionId, params, ctx);
  if (actionId.startsWith('sheets.')) return executeSheetsAction(actionId, params, ctx);
  return Promise.resolve({ success: false, error: `Unknown action: ${actionId}` });
}

async function executeAction(
  actionId: string,
  params: unknown,
  ctx: ActionContext,
): Promise<ActionResult> {
  const guard = resolveGuard(ctx);
  if (!guard) return dispatchAction(actionId, params, ctx);

  const token = ctx.credentials.access_token || '';
  const category = classifyAction(actionId);
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

  // ── Pre-dispatch guards ──

  if (category === 'list_search') {
    // Inject label filter clause into params for search/list actions
    const clause = buildLabelFilterClause(guard.driveRequiredLabelIds);
    if (clause) {
      (p as Record<string, unknown>).__labelFilter = clause;
    }
    return dispatchAction(actionId, p, ctx);
  }

  if (category === 'read_get' || category === 'write_modify') {
    const fileId = extractFileId(actionId, p);
    if (fileId) {
      const denial = await checkFileLabel(fileId, token, guard);
      if (denial) return denial;
    }
    return dispatchAction(actionId, params, ctx);
  }

  // ── Dispatch for create actions (and unclassified) ──

  const result = await dispatchAction(actionId, params, ctx);

  // ── Post-dispatch: auto-label created files ──

  if (category === 'create' || actionId === 'drive.copy_file') {
    if (result.success && guard.driveRequiredLabelIds.length > 0) {
      const createdId = extractCreatedFileId(actionId, result);
      if (createdId) {
        const labeled = await applyLabel(createdId, token, guard.driveRequiredLabelIds[0]);
        if (!labeled) {
          // Roll back the created file
          await deleteFile(createdId, token);
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
