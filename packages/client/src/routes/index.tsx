import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useDashboardStats } from '@/api/dashboard';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { LiveSessionsBanner } from '@/components/dashboard/live-sessions-banner';
import { HeroMetrics } from '@/components/dashboard/hero-metrics';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { TopRepositories } from '@/components/dashboard/top-repositories';
import { AdoptionCard } from '@/components/dashboard/adoption-card';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

function DashboardPage() {
  const [period, setPeriod] = useState(720);
  const { data, isLoading, isError } = useDashboardStats(period);

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Overview of your team's AI agent activity"
        actions={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {isError && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          Failed to load dashboard data
        </div>
      )}

      {isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-6">
          <LiveSessionsBanner sessions={data.activeSessions} />
          <HeroMetrics hero={data.hero} userHero={data.userHero} delta={data.delta} />
          <ActivityChart data={data.activity} />
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ActivityFeed sessions={data.recentSessions} />
            </div>
            <div className="lg:col-span-2 space-y-6">
              <TopRepositories repos={data.topRepos} />
              <AdoptionCard />
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
