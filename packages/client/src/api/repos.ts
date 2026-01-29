import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
}

interface ReposResponse {
  repos: Repo[];
  page: number;
  perPage: number;
}

interface ValidateRepoResponse {
  valid: boolean;
  error?: string;
  repo?: {
    fullName: string;
    defaultBranch: string;
    private: boolean;
    canPush: boolean;
    cloneUrl: string;
  };
}

export const repoKeys = {
  all: ['repos'] as const,
  list: (page?: number) => [...repoKeys.all, 'list', page] as const,
  validate: (url: string) => [...repoKeys.all, 'validate', url] as const,
};

export function useRepos(page = 1) {
  return useQuery({
    queryKey: repoKeys.list(page),
    queryFn: () => api.get<ReposResponse>(`/repos?page=${page}&per_page=50&sort=updated`),
  });
}

export function useValidateRepo(url: string) {
  return useQuery({
    queryKey: repoKeys.validate(url),
    queryFn: () => api.get<ValidateRepoResponse>(`/repos/validate?url=${encodeURIComponent(url)}`),
    enabled: url.length > 0 && url.includes('github.com'),
  });
}
