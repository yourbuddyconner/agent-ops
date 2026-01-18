import { useSessions } from './sessions';
import { useIntegrations } from './integrations';
import type { AgentSession } from './types';

export interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  integrations: number;
  activeIntegrations: number;
  recentSessions: AgentSession[];
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
};

export function useDashboardStats() {
  const sessionsQuery = useSessions();
  const integrationsQuery = useIntegrations();

  const isLoading = sessionsQuery.isLoading || integrationsQuery.isLoading;
  const isError = sessionsQuery.isError || integrationsQuery.isError;
  const error = sessionsQuery.error || integrationsQuery.error;

  const sessions = sessionsQuery.data?.sessions ?? [];
  const integrations = integrationsQuery.data?.integrations ?? [];

  const stats: DashboardStats = {
    activeSessions: sessions.filter((s) => s.status === 'running').length,
    totalSessions: sessions.length,
    integrations: integrations.length,
    activeIntegrations: integrations.filter((i) => i.status === 'active').length,
    recentSessions: sessions
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  };

  return {
    data: stats,
    isLoading,
    isError,
    error,
    refetch: () => {
      sessionsQuery.refetch();
      integrationsQuery.refetch();
    },
  };
}
