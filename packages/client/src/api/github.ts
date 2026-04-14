import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { GithubInstallation } from './admin-github';

// ─── Query Keys ─────────────────────────────────────────────────────────

export const githubKeys = {
  status: ['me', 'github'] as const,
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface GitHubUserStatus {
  configured: boolean;
  appSlug: string | null;
  settings: {
    allowPersonalInstallations: boolean;
    allowAnonymousGitHubAccess: boolean;
  };
  personal: {
    linked: boolean;
    githubUsername: string | null;
    githubId: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  installations: GithubInstallation[];
}

// ─── Hooks ──────────────────────────────────────────────────────────────

export function useGitHubStatus() {
  return useQuery({
    queryKey: githubKeys.status,
    queryFn: () => api.get<GitHubUserStatus>('/me/github'),
    staleTime: 30_000,
  });
}

export function useGitHubLink() {
  return useMutation({
    mutationFn: (data?: { scopes?: string[] }) =>
      api.post<{ redirectUrl: string }>('/me/github/link', data || {}),
    onSuccess: (data) => {
      window.location.href = data.redirectUrl;
    },
  });
}

export function useGitHubDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ success: boolean }>('/me/github/link'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: githubKeys.status });
    },
  });
}
