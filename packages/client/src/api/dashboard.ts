import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { DashboardStatsResponse, AdoptionMetrics } from './types';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: (period: number) => [...dashboardKeys.all, 'stats', period] as const,
  adoption: (period: number) => [...dashboardKeys.all, 'adoption', period] as const,
};

export function useDashboardStats(periodHours: number = 720) {
  return useQuery({
    queryKey: dashboardKeys.stats(periodHours),
    queryFn: () => api.get<DashboardStatsResponse>(`/dashboard/stats?period=${periodHours}&unit=hours`),
    refetchInterval: 60_000,
  });
}

export function useAdoptionMetrics(periodDays: number = 30) {
  return useQuery({
    queryKey: dashboardKeys.adoption(periodDays),
    queryFn: () => api.get<AdoptionMetrics>(`/dashboard/adoption?period=${periodDays}`),
    refetchInterval: 60_000,
  });
}
