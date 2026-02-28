import type { IntegrationProvider } from '@agent-ops/sdk';

export const slackProvider: IntegrationProvider = {
  service: 'slack',
  displayName: 'Slack',
  authType: 'oauth2',
};
