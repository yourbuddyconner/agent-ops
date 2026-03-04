import type { IntegrationPackage } from '@agent-ops/sdk';
import { googleDriveProvider } from './provider.js';
import { googleDriveActions } from './actions.js';

export { googleDriveProvider } from './provider.js';
export { googleDriveActions } from './actions.js';
export { driveFetch, driveUploadFetch, buildMultipartBody } from './api.js';

const googleDrivePackage: IntegrationPackage = {
  name: '@agent-ops/actions-google-drive',
  version: '0.0.1',
  service: 'google_drive',
  provider: googleDriveProvider,
  actions: googleDriveActions,
};

export default googleDrivePackage;
