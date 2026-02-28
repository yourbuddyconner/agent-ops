import type { IntegrationProvider } from '@agent-ops/sdk';

export const telegramProvider: IntegrationProvider = {
  service: 'telegram',
  displayName: 'Telegram',
  authType: 'bot_token',
};
