import * as React from 'react';
import { useContainers } from '@/api/containers';
import { ContainerCard } from './container-card';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import type { ContainerStatus } from '@/api/containers';

const STATUS_OPTIONS: { value: ContainerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'starting', label: 'Starting' },
  { value: 'error', label: 'Error' },
];

export function ContainerList() {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<ContainerStatus | 'all'>('all');
  const { data, isLoading, error } = useContainers();

  const filteredContainers = React.useMemo(() => {
    if (!data?.containers) return [];

    return data.containers.filter((container) => {
      // Filter by status
      if (statusFilter !== 'all' && container.status !== statusFilter) {
        return false;
      }

      // Filter by search
      if (search) {
        const searchLower = search.toLowerCase();
        return container.name.toLowerCase().includes(searchLower);
      }

      return true;
    });
  }, [data?.containers, search, statusFilter]);

  if (isLoading) {
    return <ContainerListSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="text-sm text-pretty text-red-600 dark:text-red-400">
          Failed to load containers. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search containers..."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                statusFilter === option.value
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!data?.containers.length ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700">
            <ContainerIcon className="size-6 text-neutral-400" />
          </div>
          <h3 className="text-balance font-medium text-neutral-900 dark:text-neutral-100">
            No containers yet
          </h3>
          <p className="mt-1 text-sm text-pretty text-neutral-500 dark:text-neutral-400">
            Create your first OpenCode container to start developing with AI assistance.
          </p>
        </div>
      ) : filteredContainers.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
            No containers match your filters.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredContainers.map((container) => (
            <ContainerCard key={container.id} container={container} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="size-3 rounded-full" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ContainerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 12.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h7.5" />
      <path d="m22 17-5 5" />
      <path d="m17 17 5 5" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
    </svg>
  );
}
