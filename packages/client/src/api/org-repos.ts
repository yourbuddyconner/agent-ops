import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { OrgRepository } from './types';

export const orgRepoKeys = {
  all: ['org-repos'] as const,
  list: () => [...orgRepoKeys.all, 'list'] as const,
};

export function useOrgRepos() {
  return useQuery({
    queryKey: orgRepoKeys.list(),
    queryFn: () => api.get<{ repos: OrgRepository[] }>('/repos/org'),
    select: (data) => data.repos,
  });
}

export function useCreateOrgRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      fullName: string;
      description?: string;
      language?: string;
      defaultBranch?: string;
    }) => api.post<OrgRepository>('/admin/repos', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgRepoKeys.list() });
    },
  });
}

export function useUpdateOrgRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      description?: string;
      language?: string;
      defaultBranch?: string;
      enabled?: boolean;
    }) => api.put<{ ok: boolean }>(`/admin/repos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgRepoKeys.list() });
    },
  });
}

export function useDeleteOrgRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: boolean }>(`/admin/repos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgRepoKeys.list() });
    },
  });
}

export function useSetRepoPersonaDefault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ repoId, personaId }: { repoId: string; personaId: string | null }) => {
      if (personaId) {
        return api.put<{ ok: boolean }>(`/admin/repos/${repoId}/persona-default`, { personaId });
      }
      return api.delete<{ ok: boolean }>(`/admin/repos/${repoId}/persona-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgRepoKeys.list() });
    },
  });
}
