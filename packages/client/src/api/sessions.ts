import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  AgentSession,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
} from './types';

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionKeys.all, 'list'] as const,
  list: (filters?: { cursor?: string }) =>
    [...sessionKeys.lists(), filters] as const,
  infinite: () => [...sessionKeys.all, 'infinite'] as const,
  details: () => [...sessionKeys.all, 'detail'] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
};

export function useSessions(cursor?: string) {
  return useQuery({
    queryKey: sessionKeys.list({ cursor }),
    queryFn: () =>
      api.get<ListSessionsResponse>(
        `/sessions${cursor ? `?cursor=${cursor}` : ''}`
      ),
  });
}

export function useInfiniteSessions() {
  return useInfiniteQuery({
    queryKey: sessionKeys.infinite(),
    queryFn: ({ pageParam }) =>
      api.get<ListSessionsResponse>(
        `/sessions${pageParam ? `?cursor=${pageParam}` : ''}`
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    select: (data) => ({
      sessions: data.pages.flatMap((page) => page.sessions),
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
  });
}

interface SessionDetailResponse {
  session: AgentSession;
  doStatus: Record<string, unknown>;
}

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => api.get<SessionDetailResponse>(`/sessions/${sessionId}`),
    enabled: !!sessionId,
    select: (data) => data.session,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSessionRequest) =>
      api.post<CreateSessionResponse>('/sessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete<void>(`/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}

export function useSessionToken(sessionId: string) {
  return useQuery({
    queryKey: [...sessionKeys.detail(sessionId), 'token'] as const,
    queryFn: () =>
      api.get<{ token: string; tunnelUrls: Record<string, string>; expiresAt: string }>(
        `/sessions/${sessionId}/sandbox-token`
      ),
    enabled: !!sessionId,
    staleTime: 10 * 60 * 1000, // Refetch after 10 min (token lasts 15 min)
    refetchInterval: 10 * 60 * 1000,
  });
}

export function useTerminateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<void>(`/sessions/${sessionId}/terminate`),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    },
  });
}
