import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface APIKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface APIKeyWithToken extends APIKey {
  token: string;
}

interface ListAPIKeysResponse {
  keys: APIKey[];
}

interface CreateAPIKeyRequest {
  name: string;
  expiresInDays?: number;
}

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  lists: () => [...apiKeyKeys.all, 'list'] as const,
  list: () => [...apiKeyKeys.lists()] as const,
};

export function useAPIKeys() {
  return useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: () => api.get<ListAPIKeysResponse>('/api-keys'),
  });
}

export function useCreateAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAPIKeyRequest) =>
      api.post<APIKeyWithToken>('/api-keys', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}

export function useRevokeAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}
