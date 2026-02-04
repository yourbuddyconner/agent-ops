import type { DashboardHeroStats, DashboardDelta } from '@/api/types';
import { HeroMetricCard } from './hero-metric-card';

interface HeroMetricsProps {
  hero: DashboardHeroStats;
  userHero: DashboardHeroStats;
  delta: DashboardDelta;
}

function SessionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M6 6h4M6 8.5h4M6 11h2" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5h12v8H4l-2 2v-10z" />
    </svg>
  );
}

function ReposIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2v12M5 2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5" />
      <path d="M5 14h7a2 2 0 0 0 2-2" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

export function HeroMetrics({ hero, userHero, delta }: HeroMetricsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <HeroMetricCard
        icon={<SessionsIcon />}
        label="Sessions"
        value={hero.totalSessions.toLocaleString()}
        userValue={userHero.totalSessions.toLocaleString()}
        delta={delta.sessions}
        index={0}
      />
      <HeroMetricCard
        icon={<MessagesIcon />}
        label="Messages"
        value={hero.totalMessages.toLocaleString()}
        userValue={userHero.totalMessages.toLocaleString()}
        delta={delta.messages}
        index={1}
      />
      <HeroMetricCard
        icon={<ReposIcon />}
        label="Repositories"
        value={hero.uniqueRepos.toLocaleString()}
        userValue={userHero.uniqueRepos.toLocaleString()}
        index={2}
      />
      <HeroMetricCard
        icon={<ClockIcon />}
        label="Session Hours"
        value={hero.sessionHours > 0 ? `${hero.sessionHours}h` : '0h'}
        userValue={userHero.sessionHours > 0 ? `${userHero.sessionHours}h` : '0h'}
        tooltip="Total wall-clock time across all sessions"
        index={3}
      />
    </div>
  );
}
