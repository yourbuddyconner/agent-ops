import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api, ApiError } from './client';
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
    refetchInterval: 10_000,
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
    refetchInterval: 15_000,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSessionRequest) =>
      api.post<CreateSessionResponse>('/sessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    },
  });
}

export function useBulkDeleteSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionIds: string[]) =>
      api.post<{ deleted: number; errors: { sessionId: string; error: string }[] }>(
        '/sessions/bulk-delete',
        { sessionIds }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete<void>(`/sessions/${sessionId}`),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    },
  });
}

export function useSessionToken(sessionId: string) {
  const { data: session } = useSession(sessionId);
  const isStarting = !session || session.status === 'initializing';

  return useQuery({
    queryKey: [...sessionKeys.detail(sessionId), 'token'] as const,
    queryFn: () =>
      api.get<{ token: string; tunnelUrls: Record<string, string>; expiresAt: string }>(
        `/sessions/${sessionId}/sandbox-token`
      ),
    enabled: !!sessionId,
    staleTime: 10 * 60 * 1000,
    refetchInterval: (query) => {
      // If we already have data, refresh every 10 min (token lasts 15)
      if (query.state.data) return 10 * 60 * 1000;
      // During startup or if last fetch failed, poll every 3s
      if (query.state.status === 'error' || isStarting) return 3_000;
      // Default steady state
      return 10 * 60 * 1000;
    },
    retry: (failureCount, error) => {
      // Don't retry 401/403 (auth issues)
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
      // Retry 503 (sandbox not ready) up to 20 times
      if (error instanceof ApiError && error.status === 503) return failureCount < 20;
      // Default: retry once for other errors
      return failureCount < 1;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
  });
}

export function useHibernateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ status: string; message: string }>(`/sessions/${sessionId}/hibernate`),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    },
  });
}

export function useWakeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ status: string; message: string }>(`/sessions/${sessionId}/wake`),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });
}

export function useTerminateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete<void>(`/sessions/${sessionId}`),
    onMutate: async (sessionId) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: sessionKeys.detail(sessionId) });
      await queryClient.cancelQueries({ queryKey: sessionKeys.infinite() });

      // Optimistically update session detail cache
      const previousDetail = queryClient.getQueryData(sessionKeys.detail(sessionId));
      queryClient.setQueryData(
        sessionKeys.detail(sessionId),
        (old: SessionDetailResponse | undefined) => {
          if (!old) return old;
          return { ...old, session: { ...old.session, status: 'terminated' } };
        }
      );

      return { previousDetail };
    },
    onError: (_err, sessionId, context) => {
      // Roll back optimistic update on error
      if (context?.previousDetail) {
        queryClient.setQueryData(sessionKeys.detail(sessionId), context.previousDetail);
      }
    },
    onSettled: (_, __, sessionId) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    },
  });
}
