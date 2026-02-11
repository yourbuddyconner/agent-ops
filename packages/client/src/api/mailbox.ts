import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { MailboxMessage } from './types';

export const mailboxKeys = {
  all: ['notifications'] as const,
  session: (sessionId: string) => [...mailboxKeys.all, 'session', sessionId] as const,
};

export function useSessionNotifications(
  sessionId: string,
  opts?: { unreadOnly?: boolean; limit?: number }
) {
  return useQuery({
    queryKey: mailboxKeys.session(sessionId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.unreadOnly) params.set('unreadOnly', 'true');
      if (opts?.limit) params.set('limit', String(opts.limit));
      const qs = params.toString();
      return api.get<{ messages: MailboxMessage[] }>(
        `/sessions/${sessionId}/notifications${qs ? `?${qs}` : ''}`
      );
    },
    select: (data) => data.messages,
    enabled: !!sessionId,
    staleTime: 15_000,
  });
}

export function useEmitNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      fromSessionId?: string;
      fromUserId?: string;
      toSessionId?: string;
      toUserId?: string;
      toHandle?: string;
      messageType?: string;
      content: string;
      contextSessionId?: string;
      contextTaskId?: string;
      replyToId?: string;
    }) => api.post<{ notification: MailboxMessage }>('/notifications/emit', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mailboxKeys.all });
    },
  });
}

export function useMarkNotificationsRead(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.put<{ success: boolean; count: number }>(
        `/sessions/${sessionId}/notifications/read`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mailboxKeys.session(sessionId) });
    },
  });
}
