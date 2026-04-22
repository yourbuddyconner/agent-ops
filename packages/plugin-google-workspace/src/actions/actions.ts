import type { ActionContext, ActionDefinition, ActionResult, ActionSource, IntegrationPackage } from '@valet/sdk/integrations';
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
