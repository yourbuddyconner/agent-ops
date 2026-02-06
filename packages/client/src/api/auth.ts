import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useAuthStore } from '@/stores/auth';
import type { User } from '@agent-ops/shared';

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
    mutationFn: async (data: { name?: string; gitName?: string; gitEmail?: string; onboardingCompleted?: boolean; idleTimeoutSeconds?: number; modelPreferences?: string[] }) => {
      return api.patch<{ user: User }>('/auth/me', data);
    },
    onSuccess: (res) => {
      // Update the auth store with the new user data
      const state = useAuthStore.getState();
      if (state.token && res.user) {
        state.setAuth(state.token, res.user);
      }
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
