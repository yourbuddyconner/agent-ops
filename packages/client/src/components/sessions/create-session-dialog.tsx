import { useState } from 'react';
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

interface CreateSessionDialogProps {
  trigger?: React.ReactNode;
}

export function CreateSessionDialog({ trigger }: CreateSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const navigate = useNavigate();
  const createSession = useCreateSession();

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
    <Dialog open={open} onOpenChange={setOpen}>
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
          <div className="py-4">
            <label
              htmlFor="workspace"
              className="mb-2 block text-sm font-medium text-neutral-700"
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!workspace.trim() || createSession.isPending}
            >
              {createSession.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
