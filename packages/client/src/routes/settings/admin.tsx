import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import {
  useOrgSettings,
  useUpdateOrgSettings,
  useOrgLLMKeys,
  useSetLLMKey,
  useDeleteLLMKey,
  useInvites,
  useCreateInvite,
  useDeleteInvite,
  useOrgUsers,
  useUpdateUserRole,
  useRemoveUser,
} from '@/api/admin';
import type { UserRole } from '@agent-ops/shared';

export const Route = createFileRoute('/settings/admin')({
  component: AdminSettingsPage,
});

const inputClass =
  'mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400';

const selectClass =
  'mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-400 dark:focus:ring-neutral-400';

function AdminSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // Redirect non-admins
  React.useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate({ to: '/settings' });
    }
  }, [user, navigate]);

  if (!user || user.role !== 'admin') {
    return null;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Organization"
        description="Manage your organization settings, members, and API keys"
      />

      <div className="space-y-6">
        <OrgNameSection />
        <LLMKeysSection />
        <AccessControlSection />
        <InvitesSection />
        <UsersSection currentUserId={user.id} />
      </div>
    </PageContainer>
  );
}

// --- Organization Name ---

function OrgNameSection() {
  const { data: settings } = useOrgSettings();
  const updateSettings = useUpdateOrgSettings();
  const [name, setName] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings?.name) setName(settings.name);
  }, [settings?.name]);

  const hasChanges = name !== (settings?.name ?? '');

  function handleSave() {
    updateSettings.mutate(
      { name },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <Section title="Organization">
      <div className="space-y-4">
        <div>
          <label htmlFor="org-name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Name
          </label>
          <input
            id="org-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Organization"
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!hasChanges || updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
        </div>
      </div>
    </Section>
  );
}

// --- LLM API Keys ---

const LLM_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
] as const;

