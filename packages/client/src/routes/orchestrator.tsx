import * as React from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/session/session-metadata-sidebar';
import {
  useOrchestratorInfo,
  useCreateOrchestrator,
  useCheckHandle,
  useOrchestratorMemories,
  useDeleteMemory,
} from '@/api/orchestrator';
import { useSessionChildren, useSessionDoStatus } from '@/api/sessions';
import { formatRelativeTime } from '@/lib/format';
import type { ChildSessionSummary, OrchestratorMemory, OrchestratorMemoryCategory } from '@/api/types';

export const Route = createFileRoute('/orchestrator')({
  component: OrchestratorPage,
});

function OrchestratorPage() {
  const { data: orchInfo, isLoading } = useOrchestratorInfo();

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Orchestrator" description="Loading..." />
        <OrchestratorSkeleton />
      </PageContainer>
    );
  }

  if (!orchInfo?.identity) {
    return <SetupForm />;
  }

  return <OrchestratorDashboard />;
}

// ---------------------------------------------------------------------------
// Setup Form (migrated from orchestrator-setup.tsx)
// ---------------------------------------------------------------------------

function useDebounced(value: string, delayMs: number) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function SetupForm() {
  const navigate = useNavigate();
  const createOrchestrator = useCreateOrchestrator();

  const [name, setName] = React.useState('');
  const [handle, setHandle] = React.useState('');
  const [customInstructions, setCustomInstructions] = React.useState('');

  const debouncedHandle = useDebounced(handle, 400);
  const handleCheck = useCheckHandle(debouncedHandle);
  const handleTaken = debouncedHandle.length >= 2 && handleCheck.data?.available === false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (handleTaken) return;

    createOrchestrator.mutate(
      {
        name,
        handle: handle.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        customInstructions: customInstructions || undefined,
      },
      {
        onSuccess: (data) => {
          navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: data.sessionId },
          });
        },
      }
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Set Up Your Orchestrator"
        description="Create your personal AI assistant that manages tasks and coordinates agent sessions"
      />

      <div className="mx-auto max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="orch-name"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Name
                </label>
                <input
                  id="orch-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jarvis"
                  className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  Your orchestrator's display name
                </p>
              </div>

              <div>
                <label
                  htmlFor="orch-handle"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Handle
                </label>
                <div className="mt-1 flex items-center">
                  <span className="mr-1 text-sm text-neutral-400">@</span>
                  <input
                    id="orch-handle"
                    type="text"
                    required
                    value={handle}
                    onChange={(e) =>
                      setHandle(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                      )
                    }
                    placeholder="jarvis"
                    className={`block w-full rounded-md border bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 ${
                      handleTaken
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500 dark:focus:border-red-400 dark:focus:ring-red-400'
                        : 'border-neutral-300 focus:border-neutral-500 focus:ring-neutral-500 dark:border-neutral-600 dark:focus:border-neutral-400 dark:focus:ring-neutral-400'
                    }`}
                  />
                </div>
                {handleTaken ? (
                  <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                    Handle @{debouncedHandle} is already taken
                  </p>
                ) : debouncedHandle.length >= 2 && handleCheck.data?.available ? (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                    @{debouncedHandle} is available
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    Lowercase letters, numbers, dashes, and underscores only
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="orch-instructions"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Custom Instructions (optional)
                </label>
                <textarea
                  id="orch-instructions"
                  rows={4}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Any special instructions for your orchestrator..."
                  className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
                />
              </div>
            </div>
          </div>

          {createOrchestrator.isError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {(createOrchestrator.error as any)?.message || 'Failed to create orchestrator'}
            </div>
          )}

          <Button
            type="submit"
            disabled={!name || !handle || handleTaken || createOrchestrator.isPending}
            className="w-full"
          >
            {createOrchestrator.isPending ? 'Creating...' : 'Create Orchestrator'}
          </Button>
        </form>
      </div>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
  initializing: 'warning',
  running: 'success',
  idle: 'default',
  hibernating: 'warning',
  hibernated: 'secondary',
  restoring: 'warning',
  terminated: 'secondary',
  error: 'error',
};

