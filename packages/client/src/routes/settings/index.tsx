import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useAuthStore } from '@/stores/auth';
import { useLogout, useUpdateProfile } from '@/api/auth';
import { useOrchestratorInfo, useUpdateOrchestratorIdentity, useCheckHandle } from '@/api/orchestrator';
import { useAvailableModels } from '@/api/sessions';
import type { ProviderModels } from '@/api/sessions';
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
        {user?.role === 'admin' && (
          <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Organization</h2>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  Manage members, API keys, access control, and invites.
                </p>
              </div>
              <Link
                to="/settings/admin"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Manage
              </Link>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Agent Personas</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Create and manage persona instruction files that customize agent behavior.
              </p>
            </div>
            <Link
              to="/settings/personas"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Manage
            </Link>
          </div>
        </div>

        <OrchestratorIdentitySection />

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

        <ModelPreferencesSection />

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

function useDebounced(value: string, delayMs: number) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function OrchestratorIdentitySection() {
  const { data: orchInfo, isLoading } = useOrchestratorInfo();
  const updateIdentity = useUpdateOrchestratorIdentity();
  const [name, setName] = React.useState('');
  const [handle, setHandle] = React.useState('');
  const [customInstructions, setCustomInstructions] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  const debouncedHandle = useDebounced(handle, 400);
  const handleChanged = handle !== (orchInfo?.identity?.handle ?? '');
  const handleCheck = useCheckHandle(handleChanged ? debouncedHandle : '');
  const handleTaken = handleChanged && debouncedHandle.length >= 2 && handleCheck.data?.available === false;

  React.useEffect(() => {
    if (orchInfo?.identity) {
      setName(orchInfo.identity.name);
      setHandle(orchInfo.identity.handle);
      setCustomInstructions(orchInfo.identity.customInstructions ?? '');
    }
  }, [orchInfo?.identity]);

  if (isLoading || !orchInfo?.exists) return null;

  const hasChanges =
    name !== orchInfo.identity?.name ||
    handle !== orchInfo.identity?.handle ||
    customInstructions !== (orchInfo.identity?.customInstructions ?? '');

  function handleSave() {
    if (handleTaken) return;
    updateIdentity.mutate(
      {
        name: name || undefined,
        handle: handle || undefined,
        customInstructions,
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
    <SettingsSection title="Orchestrator Identity">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Configure your personal orchestrator's name, handle, and instructions.
        </p>
        <div>
          <label htmlFor="orch-name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Name
          </label>
          <input
            id="orch-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
        </div>
        <div>
          <label htmlFor="orch-handle" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Handle
          </label>
          <input
            id="orch-handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            className={`mt-1 block w-full max-w-md rounded-md border bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 ${
              handleTaken
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500 dark:focus:border-red-400 dark:focus:ring-red-400'
                : 'border-neutral-300 focus:border-neutral-500 focus:ring-neutral-500 dark:border-neutral-600 dark:focus:border-neutral-400 dark:focus:ring-neutral-400'
            }`}
          />
          {handleTaken && (
            <p className="mt-1 text-xs text-red-500 dark:text-red-400">
              Handle @{debouncedHandle} is already taken
            </p>
          )}
        </div>
        <div>
          <label htmlFor="orch-instructions" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Custom Instructions
          </label>
          <textarea
            id="orch-instructions"
            rows={4}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Special instructions for your orchestrator..."
            className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!hasChanges || handleTaken || updateIdentity.isPending}>
            {updateIdentity.isPending ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          {updateIdentity.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">Failed to save</span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

interface FlatModel {
  id: string;
  name: string;
  provider: string;
}

function flattenModels(providers: ProviderModels[]): FlatModel[] {
  return providers.flatMap((p) =>
    p.models.map((m) => ({ id: m.id, name: m.name, provider: p.provider }))
  );
}

function ModelPreferencesSection() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useUpdateProfile();
  const { data: availableModels } = useAvailableModels();
  const [models, setModels] = React.useState<string[]>([]);
  const [newModel, setNewModel] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setModels(user?.modelPreferences ?? []);
  }, [user?.modelPreferences]);

  const allModels = React.useMemo(() => flattenModels(availableModels ?? []), [availableModels]);

  const filteredModels = React.useMemo(() => {
    const query = newModel.toLowerCase().trim();
    const candidates = allModels.filter((m) => !models.includes(m.id));
    if (!query) return candidates;
    return candidates.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query) ||
        m.provider.toLowerCase().includes(query)
    );
  }, [newModel, allModels, models]);

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Reset highlight when filtered list changes
  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredModels.length]);

  // Scroll highlighted item into view
  React.useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return;
    const item = dropdownRef.current.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, showDropdown]);

  const hasChanges = JSON.stringify(models) !== JSON.stringify(user?.modelPreferences ?? []);

  function handleSave() {
    updateProfile.mutate(
      { modelPreferences: models },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  function addModel(modelId?: string) {
    const trimmed = (modelId ?? newModel).trim();
    if (trimmed && !models.includes(trimmed)) {
      setModels([...models, trimmed]);
      setNewModel('');
      setShowDropdown(false);
    }
  }

  function removeModel(index: number) {
    setModels(models.filter((_, i) => i !== index));
  }

  function moveModel(from: number, to: number) {
    if (to < 0 || to >= models.length) return;
    const updated = [...models];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    setModels(updated);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || filteredModels.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addModel();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filteredModels.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredModels[highlightedIndex]) {
          addModel(filteredModels[highlightedIndex].id);
        } else {
          addModel();
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        break;
    }
  }

  // Determine display name for a model ID
  function getModelDisplay(modelId: string) {
    const flat = allModels.find((m) => m.id === modelId);
    if (flat) return { name: flat.name, provider: flat.provider };
    // Fallback: parse provider from ID
    const slash = modelId.indexOf('/');
    if (slash > 0) return { name: modelId.slice(slash + 1), provider: modelId.slice(0, slash) };
    return { name: modelId, provider: '' };
  }

  return (
    <SettingsSection title="Model Preferences">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Set your preferred model order. When a model encounters a billing, rate limit, or auth error,
          the system will automatically failover to the next model in this list.
        </p>

        {models.length > 0 && (
          <div className="space-y-1.5">
            {models.map((model, index) => {
              const display = getModelDisplay(model);
              return (
                <div
                  key={model}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) {
                      moveModel(dragIndex, index);
                      setDragIndex(index);
                    }
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    dragIndex === index
                      ? 'border-neutral-400 bg-neutral-50 dark:border-neutral-500 dark:bg-neutral-900'
                      : 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800'
                  } cursor-grab active:cursor-grabbing`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 font-mono text-[10px] font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm text-neutral-800 dark:text-neutral-200">
                      {display.name}
                    </span>
                    {display.provider && (
                      <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">
                        {display.provider}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveModel(index, index - 1)}
                      disabled={index === 0}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-30 dark:text-neutral-500 dark:hover:text-neutral-300"
                      title="Move up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveModel(index, index + 1)}
                      disabled={index === models.length - 1}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-30 dark:text-neutral-500 dark:hover:text-neutral-300"
                      title="Move down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeModel(index)}
                      className="rounded p-0.5 text-neutral-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400"
                      title="Remove"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative max-w-lg">
          <input
            ref={inputRef}
            type="text"
            value={newModel}
            onChange={(e) => {
              setNewModel(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            placeholder={allModels.length > 0 ? 'Search models...' : 'provider/model-id'}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
          {showDropdown && filteredModels.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            >
              {filteredModels.map((model, i) => (
                <button
                  key={model.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addModel(model.id);
                  }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                    i === highlightedIndex
                      ? 'bg-neutral-100 dark:bg-neutral-700'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-750'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-neutral-900 dark:text-neutral-100">
                      {model.name}
                    </div>
                    <div className="truncate font-mono text-xs text-neutral-400 dark:text-neutral-500">
                      {model.id}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                    {model.provider}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {allModels.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Start a session to discover available models, or type a model ID manually (e.g. provider/model-id).
          </p>
        )}

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
            <span className="text-sm text-red-600 dark:text-red-400">Failed to save</span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function ChevronUp({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
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
