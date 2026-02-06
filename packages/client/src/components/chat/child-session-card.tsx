import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import type { ChildSessionSummary } from '@/api/types';
import type { ChildSessionEvent } from '@/hooks/use-chat';

const INACTIVE_STATUSES = new Set(['terminated', 'error']);
const PAGE_SIZE = 5;

interface ChildSessionCardProps {
  event: ChildSessionEvent;
  summary?: ChildSessionSummary;
}

export function ChildSessionCard({ event, summary }: ChildSessionCardProps) {
  const title = summary?.title || event.title || 'Sub-agent session';
  const status = summary?.status || 'initializing';
  const workspace = summary?.workspace;

  const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    initializing: 'warning',
    running: 'success',
    idle: 'default',
    hibernated: 'secondary',
    terminated: 'secondary',
    error: 'error',
  };

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: event.childSessionId }}
      className="group my-1.5 block animate-fade-in"
    >
      <div className="flex items-center gap-2.5 rounded-md border border-neutral-200/80 bg-surface-0 px-3 py-2 transition-all hover:border-accent/30 hover:shadow-sm dark:border-neutral-800 dark:bg-surface-1 dark:hover:border-accent/25">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2/60 dark:bg-surface-2">
          <ForkIcon className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
              {title}
            </span>
            <Badge variant={statusVariant[status] ?? 'default'} className="shrink-0 text-2xs">
              {status}
            </Badge>
            {summary?.prNumber && (
              <Badge
                variant={
                  summary.prState === 'merged' ? 'default'
                    : summary.prState === 'open' ? 'success'
                    : 'secondary'
                }
                className="shrink-0 text-2xs"
              >
                #{summary.prNumber}
              </Badge>
            )}
          </div>
          {workspace && (
            <span className="mt-0.5 block truncate font-mono text-[9px] text-neutral-400 dark:text-neutral-500">
              {workspace}
            </span>
          )}
        </div>
        <ArrowRightIcon className="h-3 w-3 shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-accent dark:text-neutral-600" />
      </div>
    </Link>
  );
}

interface ChildSessionInlineListProps {
  events: ChildSessionEvent[];
  children?: ChildSessionSummary[];
}

export function ChildSessionInlineList({ events, children }: ChildSessionInlineListProps) {
  if (events.length === 0) return null;

  const summaryMap = new Map(children?.map((c) => [c.id, c]));

  const active: ChildSessionEvent[] = [];
  const inactive: ChildSessionEvent[] = [];
  for (const event of events) {
    const status = summaryMap.get(event.childSessionId)?.status ?? 'initializing';
    if (INACTIVE_STATUSES.has(status)) {
      inactive.push(event);
    } else {
      active.push(event);
    }
  }

  return (
    <div className="space-y-1">
      {active.map((event) => (
        <ChildSessionCard
          key={event.childSessionId}
          event={event}
          summary={summaryMap.get(event.childSessionId)}
        />
      ))}
      {inactive.length > 0 && (
        <CompletedSessionsToggle events={inactive} summaryMap={summaryMap} />
      )}
    </div>
  );
}

function CompletedSessionsToggle({
  events,
  summaryMap,
}: {
  events: ChildSessionEvent[];
  summaryMap: Map<string, ChildSessionSummary>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible = events.slice(0, visibleCount);
  const remaining = events.length - visibleCount;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 font-mono text-[10px] text-neutral-400 transition-colors hover:text-neutral-600 dark:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <ChevronIcon expanded={expanded} />
        {events.length} completed session{events.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="space-y-1">
          {visible.map((event) => (
            <ChildSessionCard
              key={event.childSessionId}
              event={event}
              summary={summaryMap.get(event.childSessionId)}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="mx-auto block font-mono text-[10px] text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              Show {Math.min(remaining, PAGE_SIZE)} more
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ForkIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
