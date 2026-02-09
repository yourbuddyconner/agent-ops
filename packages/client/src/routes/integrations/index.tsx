import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { IntegrationList } from '@/components/integrations/integration-list';
import { ConnectIntegrationDialog } from '@/components/integrations/connect-integration-dialog';
import { Button } from '@/components/ui/button';
import { useUserCredentials, useSetUserCredential, useDeleteUserCredential } from '@/api/auth';
import { useTelegramConfig, useSetupTelegram, useDisconnectTelegram } from '@/api/orchestrator';

export const Route = createFileRoute('/integrations/')({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const [connectDialogOpen, setConnectDialogOpen] = React.useState(false);

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
        <CredentialsSection />
        <TelegramSection />
        <IntegrationList />
      </div>
      <ConnectIntegrationDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
      />
    </PageContainer>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <h2 className="text-lg font-medium text-neutral-900 text-balance dark:text-neutral-100">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// ─── Credentials (per-user secrets) ─────────────────────────────────────

const CREDENTIAL_PROVIDERS = [
  { id: '1password', label: '1Password', placeholder: 'ops_...' },
] as const;

function CredentialsSection() {
  const { data: credentials, isLoading } = useUserCredentials();

  return (
    <Section title="Credentials">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Connect external services to make credentials available inside your agent sessions.
          Values are encrypted at rest and injected as environment variables when sessions start.
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {CREDENTIAL_PROVIDERS.map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_PROVIDERS.map((provider) => {
              const existing = credentials?.find((c) => c.provider === provider.id);
              return (
                <CredentialRow
                  key={provider.id}
                  provider={provider.id}
                  label={provider.label}
                  placeholder={provider.placeholder}
                  isSet={!!existing}
                />
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

function CredentialRow({ provider, label, placeholder, isSet }: { provider: string; label: string; placeholder: string; isSet: boolean }) {
  const setCredential = useSetUserCredential();
  const deleteCredential = useDeleteUserCredential();
  const [value, setValue] = React.useState('');
  const [editing, setEditing] = React.useState(false);

  function handleSave() {
    setCredential.mutate(
      { provider, key: value },
      {
        onSuccess: () => {
          setValue('');
          setEditing(false);
        },
      }
    );
  }

  const inputClass =
    'block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400';

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</div>
      {editing ? (
        <>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={inputClass + ' flex-1'}
            autoFocus
          />
          <Button onClick={handleSave} disabled={!value || setCredential.isPending}>
            {setCredential.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={() => { setEditing(false); setValue(''); }}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
            {isSet ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Not configured'}
          </span>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {isSet ? 'Update' : 'Set'}
          </Button>
          {isSet && (
            <Button
              variant="secondary"
              onClick={() => deleteCredential.mutate(provider)}
              disabled={deleteCredential.isPending}
            >
              Remove
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Telegram ───────────────────────────────────────────────────────────

function TelegramSection() {
  const { data: config, isLoading } = useTelegramConfig();
  const setupTelegram = useSetupTelegram();
  const disconnectTelegram = useDisconnectTelegram();
  const [botToken, setBotToken] = React.useState('');

  function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!botToken.trim()) return;
    setupTelegram.mutate(
      { botToken: botToken.trim() },
      { onSuccess: () => setBotToken('') },
    );
  }

  return (
    <Section title="Telegram Bot">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Connect your own Telegram bot to receive messages and route them to your orchestrator.
          Create a bot via{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            @BotFather
          </a>{' '}
          on Telegram, then paste the token here.
        </p>

        {isLoading ? (
          <div className="text-sm text-neutral-400 dark:text-neutral-500">Loading...</div>
        ) : config ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    @{config.botUsername}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    Webhook {config.webhookActive ? (
                      <span className="text-green-600 dark:text-green-400">active</span>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-500">inactive</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => disconnectTelegram.mutate()}
                  disabled={disconnectTelegram.isPending}
                >
                  {disconnectTelegram.isPending ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </div>
            </div>
            {disconnectTelegram.isError && (
              <span className="text-sm text-red-600 dark:text-red-400">
                Failed to disconnect
              </span>
            )}
          </div>
        ) : (
          <form onSubmit={handleSetup} className="space-y-3">
            <div>
              <label
                htmlFor="telegram-token"
                className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Bot Token
              </label>
              <input
                id="telegram-token"
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                autoComplete="off"
                className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={!botToken.trim() || setupTelegram.isPending}
              >
                {setupTelegram.isPending ? 'Connecting...' : 'Connect Bot'}
              </Button>
              {setupTelegram.isError && (
                <span className="text-sm text-red-600 dark:text-red-400">
                  {(setupTelegram.error as any)?.message?.includes('400')
                    ? 'Invalid bot token'
                    : 'Failed to connect'}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}
