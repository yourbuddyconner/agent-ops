import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useAuthStore } from '@/stores/auth';
import type { QueueMode, User, UserCredential } from '@valet/shared';

// --- Auth Provider Discovery (unauthenticated, hits /auth not /api) ---

export interface AuthProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  brandColor?: string;
  protocol: 'oauth2' | 'oidc' | 'saml' | 'credentials';
}

function getWorkerBaseUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return apiUrl.replace(/\/api$/, '');
  }
  return 'http://localhost:8787';
}

export async function fetchAuthProviders(): Promise<AuthProviderInfo[]> {
  const res = await fetch(`${getWorkerBaseUrl()}/auth/providers`);
  if (!res.ok) throw new Error('Failed to fetch auth providers');
  return res.json();
}

export const authKeys = {
  providers: ['auth', 'providers'] as const,
  credentials: () => ['auth', 'credentials'] as const,
};

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);

  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSettled: () => {
      clearAuth();
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name?: string; gitName?: string; gitEmail?: string; onboardingCompleted?: boolean; idleTimeoutSeconds?: number; sandboxCpuCores?: number; sandboxMemoryMib?: number; modelPreferences?: string[]; uiQueueMode?: QueueMode; timezone?: string }) => {
      return api.patch<{ user: User }>('/auth/me', data);
    },
    onSuccess: (res) => {
      // Update the auth store with the new user data (preserve orgModelPreferences)
      const state = useAuthStore.getState();
      if (state.token && res.user) {
        state.setAuth(state.token, res.user, state.orgModelPreferences);
      }
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

// --- User Credentials ---

export function useUserCredentials() {
  return useQuery({
    queryKey: authKeys.credentials(),
    queryFn: () => api.get<UserCredential[]>('/auth/me/credentials'),
  });
}

export function useSetUserCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      api.put<{ ok: boolean }>(`/auth/me/credentials/${provider}`, { key }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.credentials() });
    },
  });
}

export function useDeleteUserCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: string) =>
      api.delete<{ ok: boolean }>(`/auth/me/credentials/${provider}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.credentials() });
    },
  });
}
