import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { useCreateOrchestrator, useCheckHandle } from '@/api/orchestrator';

export const Route = createFileRoute('/orchestrator-setup')({
  component: OrchestratorSetupPage,
});

function useDebounced(value: string, delayMs: number) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function OrchestratorSetupPage() {
  const navigate = useNavigate();
  const createOrchestrator = useCreateOrchestrator();

  const [name, setName] = React.useState('');
  const [handle, setHandle] = React.useState('');
  const [customInstructions, setCustomInstructions] = React.useState('');

  const debouncedHandle = useDebounced(handle, 400);
  const handleCheck = useCheckHandle(debouncedHandle);
  const handleTaken = debouncedHandle.length >= 2 && handleCheck.data?.available === false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (handleTaken) return;

    createOrchestrator.mutate(
      {
        name,
        handle: handle.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        customInstructions: customInstructions || undefined,
      },
      {
        onSuccess: (data) => {
          navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: data.sessionId },
          });
        },
      }
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Set Up Your Orchestrator"
        description="Create your personal AI assistant that manages tasks and coordinates agent sessions"
      />

      <div className="mx-auto max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="orch-name"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Name
                </label>
                <input
                  id="orch-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jarvis"
                  className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  Your orchestrator's display name
                </p>
              </div>

              <div>
                <label
                  htmlFor="orch-handle"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Handle
                </label>
                <div className="mt-1 flex items-center">
                  <span className="mr-1 text-sm text-neutral-400">@</span>
                  <input
                    id="orch-handle"
                    type="text"
                    required
                    value={handle}
                    onChange={(e) =>
                      setHandle(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                      )
                    }
                    placeholder="jarvis"
                    className={`block w-full rounded-md border bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 ${
                      handleTaken
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500 dark:focus:border-red-400 dark:focus:ring-red-400'
                        : 'border-neutral-300 focus:border-neutral-500 focus:ring-neutral-500 dark:border-neutral-600 dark:focus:border-neutral-400 dark:focus:ring-neutral-400'
                    }`}
                  />
                </div>
                {handleTaken ? (
                  <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                    Handle @{debouncedHandle} is already taken
                  </p>
                ) : debouncedHandle.length >= 2 && handleCheck.data?.available ? (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                    @{debouncedHandle} is available
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    Lowercase letters, numbers, dashes, and underscores only
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="orch-instructions"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Custom Instructions (optional)
                </label>
                <textarea
                  id="orch-instructions"
                  rows={4}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Any special instructions for your orchestrator..."
                  className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
                />
              </div>
            </div>
          </div>

          {createOrchestrator.isError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {(createOrchestrator.error as any)?.message || 'Failed to create orchestrator'}
            </div>
          )}

          <Button
            type="submit"
            disabled={!name || !handle || handleTaken || createOrchestrator.isPending}
            className="w-full"
          >
            {createOrchestrator.isPending ? 'Creating...' : 'Create Orchestrator'}
          </Button>
        </form>
      </div>
    </PageContainer>
  );
}
