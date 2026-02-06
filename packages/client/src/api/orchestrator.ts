import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { OrchestratorIdentity, OrchestratorMemory, AgentSession } from './types';

export const orchestratorKeys = {
  all: ['orchestrator'] as const,
  info: () => [...orchestratorKeys.all, 'info'] as const,
  identity: () => [...orchestratorKeys.all, 'identity'] as const,
  checkHandle: (handle: string) => [...orchestratorKeys.all, 'check-handle', handle] as const,
  memories: (filters?: { category?: string }) => [...orchestratorKeys.all, 'memories', filters] as const,
};

export function useOrchestratorInfo() {
  return useQuery({
    queryKey: orchestratorKeys.info(),
    queryFn: () =>
      api.get<{
        sessionId: string;
        identity: OrchestratorIdentity | null;
        session: AgentSession | null;
        exists: boolean;
        needsRestart: boolean;
      }>('/me/orchestrator'),
    staleTime: 30_000,
  });
}

export function useCreateOrchestrator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      handle: string;
      avatar?: string;
      customInstructions?: string;
    }) =>
      api.post<{
        sessionId: string;
        identity: OrchestratorIdentity;
        session: AgentSession;
      }>('/me/orchestrator', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.all });
    },
  });
}

export function useCheckHandle(handle: string) {
  return useQuery({
    queryKey: orchestratorKeys.checkHandle(handle),
    queryFn: () =>
      api.get<{ available: boolean; handle: string }>(
        `/me/orchestrator/check-handle?handle=${encodeURIComponent(handle)}`
      ),
    enabled: handle.length >= 2,
    staleTime: 10_000,
  });
}

export function useOrchestratorIdentity() {
  return useQuery({
    queryKey: orchestratorKeys.identity(),
    queryFn: () =>
      api.get<{ identity: OrchestratorIdentity }>('/me/orchestrator/identity'),
    staleTime: 60_000,
  });
}

export function useUpdateOrchestratorIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name?: string;
      handle?: string;
      avatar?: string;
      customInstructions?: string;
    }) =>
      api.put<{ identity: OrchestratorIdentity }>(
        '/me/orchestrator/identity',
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.all });
    },
  });
}

export function useOrchestratorMemories(category?: string) {
  return useQuery({
    queryKey: orchestratorKeys.memories({ category }),
    queryFn: () => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      const qs = params.toString();
      return api.get<{ memories: OrchestratorMemory[] }>(
        `/me/memories${qs ? `?${qs}` : ''}`
      );
    },
    select: (data) => data.memories,
    staleTime: 30_000,
  });
}

export function useCreateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { content: string; category: string }) =>
      api.post<{ memory: OrchestratorMemory }>('/me/memories', data),
    onSuccess: () => {
      // Use prefix key to invalidate all memory queries regardless of category filter
      queryClient.invalidateQueries({
        queryKey: [...orchestratorKeys.all, 'memories'],
      });
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/me/memories/${id}`),
    onSuccess: () => {
      // Use prefix key to invalidate all memory queries regardless of category filter
      queryClient.invalidateQueries({
        queryKey: [...orchestratorKeys.all, 'memories'],
      });
    },
  });
}
