import type { IntegrationPackage } from '@valet/sdk';
import { googleWorkspaceProvider } from './provider.js';
import { googleWorkspaceActions } from './actions.js';

export { googleWorkspaceProvider } from './provider.js';
export { googleWorkspaceActions } from './actions.js';

export const googleWorkspacePackage: IntegrationPackage = {
  name: '@valet/plugin-google-workspace',
  version: '0.0.1',
  service: 'google_workspace',
  provider: googleWorkspaceProvider,
  actions: googleWorkspaceActions,
};

export default googleWorkspacePackage;
