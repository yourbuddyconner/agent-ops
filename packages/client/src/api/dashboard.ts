import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { DashboardStatsResponse } from './types';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: (period: number) => [...dashboardKeys.all, 'stats', period] as const,
};

export function useDashboardStats(periodHours: number = 720) {
  return useQuery({
    queryKey: dashboardKeys.stats(periodHours),
    queryFn: () => api.get<DashboardStatsResponse>(`/dashboard/stats?period=${periodHours}&unit=hours`),
    refetchInterval: 60_000,
  });
}
