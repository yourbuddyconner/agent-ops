import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';

// Types
export interface Execution {
  id: string;
  workflowId: string;
  workflowName: string | null;
  triggerId: string | null;
  triggerName?: string | null;
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed';
  triggerType: 'webhook' | 'schedule' | 'manual';
  triggerMetadata: Record<string, unknown> | null;
  variables: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  steps: ExecutionStep[] | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ExecutionStep {
  stepId: string;
  status: string;
  output?: unknown;
  error?: string;
}

export interface ListExecutionsResponse {
  executions: Execution[];
}

export interface GetExecutionResponse {
  execution: Execution;
}

export interface CompleteExecutionRequest {
  status: 'completed' | 'failed';
  outputs?: Record<string, unknown>;
  steps?: ExecutionStep[];
  error?: string;
  completedAt?: string;
}

// Query keys
export const executionKeys = {
  all: ['executions'] as const,
  lists: () => [...executionKeys.all, 'list'] as const,
  list: (filters?: { status?: string; workflowId?: string }) =>
    [...executionKeys.lists(), filters] as const,
  infinite: (filters?: { status?: string; workflowId?: string }) =>
    [...executionKeys.all, 'infinite', filters] as const,
  details: () => [...executionKeys.all, 'detail'] as const,
  detail: (id: string) => [...executionKeys.details(), id] as const,
  byWorkflow: (workflowId: string) => [...executionKeys.all, 'workflow', workflowId] as const,
};

// Hooks
export function useExecutions(filters?: { status?: string; workflowId?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.workflowId) queryParams.set('workflowId', filters.workflowId);
  const query = queryParams.toString();

  return useQuery({
    queryKey: executionKeys.list(filters),
    queryFn: () =>
      api.get<ListExecutionsResponse>(`/executions${query ? `?${query}` : ''}`),
  });
}

export function useInfiniteExecutions(filters?: { status?: string; workflowId?: string }) {
  return useInfiniteQuery({
    queryKey: executionKeys.infinite(filters),
    queryFn: ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (filters?.status) queryParams.set('status', filters.status);
      if (filters?.workflowId) queryParams.set('workflowId', filters.workflowId);
      queryParams.set('offset', String(pageParam));
      queryParams.set('limit', '20');
      return api.get<ListExecutionsResponse>(`/executions?${queryParams.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.executions.length < 20) return undefined;
      return allPages.length * 20;
    },
    select: (data) => ({
      executions: data.pages.flatMap((page) => page.executions),
      hasMore: data.pages[data.pages.length - 1]?.executions.length === 20,
    }),
  });
}

export function useExecution(executionId: string) {
  return useQuery({
    queryKey: executionKeys.detail(executionId),
    queryFn: () => api.get<GetExecutionResponse>(`/executions/${executionId}`),
    enabled: !!executionId,
  });
}

export function useWorkflowExecutions(workflowId: string) {
  return useQuery({
    queryKey: executionKeys.byWorkflow(workflowId),
    queryFn: () => api.get<ListExecutionsResponse>(`/workflows/${workflowId}/executions`),
    enabled: !!workflowId,
  });
}

export function useCompleteExecution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ executionId, data }: { executionId: string; data: CompleteExecutionRequest }) =>
      api.post<{ success: boolean; status: string; completedAt: string }>(
        `/executions/${executionId}/complete`,
        data
      ),
    onSuccess: (_, { executionId }) => {
      queryClient.invalidateQueries({ queryKey: executionKeys.detail(executionId) });
      queryClient.invalidateQueries({ queryKey: executionKeys.lists() });
    },
  });
}
