import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AgentPersona, PersonaVisibility } from './types';

export const personaKeys = {
  all: ['personas'] as const,
  list: () => [...personaKeys.all, 'list'] as const,
  details: () => [...personaKeys.all, 'detail'] as const,
  detail: (id: string) => [...personaKeys.details(), id] as const,
};

export function usePersonas() {
  return useQuery({
    queryKey: personaKeys.list(),
    queryFn: () => api.get<{ personas: AgentPersona[] }>('/personas'),
    select: (data) => data.personas,
  });
}

export function usePersona(id: string) {
  return useQuery({
    queryKey: personaKeys.detail(id),
    queryFn: () => api.get<{ persona: AgentPersona }>(`/personas/${id}`),
    enabled: !!id,
    select: (data) => data.persona,
  });
}

interface CreatePersonaInput {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  defaultModel?: string;
  visibility?: PersonaVisibility;
  isDefault?: boolean;
  files?: { filename: string; content: string; sortOrder: number }[];
}

export function useCreatePersona() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePersonaInput) =>
      api.post<{ persona: AgentPersona }>('/personas', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personaKeys.list() });
    },
  });
}

interface UpdatePersonaInput {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  icon?: string;
  defaultModel?: string;
  visibility?: PersonaVisibility;
  isDefault?: boolean;
}

export function useUpdatePersona() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdatePersonaInput) =>
      api.put<{ ok: boolean }>(`/personas/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.list() });
      queryClient.invalidateQueries({ queryKey: personaKeys.detail(id) });
    },
  });
}

export function useDeletePersona() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: boolean }>(`/personas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personaKeys.list() });
    },
  });
}

export function useUpdatePersonaFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      personaId,
      files,
    }: {
      personaId: string;
      files: { filename: string; content: string; sortOrder: number }[];
    }) => api.put<{ ok: boolean }>(`/personas/${personaId}/files`, files),
    onSuccess: (_, { personaId }) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.detail(personaId) });
    },
  });
}
