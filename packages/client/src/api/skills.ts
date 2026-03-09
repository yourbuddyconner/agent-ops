import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Skill, SkillSummary, SkillSource, SkillVisibility } from './types';

export const skillKeys = {
  all: ['skills'] as const,
  list: (filters?: { source?: SkillSource; visibility?: SkillVisibility }) =>
    [...skillKeys.all, 'list', filters] as const,
  search: (query: string) => [...skillKeys.all, 'search', query] as const,
  details: () => [...skillKeys.all, 'detail'] as const,
  detail: (id: string) => [...skillKeys.details(), id] as const,
};

export function useSkills(filters?: {
  source?: SkillSource;
  visibility?: SkillVisibility;
}) {
  const params = new URLSearchParams();
  if (filters?.source) params.set('source', filters.source);
  if (filters?.visibility) params.set('visibility', filters.visibility);
  const qs = params.toString();

  return useQuery({
    queryKey: skillKeys.list(filters),
    queryFn: () =>
      api.get<{ skills: SkillSummary[] }>(`/skills${qs ? `?${qs}` : ''}`),
    select: (data) => data.skills,
  });
}

export function useSearchSkills(query: string) {
  return useQuery({
    queryKey: skillKeys.search(query),
    queryFn: () =>
      api.get<{ skills: SkillSummary[] }>(
        `/skills?q=${encodeURIComponent(query)}`
      ),
    enabled: query.length > 0,
    select: (data) => data.skills,
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: skillKeys.detail(id),
    queryFn: () => api.get<{ skill: Skill }>(`/skills/${id}`),
    enabled: !!id,
    select: (data) => data.skill,
  });
}

interface CreateSkillInput {
  name: string;
  slug: string;
  description?: string;
  content: string;
  visibility?: SkillVisibility;
}

export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSkillInput) =>
      api.post<{ skill: Skill }>('/skills', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}

interface UpdateSkillInput {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  content?: string;
  visibility?: SkillVisibility;
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateSkillInput) =>
      api.put<{ ok: boolean }>(`/skills/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: skillKeys.all });
      queryClient.invalidateQueries({ queryKey: skillKeys.detail(id) });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}
