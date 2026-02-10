import * as React from 'react';
import { useIntegrations } from '@/api/integrations';
import { useUserCredentials, useDeleteUserCredential } from '@/api/auth';
import { useTelegramConfig, useDisconnectTelegram } from '@/api/orchestrator';
import { IntegrationCard } from './integration-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import type { Integration } from '@/api/types';

type StatusFilter = Integration['status'] | 'all';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'error', label: 'Error' },
  { value: 'pending', label: 'Pending' },
  { value: 'disconnected', label: 'Disconnected' },
];

export function IntegrationList() {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const { data, isLoading: integrationsLoading, error } = useIntegrations();
  const { data: credentials, isLoading: credentialsLoading } = useUserCredentials();
  const { data: telegramConfig, isLoading: telegramLoading } = useTelegramConfig();

  const hasOnePassword = credentials?.some((c) => c.provider === '1password');
  const hasTelegram = !!telegramConfig;

  const isLoading = integrationsLoading || credentialsLoading || telegramLoading;

  // Build a unified list of items to render
  const allItems = React.useMemo(() => {
    const items: { key: string; type: '1password' | 'telegram' | 'api'; service: string; status: 'active' | 'pending' | 'error' | 'disconnected'; integration?: Integration }[] = [];

    if (hasOnePassword) {
      items.push({ key: '1password', type: '1password', service: '1password', status: 'active' });
    }
    if (hasTelegram) {
      items.push({ key: 'telegram', type: 'telegram', service: 'telegram', status: 'active' });
    }
    if (data?.integrations) {
      for (const integration of data.integrations) {
        items.push({ key: integration.id, type: 'api', service: integration.service, status: integration.status, integration });
      }
    }

    return items;
  }, [hasOnePassword, hasTelegram, data?.integrations]);

  const filteredItems = React.useMemo(() => {
    return allItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (search) {
        return item.service.toLowerCase().includes(search.toLowerCase());
      }
      return true;
    });
  }, [allItems, search, statusFilter]);

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

      {allItems.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-neutral-500 text-pretty dark:text-neutral-400">
            No integrations configured. Connect your first service to get started.
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-neutral-500 text-pretty dark:text-neutral-400">
            No integrations match your filters.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            if (item.type === '1password') {
              return <OnePasswordCard key={item.key} />;
            }
            if (item.type === 'telegram') {
              return <TelegramCard key={item.key} config={telegramConfig!} />;
            }
            return <IntegrationCard key={item.key} integration={item.integration!} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Configured Integration Cards ───────────────────────────────────────

function OnePasswordCard() {
  const deleteCredential = useDeleteUserCredential();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            <OnePasswordIcon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">1Password</CardTitle>
            <p className="text-xs text-green-600 dark:text-green-400">Connected</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Service account token configured
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => deleteCredential.mutate('1password')}
            disabled={deleteCredential.isPending}
          >
            {deleteCredential.isPending ? 'Removing...' : 'Disconnect'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TelegramCard({ config }: { config: { botUsername: string; webhookActive: boolean } }) {
  const disconnectTelegram = useDisconnectTelegram();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            <TelegramIcon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Telegram</CardTitle>
            <p className="text-xs text-green-600 dark:text-green-400">
              @{config.botUsername}
              {config.webhookActive ? ' \u00b7 Webhook active' : ''}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Bot connected to orchestrator
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => disconnectTelegram.mutate()}
            disabled={disconnectTelegram.isPending}
          >
            {disconnectTelegram.isPending ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────

function OnePasswordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .007C5.373.007 0 5.376 0 11.999c0 6.624 5.373 11.994 12 11.994S24 18.623 24 12C24 5.376 18.627.007 12 .007Zm-.895 4.857h1.788c.484 0 .729.002.914.096a.86.86 0 0 1 .377.377c.094.185.095.428.095.912v6.016c0 .12 0 .182-.015.238a.427.427 0 0 1-.067.137.923.923 0 0 1-.174.162l-.695.564c-.113.092-.17.138-.191.194a.216.216 0 0 0 0 .15c.02.055.078.101.191.193l.695.565c.094.076.14.115.174.162.03.042.053.087.067.137a.936.936 0 0 1 .015.238v2.746c0 .484-.001.727-.095.912a.86.86 0 0 1-.377.377c-.185.094-.43.096-.914.096h-1.788c-.484 0-.726-.002-.912-.096a.86.86 0 0 1-.377-.377c-.094-.185-.095-.428-.095-.912v-6.016c0-.12 0-.182.015-.238a.437.437 0 0 1 .067-.139c.034-.047.08-.083.174-.16l.695-.564c.113-.092.17-.138.191-.194a.216.216 0 0 0 0-.15c-.02-.055-.078-.101-.191-.193l-.695-.565a.92.92 0 0 1-.174-.162.437.437 0 0 1-.067-.139.92.92 0 0 1-.015-.236V6.25c0-.484.001-.727.095-.912a.86.86 0 0 1 .377-.377c.186-.094.428-.096.912-.096z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
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
