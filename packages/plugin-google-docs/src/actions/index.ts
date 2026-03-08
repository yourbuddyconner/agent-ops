import type { IntegrationPackage } from '@valet/sdk';
import { googleDocsProvider } from './provider.js';
import { googleDocsActions } from './actions.js';

export { googleDocsProvider } from './provider.js';
export { googleDocsActions } from './actions.js';
export { docsFetch, driveFetch } from './api.js';

const googleDocsPackage: IntegrationPackage = {
  name: '@valet/actions-google-docs',
  version: '0.0.1',
  service: 'google_docs',
  provider: googleDocsProvider,
  actions: googleDocsActions,
};

export default googleDocsPackage;
