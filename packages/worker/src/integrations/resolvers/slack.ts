import { getSlackBotToken } from '../../services/slack.js';
import { getCredential } from '../../services/credentials.js';
import type { CredentialResolver } from '../registry.js';

/**
 * Slack credential resolver.
 * Org-scoped: uses the org-level bot token from org_slack_installs.
 * User-scoped: falls back to per-user credentials (standard OAuth).
 */
export const slackCredentialResolver: CredentialResolver = async (
  service,
  env,
  userId,
  scope,
  options,
) => {
  if (scope === 'org') {
    const botToken = await getSlackBotToken(env);
    if (!botToken) {
      return {
        ok: false,
        error: {
          service,
          reason: 'not_found',
          message: 'No Slack bot token found. Reinstall in Settings.',
        },
      };
    }
    return {
      ok: true,
      credential: {
        accessToken: botToken,
        credentialType: 'bot_token',
        refreshed: false,
      },
    };
  }

  return getCredential(env, userId, service, options);
};
