import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@agent-ops/shared';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isValidating: boolean;
  isHydrated: boolean;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setValidating: (validating: boolean) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isValidating: false,
      isHydrated: false,
      setAuth: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
          isValidating: false,
        }),
      clearAuth: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isValidating: false,
        }),
      setValidating: (validating) =>
        set({ isValidating: validating }),
      setHydrated: (hydrated) =>
        set({ isHydrated: hydrated }),
    }),
    {
      name: 'agent-ops-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        }
      },
    }
  )
);
