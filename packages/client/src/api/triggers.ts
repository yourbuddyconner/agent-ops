import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { workflowKeys } from './workflows';

// Types
export interface Trigger {
  id: string;
  workflowId: string;
  workflowName: string | null;
  name: string;
  enabled: boolean;
  type: 'webhook' | 'schedule' | 'manual';
  config: WebhookConfig | ScheduleConfig | ManualConfig;
  variableMapping: Record<string, string> | null;
  webhookUrl?: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookConfig {
  type: 'webhook';
  path: string;
  method?: 'GET' | 'POST';
  secret?: string;
  headers?: Record<string, string>;
}

export interface ScheduleConfig {
  type: 'schedule';
  cron: string;
  timezone?: string;
}

export interface ManualConfig {
  type: 'manual';
}

export type TriggerConfig = WebhookConfig | ScheduleConfig | ManualConfig;

export interface CreateTriggerRequest {
  workflowId: string;
  name: string;
  enabled?: boolean;
  config: TriggerConfig;
  variableMapping?: Record<string, string>;
}

export interface UpdateTriggerRequest {
  name?: string;
  enabled?: boolean;
  config?: TriggerConfig;
  variableMapping?: Record<string, string>;
}

export interface ListTriggersResponse {
  triggers: Trigger[];
}

export interface GetTriggerResponse {
  trigger: Trigger;
}

// Query keys
export const triggerKeys = {
  all: ['triggers'] as const,
  lists: () => [...triggerKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...triggerKeys.lists(), filters] as const,
  details: () => [...triggerKeys.all, 'detail'] as const,
  detail: (id: string) => [...triggerKeys.details(), id] as const,
  byWorkflow: (workflowId: string) => [...triggerKeys.all, 'workflow', workflowId] as const,
};

// Hooks
export function useTriggers() {
  return useQuery({
    queryKey: triggerKeys.list(),
    queryFn: () => api.get<ListTriggersResponse>('/triggers'),
  });
}

export function useTrigger(triggerId: string) {
  return useQuery({
    queryKey: triggerKeys.detail(triggerId),
    queryFn: () => api.get<GetTriggerResponse>(`/triggers/${triggerId}`),
    enabled: !!triggerId,
  });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTriggerRequest) =>
      api.post<Trigger>('/triggers', data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: triggerKeys.byWorkflow(variables.workflowId) });
    },
  });
}

export function useUpdateTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ triggerId, data }: { triggerId: string; data: UpdateTriggerRequest }) =>
      api.patch<{ success: boolean; updatedAt: string }>(`/triggers/${triggerId}`, data),
    onSuccess: (_, { triggerId }) => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.detail(triggerId) });
      queryClient.invalidateQueries({ queryKey: triggerKeys.lists() });
    },
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (triggerId: string) =>
      api.delete<{ success: boolean }>(`/triggers/${triggerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.lists() });
    },
  });
}

export function useEnableTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (triggerId: string) =>
      api.post<{ success: boolean }>(`/triggers/${triggerId}/enable`),
    onSuccess: (_, triggerId) => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.detail(triggerId) });
      queryClient.invalidateQueries({ queryKey: triggerKeys.lists() });
    },
  });
}

export function useDisableTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (triggerId: string) =>
      api.post<{ success: boolean }>(`/triggers/${triggerId}/disable`),
    onSuccess: (_, triggerId) => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.detail(triggerId) });
      queryClient.invalidateQueries({ queryKey: triggerKeys.lists() });
    },
  });
}

export function useRunTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ triggerId, variables }: { triggerId: string; variables?: Record<string, unknown> }) =>
      api.post<{
        executionId: string;
        workflowId: string;
        workflowName: string;
        status: string;
        variables: Record<string, unknown>;
        message: string;
      }>(`/triggers/${triggerId}/run`, { variables }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.executions(data.workflowId) });
    },
  });
}
