import { createFileRoute, Link } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useDashboardStats } from '@/api/dashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/format';
import type { AgentSession } from '@/api/types';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: stats, isLoading, isError } = useDashboardStats();

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Overview of your AI agent activity"
      />

      {isError && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          Failed to load dashboard data
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              title="Active Sessions"
              value={stats.activeSessions.toString()}
              linkTo="/sessions"
            />
            <StatCard
              title="Total Sessions"
              value={stats.totalSessions.toString()}
              linkTo="/sessions"
            />
            <StatCard
              title="Active Integrations"
              value={stats.activeIntegrations.toString()}
              linkTo="/integrations"
            />
            <StatCard
              title="Total Integrations"
              value={stats.integrations.toString()}
              linkTo="/integrations"
            />
          </>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium text-neutral-900 text-balance">
          Recent Activity
        </h2>
        {isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : stats.recentSessions.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500 text-pretty">
            No recent activity to display. Create a new session to get started.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {stats.recentSessions.map((session) => (
              <RecentSessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function StatCard({
  title,
  value,
  linkTo,
}: {
  title: string;
  value: string;
  linkTo?: string;
}) {
  const content = (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 transition-colors hover:bg-neutral-50">
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>;
  }

  return content;
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-9 w-16" />
    </div>
  );
}

function RecentSessionCard({ session }: { session: AgentSession }) {
  const statusColors: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
    running: 'success',
    idle: 'default',
    initializing: 'warning',
    terminated: 'error',
    error: 'error',
  };

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      className="block rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900">
            {session.workspace || 'Untitled Session'}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {formatRelativeTime(session.createdAt)}
          </p>
        </div>
        <Badge variant={statusColors[session.status] || 'default'}>
          {session.status}
        </Badge>
      </div>
    </Link>
  );
}
