import { useTerminateSession } from '@/api/sessions';
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
