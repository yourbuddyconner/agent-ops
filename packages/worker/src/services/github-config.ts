import type { AppDb } from '../lib/drizzle.js';
import type { Env } from '../env.js';
import { getServiceConfig, getServiceMetadata } from '../lib/db/service-configs.js';

export interface GitHubServiceConfig {
  oauthClientId: string;
  oauthClientSecret: string;
  appId?: string;
  appPrivateKey?: string;
  appSlug?: string;
  appWebhookSecret?: string;
}

export interface GitHubServiceMetadata {
  appInstallationId?: string;
  accessibleOwners?: string[];
  accessibleOwnersRefreshedAt?: string;
}

export interface GitHubConfig {
  oauthClientId: string;
  oauthClientSecret: string;
  appId?: string;
  appPrivateKey?: string;
  appSlug?: string;
  appWebhookSecret?: string;
  appInstallationId?: string;
  appAccessibleOwners?: string[];
}

/**
 * Resolve GitHub config from D1 first, fall back to env vars.
 */
export async function getGitHubConfig(env: Env, db: AppDb): Promise<GitHubConfig | null> {
  // Try D1 first
  const svc = await getServiceConfig<GitHubServiceConfig, GitHubServiceMetadata>(
    db, env.ENCRYPTION_KEY, 'github',
  );

  if (svc) {
    return {
      oauthClientId: svc.config.oauthClientId,
      oauthClientSecret: svc.config.oauthClientSecret,
      appId: svc.config.appId,
      appPrivateKey: svc.config.appPrivateKey,
      appSlug: svc.config.appSlug,
      appWebhookSecret: svc.config.appWebhookSecret,
      appInstallationId: svc.metadata.appInstallationId,
      appAccessibleOwners: svc.metadata.accessibleOwners,
    };
  }

  // Fall back to env vars
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;

  return {
    oauthClientId: env.GITHUB_CLIENT_ID,
    oauthClientSecret: env.GITHUB_CLIENT_SECRET,
    appId: env.GITHUB_APP_ID,
    appPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    appSlug: env.GITHUB_APP_SLUG,
    appWebhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
  };
}

/**
 * Get just the GitHub metadata (accessible owners) without decrypting secrets.
 */
export async function getGitHubMetadata(db: AppDb): Promise<GitHubServiceMetadata | null> {
  return getServiceMetadata<GitHubServiceMetadata>(db, 'github');
}
