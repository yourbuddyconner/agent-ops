import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Types
export interface Workflow {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  version: string;
  data: WorkflowData;
  enabled: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowData {
  id: string;
  name: string;
  description?: string;
  version?: string;
  variables?: Record<string, VariableDefinition>;
  steps: WorkflowStep[];
  constraints?: WorkflowConstraints;
}

export interface VariableDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'conditional' | 'loop' | 'parallel' | 'subworkflow' | 'approval';
  tool?: string;
  arguments?: Record<string, unknown>;
  goal?: string;
  context?: string;
  outputVariable?: string;
  condition?: unknown;
  then?: WorkflowStep[];
  else?: WorkflowStep[];
}

export interface WorkflowConstraints {
  maxDuration?: number;
  maxSteps?: number;
  maxToolCalls?: number;
}

export interface ListWorkflowsResponse {
  workflows: Workflow[];
}

export interface GetWorkflowResponse {
  workflow: Workflow;
}

export interface SyncWorkflowRequest {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  version?: string;
  data: WorkflowData;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string | null;
  slug?: string | null;
  version?: string;
  enabled?: boolean;
  tags?: string[];
  data?: WorkflowData;
}

// Query keys
export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...workflowKeys.lists(), filters] as const,
  details: () => [...workflowKeys.all, 'detail'] as const,
  detail: (id: string) => [...workflowKeys.details(), id] as const,
  executions: (id: string) => [...workflowKeys.detail(id), 'executions'] as const,
};

// Hooks
export function useWorkflows() {
  return useQuery({
    queryKey: workflowKeys.list(),
    queryFn: () => api.get<ListWorkflowsResponse>('/workflows'),
  });
}

export function useWorkflow(workflowId: string) {
  return useQuery({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => api.get<GetWorkflowResponse>(`/workflows/${workflowId}`),
    enabled: !!workflowId,
  });
}

export function useSyncWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SyncWorkflowRequest) =>
      api.post<{ success: boolean; id: string }>('/workflows/sync', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
  });
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workflowId, ...data }: UpdateWorkflowRequest & { workflowId: string }) =>
      api.put<GetWorkflowResponse>(`/workflows/${workflowId}`, data),
    onSuccess: (response, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
      queryClient.setQueryData(workflowKeys.detail(workflowId), response);
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId: string) =>
      api.delete<{ success: boolean }>(`/workflows/${workflowId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
  });
}

export function useRunWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workflowId, variables }: { workflowId: string; variables?: Record<string, unknown> }) =>
      api.post<{
        executionId: string;
        workflowId: string;
        workflowName: string;
        status: string;
        variables: Record<string, unknown>;
        message: string;
      }>('/triggers/manual/run', { workflowId, variables }),
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.executions(workflowId) });
    },
  });
}
