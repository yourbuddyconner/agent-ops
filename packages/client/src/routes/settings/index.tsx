import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useAuthStore } from '@/stores/auth';
import { useLogout, useUpdateProfile } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { APIKeyList } from '@/components/settings/api-key-list';
import { useTheme } from '@/hooks/use-theme';

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
});

function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logoutMutation = useLogout();
  const { theme, setTheme } = useTheme();

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Configure your account and preferences"
      />

      <div className="space-y-6">
        <SettingsSection title="Account">
          <div className="space-y-4">
            {user && (
              <div>
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Email
                </label>
                <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-100">{user.email}</p>
              </div>
            )}
            <div>
              <Button variant="secondary" onClick={() => logoutMutation.mutate()}>
                Sign out
              </Button>
            </div>
          </div>
        </SettingsSection>

        <GitConfigSection />

        <SettingsSection title="Appearance">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Theme
              </label>
              <div className="mt-2 flex gap-2">
                <ThemeButton
                  label="Light"
                  active={theme === 'light'}
                  onClick={() => setTheme('light')}
                />
                <ThemeButton
                  label="Dark"
                  active={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                />
                <ThemeButton
                  label="System"
                  active={theme === 'system'}
                  onClick={() => setTheme('system')}
                />
              </div>
            </div>
          </div>
        </SettingsSection>

        <IdleTimeoutSection />

        <SettingsSection title="API Keys">
          <APIKeyList />
        </SettingsSection>
      </div>
    </PageContainer>
  );
}

function GitConfigSection() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useUpdateProfile();
  const [gitName, setGitName] = React.useState(user?.gitName ?? '');
  const [gitEmail, setGitEmail] = React.useState(user?.gitEmail ?? '');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setGitName(user?.gitName ?? '');
    setGitEmail(user?.gitEmail ?? '');
  }, [user?.gitName, user?.gitEmail]);

  const hasChanges =
    gitName !== (user?.gitName ?? '') || gitEmail !== (user?.gitEmail ?? '');

  function handleSave() {
    updateProfile.mutate(
      {
        gitName: gitName || undefined,
        gitEmail: gitEmail || undefined,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <SettingsSection title="Git Configuration">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Configure the name and email used for git commits in your sandboxes.
        </p>
        <div>
          <label
            htmlFor="git-name"
            className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Name
          </label>
          <input
            id="git-name"
            type="text"
            value={gitName}
            onChange={(e) => setGitName(e.target.value)}
            placeholder="Your Name"
            className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
        </div>
        <div>
          <label
            htmlFor="git-email"
            className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Email
          </label>
          <input
            id="git-email"
            type="email"
            value={gitEmail}
            onChange={(e) => setGitEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            For GitHub private emails, use{' '}
            <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
              username@users.noreply.github.com
            </code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateProfile.isPending}
          >
            {updateProfile.isPending ? 'Saving...' : 'Save'}
          </Button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
          )}
          {updateProfile.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">
              Failed to save. Check that the email is valid.
            </span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

const IDLE_TIMEOUT_OPTIONS = [
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
];

function IdleTimeoutSection() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useUpdateProfile();
  const [saved, setSaved] = React.useState(false);
  const currentValue = user?.idleTimeoutSeconds ?? 900;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = parseInt(e.target.value);
    updateProfile.mutate(
      { idleTimeoutSeconds: value },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <SettingsSection title="Session">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Sessions automatically hibernate after a period of inactivity to save resources. They restore transparently when you return.
        </p>
        <div>
          <label
            htmlFor="idle-timeout"
            className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Idle timeout
          </label>
          <select
            id="idle-timeout"
            value={currentValue}
            onChange={handleChange}
            disabled={updateProfile.isPending}
            className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          >
            {IDLE_TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            Time before an idle session is hibernated. New sessions will use this setting.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
          )}
          {updateProfile.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">Failed to save.</span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function ThemeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
      }`}
    >
      {label}
    </button>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <h2 className="text-lg font-medium text-neutral-900 text-balance dark:text-neutral-100">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}
