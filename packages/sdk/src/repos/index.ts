import type { ActionSource, TriggerSource } from '../integrations/index.js';

// ─── Repository Provider Contract ────────────────────────────────────────────

export interface RepoCredential {
  type: 'installation' | 'token';
  installationId?: string;
  accessToken?: string;
  expiresAt?: string;
  metadata?: Record<string, string>; // provider-specific config (e.g. appId, privateKey for GitHub App)
}

export interface SessionRepoEnv {
  envVars: Record<string, string>;
  gitConfig: Record<string, string>;
}

export interface RepoListItem {
  fullName: string;
  url: string;
  defaultBranch: string;
  private: boolean;
}

export interface RepoList {
  repos: RepoListItem[];
  hasMore: boolean;
}

export interface RepoValidation {
  accessible: boolean;
  permissions?: { push: boolean; pull: boolean; admin: boolean };
  error?: string;
}

export interface RepoProvider {
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  readonly supportsOrgLevel: boolean;
  readonly supportsPersonalLevel: boolean;
  readonly urlPatterns: RegExp[]; // patterns to match repo URLs (e.g. /github\.com/)

  listRepos(credential: RepoCredential, opts?: { page?: number; search?: string }): Promise<RepoList>;
  validateRepo(credential: RepoCredential, repoUrl: string): Promise<RepoValidation>;
  assembleSessionEnv(
    credential: RepoCredential,
    opts: {
      repoUrl: string;
      branch?: string;
      ref?: string;
      gitUser: { name: string; email: string };
    },
  ): Promise<SessionRepoEnv>;
  mintToken(credential: RepoCredential): Promise<{ accessToken: string; expiresAt?: string }>;

  getActionSource?(credential: RepoCredential): ActionSource;
  getTriggerSource?(): TriggerSource;
}

export interface RepoProviderPackage {
  provider: RepoProvider;
}
