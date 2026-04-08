import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ─── Query Keys ─────────────────────────────────────────────────────────

export const adminGitHubKeys = {
  config: ['admin', 'github'] as const,
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface AdminGitHubConfig {
  source: 'database' | 'env' | 'none';
  oauth: {
    configured: boolean;
    clientId?: string;
    viaApp?: boolean;
  } | null;
  app: {
    configured: boolean;
    appId?: string;
    appSlug?: string;
    appName?: string;
    appOwner?: string;
    appOwnerType?: string;
    installationId?: string;
    accessibleOwners?: string[];
    accessibleOwnersRefreshedAt?: string;
    repositoryCount?: number;
  } | null;
  configuredBy?: string;
  updatedAt?: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────

// GET /api/admin/github
export function useAdminGitHubConfig() {
  return useQuery({
    queryKey: adminGitHubKeys.config,
    queryFn: () => api.get<AdminGitHubConfig>('/admin/github'),
    staleTime: 60_000,
  });
}

// POST /api/admin/github/app/manifest
export function useCreateGitHubAppManifest() {
  return useMutation({
    mutationFn: (data: { githubOrg: string }) =>
      api.post<{ url: string; manifest: Record<string, unknown> }>('/admin/github/app/manifest', data),
  });
}

// POST /api/admin/github/app/refresh
export function useRefreshGitHubApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ installationId: string; accessibleOwners: string[]; repositoryCount: number }>('/admin/github/app/refresh'),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// PUT /api/admin/github/oauth
export function useSetGitHubOAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      api.put<{ success: boolean }>('/admin/github/oauth', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// DELETE /api/admin/github/oauth (also deletes app config)
export function useDeleteGitHubConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ success: boolean }>('/admin/github/oauth'),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}
