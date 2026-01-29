import { useMutation } from '@tanstack/react-query';
import { api } from './client';
import { useAuthStore } from '@/stores/auth';

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
