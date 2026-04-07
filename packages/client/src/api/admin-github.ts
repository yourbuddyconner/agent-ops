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

// PUT /api/admin/github/oauth
export function useSetGitHubOAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      api.put<{ success: boolean }>('/admin/github/oauth', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// PUT /api/admin/github/app
export function useSetGitHubApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { appId: string; appPrivateKey: string; appSlug?: string; appWebhookSecret?: string }) =>
      api.put<{ success: boolean }>('/admin/github/app', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// DELETE /api/admin/github/oauth
export function useDeleteGitHubOAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ success: boolean }>('/admin/github/oauth'),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// DELETE /api/admin/github/app
export function useDeleteGitHubApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ success: boolean }>('/admin/github/app'),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}

// POST /api/admin/github/app/verify
export function useVerifyGitHubApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; installationId: string; accessibleOwners: string[]; repositoryCount: number }>('/admin/github/app/verify'),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminGitHubKeys.config }),
  });
}
