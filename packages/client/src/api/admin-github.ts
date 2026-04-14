import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ─── Query Keys ─────────────────────────────────────────────────────────

export const adminGitHubKeys = {
  config: () => ['admin-github', 'config'] as const,
  installations: () => ['admin-github', 'installations'] as const,
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface GithubInstallation {
  id: string;
  githubInstallationId: string;
  accountLogin: string;
  accountId: string;
  accountType: 'Organization' | 'User';
  linkedUserId: string | null;
  status: string;
  repositorySelection: string;
  permissions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGitHubConfig {
  appStatus: 'not_configured' | 'configured';
  app: {
    appId: string;
    appSlug: string;
    appOwner: string;
    appOwnerType: string;
    appName: string;
  } | null;
  settings: {
    allowPersonalInstallations: boolean;
    allowAnonymousGitHubAccess: boolean;
  };
  installations: {
    organizations: GithubInstallation[];
    personal: GithubInstallation[];
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────────

// GET /api/admin/github
export function useAdminGitHubConfig() {
  return useQuery({
    queryKey: adminGitHubKeys.config(),
    queryFn: () => api.get<AdminGitHubConfig>('/admin/github'),
    staleTime: 60_000,
  });
}

// POST /api/admin/github/app/manifest
export function useCreateGitHubAppManifest() {
  return useMutation({
    mutationFn: (data: {
      githubOrg: string;
      permissions?: Record<string, string>;
      events?: string[];
    }) =>
      api.post<{ url: string; manifest: Record<string, unknown> }>('/admin/github/app/manifest', data),
  });
}

// POST /api/admin/github/app/refresh
export function useRefreshGitHubApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ refreshed: true; installationCount: number }>('/admin/github/app/refresh'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminGitHubKeys.config() });
      qc.invalidateQueries({ queryKey: adminGitHubKeys.installations() });
    },
  });
}

// PUT /api/admin/github/settings
export function useUpdateGitHubSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: { allowPersonalInstallations?: boolean; allowAnonymousGitHubAccess?: boolean }) =>
      api.put<{ success: boolean }>('/admin/github/settings', settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminGitHubKeys.config() });
    },
  });
}

// GET /api/admin/github/installations
export function useGitHubInstallations() {
  return useQuery({
    queryKey: adminGitHubKeys.installations(),
    queryFn: () =>
      api.get<{ organizations: GithubInstallation[]; personal: GithubInstallation[] }>('/admin/github/installations'),
  });
}

// DELETE /api/admin/github (danger zone — removes entire GitHub App config)
export function useDeleteGitHubConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ success: boolean }>('/admin/github'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminGitHubKeys.config() });
      qc.invalidateQueries({ queryKey: adminGitHubKeys.installations() });
    },
  });
}
