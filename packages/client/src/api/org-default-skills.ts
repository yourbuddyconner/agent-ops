import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { SkillSummary } from './types';

export const orgDefaultSkillKeys = {
  all: ['org-default-skills'] as const,
};

export function useOrgDefaultSkills() {
  return useQuery({
    queryKey: orgDefaultSkillKeys.all,
    queryFn: () =>
      api.get<{ skills: SkillSummary[] }>('/admin/default-skills'),
    select: (data) => data.skills,
  });
}

export function useUpdateOrgDefaultSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.put('/admin/default-skills', { skillIds }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: orgDefaultSkillKeys.all }),
  });
}
