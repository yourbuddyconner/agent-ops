import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/hooks/use-chat';
import { cn } from '@/lib/cn';

interface LogsPanelProps {
  entries: LogEntry[];
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  // Server-side audit log event types (dot-separated)
  'session.started': 'text-blue-500',
  'session.terminated': 'text-red-400',
  'session.hibernated': 'text-amber-500',
  'session.restored': 'text-blue-400',
  'user.prompt': 'text-green-500',
  'user.abort': 'text-rose-400',
  'user.answer': 'text-purple-500',
  'user.joined': 'text-cyan-500',
  'user.left': 'text-neutral-400',
  'agent.tool_call': 'text-orange-500',
  'agent.tool_completed': 'text-orange-400',
  'agent.error': 'text-red-500',
  'agent.turn_complete': 'text-indigo-500',
  'git.pr_created': 'text-emerald-400',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function LogsPanel({ entries, className }: LogsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        'overflow-y-auto bg-neutral-950 p-3 font-mono text-[12px] leading-5',
        className
      )}
    >
      {entries.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-500">
          No log entries yet
        </div>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="flex gap-3 hover:bg-white/[0.03]">
            <span className="shrink-0 tabular-nums text-neutral-500">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={cn('shrink-0 w-32', TYPE_COLORS[entry.type] ?? 'text-neutral-400')}>
              {entry.type}
            </span>
            <span className="min-w-0 truncate text-neutral-300">
              {entry.summary}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
