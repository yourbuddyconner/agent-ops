import { useMutation } from '@tanstack/react-query';
import { api } from './client';
import type { User } from './types';
import { useAuthStore } from '@/stores/auth';

interface ValidateTokenResponse {
  user: User;
}

export function useValidateToken() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const setValidating = useAuthStore((s) => s.setValidating);

  return useMutation({
    mutationFn: async (token: string) => {
      // Temporarily set token for the validation request
      const originalToken = useAuthStore.getState().token;
      useAuthStore.setState({ token });

      try {
        // Use sessions endpoint to validate - a valid token should return successfully
        const response = await api.get<ValidateTokenResponse>('/auth/me');
        return { token, user: response.user };
      } catch (error) {
        // Restore original token on failure
        useAuthStore.setState({ token: originalToken });
        throw error;
      }
    },
    onMutate: () => {
      setValidating(true);
    },
    onSuccess: ({ token, user }) => {
      setAuth(token, user);
      setValidating(false);
    },
    onError: () => {
      setValidating(false);
    },
  });
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);

  return {
    logout: () => {
      clearAuth();
    },
  };
}
