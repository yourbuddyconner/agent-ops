import { useState, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useSession, useSessionChildren, useSessionDoStatus } from '@/api/sessions';
import { useOrchestratorInfo, useOrchestratorMemories } from '@/api/orchestrator';
import { SidebarSection, StatusDot, StatItem } from './session-metadata-sidebar';
import { Badge } from '@/components/ui/badge';
import type { ConnectedUser } from '@/hooks/use-chat';
import type { OrchestratorMemoryCategory } from '@/api/types';

interface OrchestratorMetadataSidebarProps {
  sessionId: string;
  connectedUsers?: ConnectedUser[];
  selectedModel?: string;
  compact?: boolean;
}

const MEMORY_CATEGORIES: OrchestratorMemoryCategory[] = [
  'preference',
  'workflow',
  'context',
  'project',
  'decision',
  'general',
];

const CATEGORY_COLORS: Record<OrchestratorMemoryCategory, string> = {
  preference: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  workflow: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  context: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  project: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  decision: 'bg-red-500/10 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  general: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

const MAX_CHILDREN_SHOWN = 5;

export function OrchestratorMetadataSidebar({
  sessionId,
  connectedUsers,
  compact = false,
}: OrchestratorMetadataSidebarProps) {
  const { data: session } = useSession(sessionId);
  const { data: doStatus } = useSessionDoStatus(sessionId);
  const { data: orchInfo } = useOrchestratorInfo();
  const { data: childSessions } = useSessionChildren(sessionId);
  const { data: memories } = useOrchestratorMemories();

  const runningStartedAt = typeof doStatus?.runningStartedAt === 'number' ? doStatus.runningStartedAt : null;

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!runningStartedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - runningStartedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [runningStartedAt]);

  const identity = orchInfo?.identity;
  const activeChildren = useMemo(
    () => (childSessions ?? []).filter((c) => c.status !== 'terminated' && c.status !== 'error'),
    [childSessions],
  );

  const memoryCounts = useMemo(() => {
    if (!memories) return {};
    const counts: Partial<Record<OrchestratorMemoryCategory, number>> = {};
    for (const m of memories) {
      counts[m.category] = (counts[m.category] ?? 0) + 1;
    }
    return counts;
  }, [memories]);

  const recentMemories = useMemo(() => {
    if (!memories || memories.length === 0) return [];
    return [...memories]
      .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
      .slice(0, 3);
  }, [memories]);

  const totalMemories = memories?.length ?? 0;

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const statusLabel = (() => {
    if (!session) return 'Offline';
    if (session.status === 'running') return 'Online';
    if (session.status === 'hibernated') return 'Sleeping';
    if (session.status === 'idle' || session.status === 'initializing') return 'Online';
    return 'Offline';
  })();

  return (
    <div
      className={`flex h-full flex-col border-l border-border bg-surface-0 dark:bg-surface-0 ${compact ? 'w-[200px]' : 'w-[240px]'}`}
    >
      <div className={`flex h-10 shrink-0 items-center border-b border-border ${compact ? 'px-2' : 'px-3'}`}>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
          Orchestrator
        </span>
      </div>
      <div className={`flex h-8 shrink-0 items-center border-b border-neutral-100 dark:border-neutral-800/50 ${compact ? 'px-2' : 'px-3'}`} />

      <div className={`flex-1 overflow-y-auto ${compact ? 'px-2 py-2 space-y-2' : 'px-3 py-2.5 space-y-3'}`}>
        {/* Identity */}
        <SidebarSection label="Identity">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[11px] font-bold text-accent">
              {identity?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-medium text-neutral-700 dark:text-neutral-200">
                {identity?.name ?? 'Orchestrator'}
              </div>
              {identity?.handle && (
                <div className="truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                  @{identity.handle}
                </div>
              )}
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <StatusDot status={session?.status ?? 'terminated'} />
            <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              {statusLabel}
            </span>
          </div>
        </SidebarSection>

        {/* Team */}
        {connectedUsers && connectedUsers.length > 0 && (
          <SidebarSection label="Team">
            <div className="flex flex-wrap gap-1">
              {connectedUsers.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-surface-1/50 px-2 py-px font-mono text-[10px] text-neutral-500 dark:border-neutral-800 dark:bg-surface-2/50 dark:text-neutral-400"
                >
                  <span className="h-1 w-1 rounded-full bg-emerald-500" />
                  {user.name || user.email || user.id.slice(0, 8)}
                </span>
              ))}
            </div>
          </SidebarSection>
        )}

        {/* Sandbox Uptime */}
        <SidebarSection label="Sandbox Uptime">
          <span className="font-mono text-[11px] font-medium text-neutral-600 dark:text-neutral-300 tabular-nums">
            {runningStartedAt ? formatDuration(elapsed) : '\u2014'}
          </span>
        </SidebarSection>

        {/* Managed Sessions */}
        {activeChildren.length > 0 && (
          <SidebarSection label={`Managed Sessions (${activeChildren.length})`}>
            <div className="space-y-px">
              {activeChildren.slice(0, MAX_CHILDREN_SHOWN).map((child) => (
                <Link
                  key={child.id}
                  to="/sessions/$sessionId"
                  params={{ sessionId: child.id }}
                  className="group/child flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors hover:bg-surface-1 dark:hover:bg-surface-2"
                >
                  <StatusDot status={child.status} />
                  <span className="truncate font-mono text-[10px] text-neutral-600 transition-colors group-hover/child:text-neutral-900 dark:text-neutral-400 dark:group-hover/child:text-neutral-200">
                    {child.title || child.workspace}
                  </span>
                </Link>
              ))}
              {activeChildren.length > MAX_CHILDREN_SHOWN && (
                <span className="block px-1.5 font-mono text-[9px] text-neutral-400 dark:text-neutral-500">
                  +{activeChildren.length - MAX_CHILDREN_SHOWN} more
                </span>
              )}
            </div>
          </SidebarSection>
        )}

        {/* Memories */}
        {totalMemories > 0 && (
          <SidebarSection label={`Memories (${totalMemories}/200)`}>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {MEMORY_CATEGORIES.filter((cat) => (memoryCounts[cat] ?? 0) > 0).map((cat) => (
                <StatItem key={cat} label={cat} value={memoryCounts[cat]!} />
              ))}
            </div>
          </SidebarSection>
        )}

        {/* Recent Memories */}
        {recentMemories.length > 0 && (
          <SidebarSection label="Recent Memories">
            <div className="space-y-1">
              {recentMemories.map((mem) => (
                <div key={mem.id} className="flex items-start gap-1.5">
                  <Badge
                    className={`mt-px shrink-0 !px-1 !py-0 !text-[8px] !tracking-normal ${CATEGORY_COLORS[mem.category]}`}
                  >
                    {mem.category.slice(0, 4)}
                  </Badge>
                  <span className="line-clamp-1 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                    {mem.content}
                  </span>
                </div>
              ))}
            </div>
          </SidebarSection>
        )}
      </div>
    </div>
  );
}
