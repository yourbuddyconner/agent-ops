import { createFileRoute } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useAuthStore } from '@/stores/auth';
import { useLogout } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { APIKeyList } from '@/components/settings/api-key-list';
import { useTheme } from '@/hooks/use-theme';

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
});

function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const { logout } = useLogout();
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
              <Button variant="secondary" onClick={logout}>
                Sign out
              </Button>
            </div>
          </div>
        </SettingsSection>

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

        <SettingsSection title="API Keys">
          <APIKeyList />
        </SettingsSection>
      </div>
    </PageContainer>
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
