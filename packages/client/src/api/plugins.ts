import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const pluginKeys = {
  all: ['plugins'] as const,
  list: () => [...pluginKeys.all, 'list'] as const,
  detail: (id: string) => [...pluginKeys.all, 'detail', id] as const,
  settings: () => [...pluginKeys.all, 'settings'] as const,
};

interface PluginRecord {
  id: string;
  orgId: string;
  name: string;
  version: string;
  description: string | null;
  icon: string | null;
  source: string;
  capabilities: string[];
  status: string;
  installedBy: string;
  installedAt: string;
  updatedAt: string;
}

interface PluginSettings {
  allowRepoContent: boolean;
}

export function usePlugins() {
  return useQuery({
    queryKey: pluginKeys.list(),
    queryFn: () => api.get<{ plugins: PluginRecord[] }>('/plugins').then(r => r.plugins),
  });
}

export function usePluginSettings() {
  return useQuery({
    queryKey: pluginKeys.settings(),
    queryFn: () => api.get<{ settings: PluginSettings }>('/plugins/settings').then(r => r.settings),
  });
}

export function useUpdatePluginStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      api.put<{ ok: boolean }>(`/plugins/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
    },
  });
}

export function useSyncPlugins() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/plugins/sync'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
    },
  });
}

export function useUpdatePluginSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<PluginSettings>) =>
      api.put<{ ok: boolean }>('/plugins/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.settings() });
    },
  });
}
