import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useCreateSession } from '@/api/sessions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface CreateSessionDialogProps {
  trigger?: React.ReactNode;
}

const LOADING_MESSAGES = [
  'Creating session...',
  'Starting sandbox...',
  'Building image (this may take a minute)...',
  'Still working...',
];

export function CreateSessionDialog({ trigger }: CreateSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const navigate = useNavigate();
  const createSession = useCreateSession();

  // Track elapsed time during creation
  useEffect(() => {
    if (!createSession.isPending) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [createSession.isPending]);

  // Get loading message based on elapsed time
  const getLoadingMessage = () => {
    if (elapsedSeconds < 3) return LOADING_MESSAGES[0];
    if (elapsedSeconds < 8) return LOADING_MESSAGES[1];
    if (elapsedSeconds < 30) return LOADING_MESSAGES[2];
    return LOADING_MESSAGES[3];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace.trim()) return;

    try {
      const result = await createSession.mutateAsync({ workspace });
      setOpen(false);
      setWorkspace('');
      navigate({ to: '/sessions/$sessionId', params: { sessionId: result.session.id } });
    } catch {
      // Error handling is done by the mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !createSession.isPending && setOpen(v)}>
      <DialogTrigger asChild>
        {trigger ?? <Button>New Session</Button>}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Session</DialogTitle>
            <DialogDescription>
              Start a new AI agent session with a workspace.
            </DialogDescription>
          </DialogHeader>

          {createSession.isPending ? (
            <div className="py-8">
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-accent" />
                <div className="text-center">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    {getLoadingMessage()}
                  </p>
                  <p className="mt-1 font-mono text-xs text-neutral-500">
                    {elapsedSeconds}s elapsed
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <label
                htmlFor="workspace"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Workspace
              </label>
              <Input
                id="workspace"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                placeholder="my-project"
                autoFocus
              />
              {createSession.isError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  Failed to create session. Please try again.
                </p>
              )}
            </div>
          )}

          <DialogFooter className={cn(createSession.isPending && 'justify-center')}>
            {createSession.isPending ? (
              <p className="text-xs text-neutral-500">
                Please wait, do not close this dialog
              </p>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!workspace.trim()}
                >
                  Create
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
