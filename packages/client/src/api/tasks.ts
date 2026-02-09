import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { SessionTask } from './types';

export const taskKeys = {
  all: ['tasks'] as const,
  session: (sessionId: string) => [...taskKeys.all, 'session', sessionId] as const,
  myTasks: (sessionId: string) => [...taskKeys.all, 'my', sessionId] as const,
};

export function useSessionTasks(sessionId: string, opts?: { status?: string }) {
  return useQuery({
    queryKey: taskKeys.session(sessionId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      const qs = params.toString();
      return api.get<{ tasks: SessionTask[] }>(
        `/sessions/${sessionId}/tasks${qs ? `?${qs}` : ''}`
      );
    },
    select: (data) => data.tasks,
    enabled: !!sessionId,
    staleTime: 15_000,
  });
}

export function useMyTasks(sessionId: string, opts?: { status?: string }) {
  return useQuery({
    queryKey: taskKeys.myTasks(sessionId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      const qs = params.toString();
      return api.get<{ tasks: SessionTask[] }>(
        `/sessions/${sessionId}/my-tasks${qs ? `?${qs}` : ''}`
      );
    },
    select: (data) => data.tasks,
    enabled: !!sessionId,
    staleTime: 15_000,
  });
}

export function useCreateTask(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      sessionId?: string;
      parentTaskId?: string;
      blockedBy?: string[];
    }) =>
      api.post<{ task: SessionTask }>(`/sessions/${sessionId}/tasks`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTask(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      taskId: string;
      status?: string;
      result?: string;
      description?: string;
      sessionId?: string;
      title?: string;
    }) => {
      const { taskId, ...updates } = data;
      return api.put<{ task: SessionTask }>(
        `/sessions/${sessionId}/tasks/${taskId}`,
        updates
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