function OrchestratorDashboard() {
  const { data: orchInfo } = useOrchestratorInfo();
  const { data: doStatus } = useSessionDoStatus(orchInfo?.sessionId ?? '');
  const { data: children } = useSessionChildren(orchInfo?.sessionId ?? '');
  const [memoryCategory, setMemoryCategory] = React.useState<string | undefined>();
  const { data: memories } = useOrchestratorMemories(memoryCategory);

  const identity = orchInfo!.identity!;
  const session = orchInfo?.session;
  const needsRestart = orchInfo?.needsRestart;
  const sessionId = orchInfo!.sessionId;

  // Compute uptime from doStatus
  const runningStartedAt = (doStatus as any)?.runningStartedAt as string | undefined;
  const [uptime, setUptime] = React.useState('');
  React.useEffect(() => {
    if (!runningStartedAt) {
      setUptime('');
      return;
    }
    const start = new Date(runningStartedAt).getTime();
    const tick = () => {
      const seconds = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) setUptime(`${h}h ${m}m`);
      else setUptime(`${m}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [runningStartedAt]);

  // Status label
  const statusLabel = !session
    ? 'Offline'
    : session.status === 'running' || session.status === 'idle'
      ? 'Online'
      : session.status === 'hibernated'
        ? 'Sleeping'
        : session.status;

  // Sort children: active first, then by createdAt desc
  const sortedChildren = React.useMemo(() => {
    if (!children) return [];
    return [...children].sort((a, b) => {
      const aActive = a.status !== 'terminated' && a.status !== 'error';
      const bActive = b.status !== 'terminated' && b.status !== 'error';
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [children]);

  return (
    <PageContainer>
      <PageHeader
        title={identity.name}
        description={`@${identity.handle}`}
        actions={
          <div className="flex items-center gap-2">
            {needsRestart && (
              <RestartButton identity={identity} />
            )}
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId }}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Open Chat
            </Link>
          </div>
        }
      />

      {/* Status bar */}
      <div className="mb-6 flex items-center gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-2">
          <StatusDot status={session?.status ?? 'terminated'} />
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {statusLabel}
          </span>
        </div>
        {uptime && (
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Uptime:</span>
            <span className="font-mono tabular-nums">{uptime}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <span>Managed sessions:</span>
          <span className="font-mono font-medium tabular-nums">{children?.length ?? 0}</span>
        </div>
      </div>

      <div className="space-y-8">
        {/* Managed Sessions */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Managed Sessions
          </h2>
          {sortedChildren.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No managed sessions yet
              </p>
            </div>
          ) : (
            <ManagedSessionsTable sessions={sortedChildren} />
          )}
        </section>

        {/* Memories */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Memories
              <span className="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                {memories?.length ?? 0}/200
              </span>
            </h2>
          </div>
          <MemoryCategoryFilter selected={memoryCategory} onSelect={setMemoryCategory} />
          <MemoriesList memories={memories ?? []} />
        </section>
      </div>
    </PageContainer>
  );
}

function RestartButton({ identity }: { identity: { name: string; handle: string; customInstructions?: string | null } }) {
  const createOrchestrator = useCreateOrchestrator();

  return (
    <button
      onClick={() =>
        createOrchestrator.mutate({
          name: identity.name,
          handle: identity.handle,
          customInstructions: identity.customInstructions ?? undefined,
        })
      }
      disabled={createOrchestrator.isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50"
    >
      {createOrchestrator.isPending ? 'Restarting...' : 'Restart'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Managed Sessions Table
// ---------------------------------------------------------------------------

function ManagedSessionsTable({ sessions }: { sessions: ChildSessionSummary[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/50">
            <th className="px-3 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">
              Session
            </th>
            <th className="px-3 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400">
              Status
            </th>
            <th className="hidden px-3 py-2.5 text-left font-medium text-neutral-500 dark:text-neutral-400 md:table-cell">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
          {sessions.map((s) => (
            <ManagedSessionRow key={s.id} session={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagedSessionRow({ session }: { session: ChildSessionSummary }) {
  return (
    <tr className="bg-white transition-colors hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/50">
      <td className="px-3 py-2.5">
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="flex items-center gap-2 font-medium text-neutral-900 transition-colors hover:text-accent dark:text-neutral-100 dark:hover:text-accent"
        >
          <StatusDot status={session.status} />
          <span className="truncate">{session.title || session.workspace}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <Badge variant={STATUS_VARIANTS[session.status] ?? 'default'}>
          {session.status}
        </Badge>
      </td>
      <td className="hidden px-3 py-2.5 text-neutral-500 tabular-nums dark:text-neutral-400 md:table-cell">
        {formatRelativeTime(session.createdAt)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

const MEMORY_CATEGORIES: { value: OrchestratorMemoryCategory; label: string }[] = [
  { value: 'preference', label: 'Preferences' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'context', label: 'Context' },
  { value: 'project', label: 'Projects' },
  { value: 'decision', label: 'Decisions' },
  { value: 'general', label: 'General' },
];

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  workflow: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  context: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  project: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  decision: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  general: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

function MemoryCategoryFilter({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (cat: string | undefined) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      <button
        onClick={() => onSelect(undefined)}
        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          !selected
            ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
        }`}
      >
        All
      </button>
      {MEMORY_CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          onClick={() => onSelect(selected === cat.value ? undefined : cat.value)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            selected === cat.value
              ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}

function MemoriesList({ memories }: { memories: OrchestratorMemory[] }) {
  const deleteMemory = useDeleteMemory();

  if (memories.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-800">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No memories yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {memories.map((memory) => (
        <div
          key={memory.id}
          className="group flex items-start gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800"
        >
          <div className="flex-1 min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[memory.category] ?? CATEGORY_COLORS.general}`}
              >
                {memory.category}
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                {formatRelativeTime(memory.createdAt)}
              </span>
            </div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
              {memory.content}
            </p>
          </div>
          <button
            onClick={() => deleteMemory.mutate(memory.id)}
            className="shrink-0 rounded p-1 text-neutral-300 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-500 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-400"
            title="Delete memory"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function OrchestratorSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div>
        <Skeleton className="mb-3 h-5 w-36" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
