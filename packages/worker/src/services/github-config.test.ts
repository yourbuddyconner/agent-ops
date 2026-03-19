import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../env.js';

// Mock the DB layer
vi.mock('../lib/db/service-configs.js', () => ({
  getServiceConfig: vi.fn(),
  getServiceMetadata: vi.fn(),
}));

import { getServiceConfig, getServiceMetadata } from '../lib/db/service-configs.js';
import { getGitHubConfig, getGitHubMetadata } from './github-config.js';

const mockGetServiceConfig = getServiceConfig as ReturnType<typeof vi.fn>;
const mockGetServiceMetadata = getServiceMetadata as ReturnType<typeof vi.fn>;

const fakeDb = { __drizzle: true } as any;

const baseEnv = {
  ENCRYPTION_KEY: 'test-key',
  GITHUB_CLIENT_ID: 'env-client-id',
  GITHUB_CLIENT_SECRET: 'env-client-secret',
  GITHUB_APP_ID: 'env-app-id',
  GITHUB_APP_PRIVATE_KEY: 'env-private-key',
  GITHUB_APP_SLUG: 'env-slug',
  GITHUB_APP_WEBHOOK_SECRET: 'env-webhook-secret',
} as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGitHubConfig', () => {
  it('returns null when no D1 config and no env vars', async () => {
    mockGetServiceConfig.mockResolvedValue(null);

    const env = {
      ENCRYPTION_KEY: 'test-key',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
    } as unknown as Env;

    const result = await getGitHubConfig(env, fakeDb);

    expect(result).toBeNull();
    expect(mockGetServiceConfig).toHaveBeenCalledWith(fakeDb, 'test-key', 'github');
  });

  it('returns env var config when no D1 config exists', async () => {
    mockGetServiceConfig.mockResolvedValue(null);

    const result = await getGitHubConfig(baseEnv, fakeDb);

    expect(result).toEqual({
      oauthClientId: 'env-client-id',
      oauthClientSecret: 'env-client-secret',
      appId: 'env-app-id',
      appPrivateKey: 'env-private-key',
      appSlug: 'env-slug',
      appWebhookSecret: 'env-webhook-secret',
    });
  });

  it('returns D1 config when it exists (D1 takes priority)', async () => {
    mockGetServiceConfig.mockResolvedValue({
      config: {
        oauthClientId: 'd1-client-id',
        oauthClientSecret: 'd1-client-secret',
        appId: 'd1-app-id',
        appPrivateKey: 'd1-private-key',
        appSlug: 'd1-slug',
        appWebhookSecret: 'd1-webhook-secret',
      },
      metadata: {},
      configuredBy: 'admin',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await getGitHubConfig(baseEnv, fakeDb);

    expect(result).toEqual({
      oauthClientId: 'd1-client-id',
      oauthClientSecret: 'd1-client-secret',
      appId: 'd1-app-id',
      appPrivateKey: 'd1-private-key',
      appSlug: 'd1-slug',
      appWebhookSecret: 'd1-webhook-secret',
      appInstallationId: undefined,
      appAccessibleOwners: undefined,
    });
  });

  it('D1 config includes metadata fields', async () => {
    mockGetServiceConfig.mockResolvedValue({
      config: {
        oauthClientId: 'd1-client-id',
        oauthClientSecret: 'd1-client-secret',
      },
      metadata: {
        appInstallationId: 'inst-12345',
        accessibleOwners: ['my-org', 'my-user'],
      },
      configuredBy: 'admin',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await getGitHubConfig(baseEnv, fakeDb);

    expect(result).not.toBeNull();
    expect(result!.appInstallationId).toBe('inst-12345');
    expect(result!.appAccessibleOwners).toEqual(['my-org', 'my-user']);
  });
});

describe('getGitHubMetadata', () => {
  it('returns metadata without decrypting', async () => {
    mockGetServiceMetadata.mockResolvedValue({
      appInstallationId: 'inst-99',
      accessibleOwners: ['org-a'],
      accessibleOwnersRefreshedAt: '2026-03-01T00:00:00Z',
    });

    const result = await getGitHubMetadata(fakeDb);

    expect(result).toEqual({
      appInstallationId: 'inst-99',
      accessibleOwners: ['org-a'],
      accessibleOwnersRefreshedAt: '2026-03-01T00:00:00Z',
    });
    expect(mockGetServiceMetadata).toHaveBeenCalledWith(fakeDb, 'github');
    // getServiceConfig should NOT have been called
    expect(mockGetServiceConfig).not.toHaveBeenCalled();
  });

  it('returns null when no metadata exists', async () => {
    mockGetServiceMetadata.mockResolvedValue(null);

    const result = await getGitHubMetadata(fakeDb);

    expect(result).toBeNull();
  });
});
