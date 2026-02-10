import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { IntegrationList } from '@/components/integrations/integration-list';
import { ConnectIntegrationDialog } from '@/components/integrations/connect-integration-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUserCredentials, useDeleteUserCredential } from '@/api/auth';
import { useTelegramConfig, useDisconnectTelegram } from '@/api/orchestrator';

export const Route = createFileRoute('/integrations/')({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const [connectDialogOpen, setConnectDialogOpen] = React.useState(false);
  const { data: credentials } = useUserCredentials();
  const { data: telegramConfig } = useTelegramConfig();

  const hasOnePassword = credentials?.some((c) => c.provider === '1password');
  const hasTelegram = !!telegramConfig;
  const hasAnyConfigured = hasOnePassword || hasTelegram;

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect your tools and services"
        actions={
          <Button onClick={() => setConnectDialogOpen(true)}>
            Connect Integration
          </Button>
        }
      />

      <div className="space-y-6">
        {hasAnyConfigured && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {hasOnePassword && <OnePasswordCard />}
            {hasTelegram && <TelegramCard config={telegramConfig} />}
          </div>
        )}

        <IntegrationList />
      </div>

      <ConnectIntegrationDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
      />
    </PageContainer>
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
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3.6a8.4 8.4 0 110 16.8 8.4 8.4 0 010-16.8zM10.8 7.2v9.6h2.4v-4.248l3.048 4.248H18.6l-3.6-4.8 3.6-4.8h-2.352L13.2 11.448V7.2z" />
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
