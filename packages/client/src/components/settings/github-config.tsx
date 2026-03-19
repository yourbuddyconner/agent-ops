import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  useAdminGitHubConfig,
  useSetGitHubOAuth,
  useDeleteGitHubOAuth,
  useSetGitHubApp,
  useDeleteGitHubApp,
  useVerifyGitHubApp,
} from '@/api/admin-github';

const inputClass =
  'mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function GitHubConfigSection() {
  const { data: config, isLoading } = useAdminGitHubConfig();

  return (
    <Section title="GitHub">
      <div className="space-y-6">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Configure GitHub integration for your organization. An OAuth App enables user authentication, and a GitHub App enables repository access for the agent.
        </p>

        {config?.source === 'env' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/20">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              GitHub is configured via environment variables. To manage in-app, set OAuth credentials below.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
            <div className="h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
          </div>
        ) : (
          <>
            <OAuthPanel config={config} />
            <AppPanel config={config} />
          </>
        )}
      </div>
    </Section>
  );
}

// ─── OAuth App Panel ────────────────────────────────────────────────────

function OAuthPanel({ config }: { config: ReturnType<typeof useAdminGitHubConfig>['data'] }) {
  const setOAuth = useSetGitHubOAuth();
  const deleteOAuth = useDeleteGitHubOAuth();
  const [editing, setEditing] = React.useState(false);
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const isConfigured = config?.oauth?.configured;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;
    setOAuth.mutate(
      { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
      {
        onSuccess: () => {
          setClientId('');
          setClientSecret('');
          setEditing(false);
        },
      }
    );
  }

  function handleRemove() {
    deleteOAuth.mutate(undefined, {
      onSuccess: () => setConfirmRemove(false),
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">OAuth App</h3>

      {isConfigured && !editing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/50">
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Client ID: {config.oauth?.clientId || '***'}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">Configured</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Update
              </Button>
              {confirmRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 dark:text-red-400">Confirm?</span>
                  <Button variant="secondary" onClick={handleRemove} disabled={deleteOAuth.isPending}>
                    {deleteOAuth.isPending ? 'Removing...' : 'Remove'}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          {deleteOAuth.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Failed to remove OAuth configuration.</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">Client ID</label>
            <input
              type="text"
              className={inputClass}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ov23li..."
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">Client Secret</label>
            <input
              type="password"
              className={inputClass}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="secret"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={setOAuth.isPending || !clientId.trim() || !clientSecret.trim()}>
              {setOAuth.isPending ? 'Saving...' : 'Save'}
            </Button>
            {editing && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setClientId('');
                  setClientSecret('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          {setOAuth.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Failed to save OAuth configuration.</p>
          )}
        </form>
      )}
    </div>
  );
}

// ─── GitHub App Panel ───────────────────────────────────────────────────

function AppPanel({ config }: { config: ReturnType<typeof useAdminGitHubConfig>['data'] }) {
  const setApp = useSetGitHubApp();
  const deleteApp = useDeleteGitHubApp();
  const verifyApp = useVerifyGitHubApp();
  const [editing, setEditing] = React.useState(false);
  const [appId, setAppId] = React.useState('');
  const [appPrivateKey, setAppPrivateKey] = React.useState('');
  const [appSlug, setAppSlug] = React.useState('');
  const [webhookSecret, setWebhookSecret] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [verifyResult, setVerifyResult] = React.useState<{
    installationId: string;
    accessibleOwners: string[];
    repositoryCount: number;
  } | null>(null);

  const isConfigured = config?.app?.configured;
  const oauthConfigured = config?.oauth?.configured;

  if (!oauthConfigured && !isConfigured) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">GitHub App</h3>
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          Configure an OAuth App first to enable GitHub App settings.
        </p>
      </div>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!appId.trim() || !appPrivateKey.trim()) return;
    setApp.mutate(
      {
        appId: appId.trim(),
        appPrivateKey: appPrivateKey.trim(),
        appSlug: appSlug.trim() || undefined,
        appWebhookSecret: webhookSecret.trim() || undefined,
      },
      {
        onSuccess: () => {
          setAppId('');
          setAppPrivateKey('');
          setAppSlug('');
          setWebhookSecret('');
          setEditing(false);
        },
      }
    );
  }

  function handleRemove() {
    deleteApp.mutate(undefined, {
      onSuccess: () => setConfirmRemove(false),
    });
  }

  function handleVerify() {
    verifyApp.mutate(undefined, {
      onSuccess: (data) => {
        setVerifyResult({
          installationId: data.installationId,
          accessibleOwners: data.accessibleOwners,
          repositoryCount: data.repositoryCount,
        });
      },
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">GitHub App</h3>

      {isConfigured && !editing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/50">
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                App ID: {config.app?.appId || '***'}
                {config.app?.appSlug && <span className="ml-2 text-neutral-500">({config.app.appSlug})</span>}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Configured
                {config.app?.installationId && ` · Installation: ${config.app.installationId}`}
              </p>
              {config.app?.accessibleOwners && config.app.accessibleOwners.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Owners: {config.app.accessibleOwners.join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleVerify} disabled={verifyApp.isPending}>
                {verifyApp.isPending ? 'Verifying...' : 'Verify'}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Update
              </Button>
              {confirmRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 dark:text-red-400">Confirm?</span>
                  <Button variant="secondary" onClick={handleRemove} disabled={deleteApp.isPending}>
                    {deleteApp.isPending ? 'Removing...' : 'Remove'}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          {verifyResult && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 dark:border-green-700 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">Verification successful</p>
              <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                Installation ID: {verifyResult.installationId} · {verifyResult.repositoryCount} repositories
              </p>
              {verifyResult.accessibleOwners.length > 0 && (
                <p className="text-xs text-green-700 dark:text-green-400">
                  Accessible owners: {verifyResult.accessibleOwners.join(', ')}
                </p>
              )}
            </div>
          )}

          {verifyApp.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Failed to verify GitHub App installation.</p>
          )}
          {deleteApp.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Failed to remove GitHub App configuration.</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">App ID</label>
            <input
              type="text"
              className={inputClass}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="123456"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">Private Key</label>
            <textarea
              className={inputClass + ' min-h-[100px] resize-y'}
              value={appPrivateKey}
              onChange={(e) => setAppPrivateKey(e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              App Slug <span className="text-neutral-400">(optional)</span>
            </label>
            <input
              type="text"
              className={inputClass}
              value={appSlug}
              onChange={(e) => setAppSlug(e.target.value)}
              placeholder="my-github-app"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Webhook Secret <span className="text-neutral-400">(optional)</span>
            </label>
            <input
              type="password"
              className={inputClass}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={setApp.isPending || !appId.trim() || !appPrivateKey.trim()}>
              {setApp.isPending ? 'Saving...' : 'Save'}
            </Button>
            {editing && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setAppId('');
                  setAppPrivateKey('');
                  setAppSlug('');
                  setWebhookSecret('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          {setApp.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">Failed to save GitHub App configuration.</p>
          )}
        </form>
      )}
    </div>
  );
}