function LLMKeysSection() {
  const { data: keys, isLoading } = useOrgLLMKeys();

  return (
    <Section title="LLM API Keys">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Organization-level API keys are used for all sandboxes. If not set, environment variable defaults are used.
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {LLM_PROVIDERS.map((provider) => {
              const existing = keys?.find((k) => k.provider === provider.id);
              return (
                <LLMKeyRow key={provider.id} provider={provider.id} label={provider.label} isSet={!!existing} />
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

function LLMKeyRow({ provider, label, isSet }: { provider: string; label: string; isSet: boolean }) {
  const setKey = useSetLLMKey();
  const deleteKey = useDeleteLLMKey();
  const [value, setValue] = React.useState('');
  const [editing, setEditing] = React.useState(false);

  function handleSave() {
    setKey.mutate(
      { provider, key: value },
      {
        onSuccess: () => {
          setValue('');
          setEditing(false);
        },
      }
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</div>
      {editing ? (
        <>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            className={inputClass + ' !mt-0 flex-1'}
            autoFocus
          />
          <Button onClick={handleSave} disabled={!value || setKey.isPending}>
            {setKey.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={() => { setEditing(false); setValue(''); }}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
            {isSet ? '••••••••••••' : 'Not set (using env var)'}
          </span>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {isSet ? 'Update' : 'Set'}
          </Button>
          {isSet && (
            <Button
              variant="secondary"
              onClick={() => deleteKey.mutate(provider)}
              disabled={deleteKey.isPending}
            >
              Remove
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// --- Access Control ---

function AccessControlSection() {
  const { data: settings } = useOrgSettings();
  const updateSettings = useUpdateOrgSettings();
  const [domainGating, setDomainGating] = React.useState(false);
  const [domain, setDomain] = React.useState('');
  const [emailAllowlist, setEmailAllowlist] = React.useState(false);
  const [emails, setEmails] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setDomainGating(settings.domainGatingEnabled);
      setDomain(settings.allowedEmailDomain ?? '');
      setEmailAllowlist(settings.emailAllowlistEnabled);
      setEmails(settings.allowedEmails ?? '');
    }
  }, [settings]);

  function handleSave() {
    updateSettings.mutate(
      {
        domainGatingEnabled: domainGating,
        allowedEmailDomain: domain || undefined,
        emailAllowlistEnabled: emailAllowlist,
        allowedEmails: emails || undefined,
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
    <Section title="Access Control">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Control who can sign up. If nothing is enabled, signups are open to anyone (or controlled by invites).
        </p>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="domain-gating"
            checked={domainGating}
            onChange={(e) => setDomainGating(e.target.checked)}
            className="mt-1 rounded border-neutral-300 dark:border-neutral-600"
          />
          <div>
            <label htmlFor="domain-gating" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Restrict signups to email domain
            </label>
            {domainGating && (
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
                className={inputClass}
              />
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="email-allowlist"
            checked={emailAllowlist}
            onChange={(e) => setEmailAllowlist(e.target.checked)}
            className="mt-1 rounded border-neutral-300 dark:border-neutral-600"
          />
          <div>
            <label htmlFor="email-allowlist" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Use email allowlist
            </label>
            {emailAllowlist && (
              <textarea
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="user1@example.com, user2@example.com"
                rows={3}
                className={inputClass + ' !max-w-lg'}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
        </div>
      </div>
    </Section>
  );
}

// --- Invites ---

function InvitesSection() {
  const { data: invites, isLoading } = useInvites();
  const createInvite = useCreateInvite();
  const deleteInvite = useDeleteInvite();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('member');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    createInvite.mutate(
      { email, role },
      { onSuccess: () => { setEmail(''); setRole('member'); } }
    );
  }

  return (
    <Section title="Invites">
      <div className="space-y-4">
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="invite-email" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={selectClass}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={!email || createInvite.isPending}>
            {createInvite.isPending ? 'Sending...' : 'Send Invite'}
          </Button>
        </form>

        {createInvite.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to create invite. The email may already have a pending invite.
          </p>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
            ))}
          </div>
        ) : invites && invites.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Email</th>
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Role</th>
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Status</th>
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Expires</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const isExpired = new Date(invite.expiresAt) < new Date();
                const isAccepted = !!invite.acceptedAt;
                const status = isAccepted ? 'Accepted' : isExpired ? 'Expired' : 'Pending';

                return (
                  <tr
                    key={invite.id}
                    className={`border-b border-neutral-100 dark:border-neutral-700/50 ${isExpired ? 'opacity-50' : ''}`}
                  >
                    <td className="py-2 text-neutral-900 dark:text-neutral-100">{invite.email}</td>
                    <td className="py-2 capitalize text-neutral-700 dark:text-neutral-300">{invite.role}</td>
                    <td className="py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          isAccepted
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : isExpired
                              ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-2 text-neutral-500 dark:text-neutral-400">
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right">
                      {!isAccepted && (
                        <Button
                          variant="secondary"
                          onClick={() => deleteInvite.mutate(invite.id)}
                          disabled={deleteInvite.isPending}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No invites yet.</p>
        )}
      </div>
    </Section>
  );
}

// --- Users ---

function UsersSection({ currentUserId }: { currentUserId: string }) {
  const { data: users, isLoading } = useOrgUsers();
  const updateRole = useUpdateUserRole();
  const removeUser = useRemoveUser();
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const adminCount = users?.filter((u) => u.role === 'admin').length ?? 0;

  return (
    <Section title="Members">
      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
            ))}
          </div>
        ) : users && users.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">User</th>
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Role</th>
                <th className="pb-2 text-left font-medium text-neutral-500 dark:text-neutral-400">Joined</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                const isLastAdmin = u.role === 'admin' && adminCount <= 1;

                return (
                  <tr key={u.id} className="border-b border-neutral-100 dark:border-neutral-700/50">
                    <td className="py-2">
                      <div>
                        <span className="text-neutral-900 dark:text-neutral-100">
                          {u.name || u.email}
                        </span>
                        {u.name && (
                          <span className="ml-2 text-neutral-400 dark:text-neutral-500">{u.email}</span>
                        )}
                        {isSelf && (
                          <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">(you)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          updateRole.mutate({ userId: u.id, role: e.target.value as UserRole })
                        }
                        disabled={isSelf || isLastAdmin || updateRole.isPending}
                        className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    </td>
                    <td className="py-2 text-neutral-500 dark:text-neutral-400">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right">
                      {!isSelf && !isLastAdmin && (
                        <>
                          {confirmDelete === u.id ? (
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-red-600 dark:text-red-400">Confirm?</span>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  removeUser.mutate(u.id, { onSettled: () => setConfirmDelete(null) });
                                }}
                                disabled={removeUser.isPending}
                              >
                                Remove
                              </Button>
                              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button variant="secondary" onClick={() => setConfirmDelete(u.id)}>
                              Remove
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No users found.</p>
        )}

        {updateRole.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to update role. {(updateRole.error as Error)?.message}
          </p>
        )}
        {removeUser.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to remove user. {(removeUser.error as Error)?.message}
          </p>
        )}
      </div>
    </Section>
  );
}

// --- Shared Section component ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}
