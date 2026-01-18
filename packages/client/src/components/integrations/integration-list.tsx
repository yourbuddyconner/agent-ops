import * as React from 'react';
import { useIntegrations } from '@/api/integrations';
import { IntegrationCard } from './integration-card';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import type { Integration } from '@/api/types';

const STATUS_OPTIONS: { value: Integration['status'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'error', label: 'Error' },
  { value: 'pending', label: 'Pending' },
  { value: 'disconnected', label: 'Disconnected' },
];

export function IntegrationList() {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<Integration['status'] | 'all'>('all');
  const { data, isLoading, error } = useIntegrations();

  const filteredIntegrations = React.useMemo(() => {
    if (!data?.integrations) return [];

    return data.integrations.filter((integration) => {
      // Filter by status
      if (statusFilter !== 'all' && integration.status !== statusFilter) {
        return false;
      }

      // Filter by search
      if (search) {
        const searchLower = search.toLowerCase();
        return integration.service.toLowerCase().includes(searchLower);
      }

      return true;
    });
  }, [data?.integrations, search, statusFilter]);

  if (isLoading) {
    return <IntegrationListSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="text-sm text-red-600 text-pretty dark:text-red-400">
          Failed to load integrations. Please try again.
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
            placeholder="Search integrations..."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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

      {!data?.integrations.length ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-neutral-500 text-pretty dark:text-neutral-400">
            No integrations configured. Connect your first service to get started.
          </p>
        </div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-neutral-500 text-pretty dark:text-neutral-400">
            No integrations match your filters.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredIntegrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-neutral-200 bg-white p-6"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
