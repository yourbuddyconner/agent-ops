import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime, formatDuration } from '@/lib/format';
import type { DashboardRecentSession } from '@/api/types';

interface ActivityFeedProps {
  sessions: DashboardRecentSession[];
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'success',
  idle: 'default',
  initializing: 'warning',
  hibernating: 'warning',
  hibernated: 'secondary',
  restoring: 'warning',
  terminated: 'secondary',
  error: 'error',
};

export function ActivityFeed({ sessions }: ActivityFeedProps) {
  return (
    <div className="animate-stagger-in rounded-lg border border-neutral-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]" style={{ animationDelay: '280ms' }}>
      <div className="border-b border-neutral-100 px-5 py-3.5">
        <h3 className="label-mono text-neutral-400">Recent Sessions</h3>
      </div>
      {sessions.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-neutral-300">
          No sessions yet
        </div>
      ) : (
        <div className="divide-y divide-neutral-100/80">
          {sessions.map((s) => (
            <Link
              key={s.id}
              to="/sessions/$sessionId"
              params={{ sessionId: s.id }}
              className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-1"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-neutral-900 group-hover:text-accent transition-colors">
                  {s.workspace || 'Untitled Session'}
                </p>
                <p className="mt-0.5 font-mono text-2xs text-neutral-400">
                  {formatRelativeTime(s.createdAt)} &middot; {formatDuration(s.durationSeconds)}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex items-center gap-2.5 font-mono text-2xs text-neutral-400">
                  <span className="tabular-nums">{s.messageCount} <span className="text-neutral-300">msg</span></span>
                  <span className="text-neutral-200">&middot;</span>
                  <span className="tabular-nums">{s.toolCallCount} <span className="text-neutral-300">tool</span></span>
                </div>
                <Badge
                  variant={statusVariant[s.status] || 'default'}
                  title={s.status === 'error' && s.errorMessage ? s.errorMessage : undefined}
                >
                  {s.status}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
