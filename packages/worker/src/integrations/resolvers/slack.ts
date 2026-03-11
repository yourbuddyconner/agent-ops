import { getSlackBotToken } from '../../services/slack.js';
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
  // Always try org-level bot token first — Slack uses a single org-wide bot token
  // regardless of whether the integration row is user-scoped or org-scoped
  const botToken = await getSlackBotToken(env);
  if (botToken) {
    return {
      ok: true,
      credential: {
        accessToken: botToken,
        credentialType: 'bot_token',
        refreshed: false,
      },
    };
  }

  return {
    ok: false,
    error: {
      service,
      reason: 'not_found',
      message: 'No Slack bot token found. Install Slack in Settings.',
    },
  };
};
