import { useTerminateSession, useSessionChildren } from '@/api/sessions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TerminateSessionDialogProps {
  sessionId: string;
  sessionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTerminated?: () => void;
}

export function TerminateSessionDialog({
  sessionId,
  sessionName,
  open,
  onOpenChange,
  onTerminated,
}: TerminateSessionDialogProps) {
  const terminateSession = useTerminateSession();
  const { data: children } = useSessionChildren(sessionId);

  const activeChildren = children?.filter(
    (c) => c.status !== 'terminated' && c.status !== 'archived' && c.status !== 'hibernated',
  ) ?? [];

  const handleTerminate = async () => {
    try {
      await terminateSession.mutateAsync(sessionId);
      onOpenChange(false);
      onTerminated?.();
    } catch {
      // Error handling is done by the mutation
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Terminate Session</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to terminate the session "{sessionName}"? The
            sandbox will be stopped.
          </AlertDialogDescription>
          {activeChildren.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
              This will also terminate {activeChildren.length} active child{' '}
              {activeChildren.length === 1 ? 'session' : 'sessions'}:
              <ul className="mt-1 list-inside list-disc">
                {activeChildren.map((c) => (
                  <li key={c.id} className="truncate font-mono text-xs">
                    {c.title || c.workspace}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleTerminate}
            disabled={terminateSession.isPending}
          >
            {terminateSession.isPending ? 'Terminating...' : 'Terminate'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
