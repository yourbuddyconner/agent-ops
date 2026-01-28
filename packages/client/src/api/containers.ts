import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Types
export type ContainerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type ContainerInstanceSize = 'dev' | 'basic' | 'standard';

export interface Container {
  id: string;
  userId: string;
  name: string;
  status: ContainerStatus;
  instanceSize: ContainerInstanceSize;
  region?: string;
  containerId?: string;
  ipAddress?: string;
  port: number;
  workspacePath?: string;
  autoSleepMinutes: number;
  lastActiveAt?: string;
  startedAt?: string;
  stoppedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListContainersResponse {
  containers: Container[];
}

export interface GetContainerResponse {
  container: Container;
}

export interface ContainerActionResponse {
  container: Container;
  message: string;
}

export interface CreateContainerRequest {
  name: string;
  instanceSize?: ContainerInstanceSize;
  autoSleepMinutes?: number;
  workspacePath?: string;
}

export interface UpdateContainerRequest {
  name?: string;
  instanceSize?: ContainerInstanceSize;
  autoSleepMinutes?: number;
}

// Query keys
export const containerKeys = {
  all: ['containers'] as const,
  lists: () => [...containerKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...containerKeys.lists(), filters] as const,
  details: () => [...containerKeys.all, 'detail'] as const,
  detail: (id: string) => [...containerKeys.details(), id] as const,
};

// Hooks
export function useContainers() {
  return useQuery({
    queryKey: containerKeys.list(),
    queryFn: () => api.get<ListContainersResponse>('/containers'),
  });
}

export function useContainer(containerId: string) {
  return useQuery({
    queryKey: containerKeys.detail(containerId),
    queryFn: () => api.get<GetContainerResponse>(`/containers/${containerId}`),
    enabled: !!containerId,
    refetchInterval: (query) => {
      // Poll more frequently when container is in a transitioning state
      const status = query.state.data?.container?.status;
      if (status === 'starting' || status === 'stopping') {
        return 2000; // Poll every 2 seconds
      }
      return false; // Don't poll when stable
    },
  });
}

export function useCreateContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateContainerRequest) =>
      api.post<ContainerActionResponse>('/containers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: containerKeys.lists() });
    },
  });
}

export function useUpdateContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ containerId, ...data }: UpdateContainerRequest & { containerId: string }) =>
      api.put<ContainerActionResponse>(`/containers/${containerId}`, data),
    onSuccess: (response, { containerId }) => {
      queryClient.invalidateQueries({ queryKey: containerKeys.lists() });
      queryClient.setQueryData(containerKeys.detail(containerId), { container: response.container });
    },
  });
}

export function useDeleteContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (containerId: string) =>
      api.delete<{ success: boolean; message: string }>(`/containers/${containerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: containerKeys.lists() });
    },
  });
}

export function useStartContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (containerId: string) =>
      api.post<ContainerActionResponse>(`/containers/${containerId}/start`),
    onSuccess: (response, containerId) => {
      queryClient.invalidateQueries({ queryKey: containerKeys.lists() });
      queryClient.setQueryData(containerKeys.detail(containerId), { container: response.container });
    },
  });
}

export function useStopContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (containerId: string) =>
      api.post<ContainerActionResponse>(`/containers/${containerId}/stop`),
    onSuccess: (response, containerId) => {
      queryClient.invalidateQueries({ queryKey: containerKeys.lists() });
      queryClient.setQueryData(containerKeys.detail(containerId), { container: response.container });
    },
  });
}

export function useContainerHeartbeat() {
  return useMutation({
    mutationFn: (containerId: string) =>
      api.post<{ success: boolean }>(`/containers/${containerId}/heartbeat`),
  });
}
