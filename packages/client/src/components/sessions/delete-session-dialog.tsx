import { useDeleteSession } from '@/api/sessions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface DeleteSessionDialogProps {
  sessionId: string;
  sessionName: string;
  trigger?: React.ReactNode;
  onDeleted?: () => void;
}

export function DeleteSessionDialog({
  sessionId,
  sessionName,
  trigger,
  onDeleted,
}: DeleteSessionDialogProps) {
  const deleteSession = useDeleteSession();

  const handleDelete = async () => {
    try {
      await deleteSession.mutateAsync(sessionId);
      onDeleted?.();
    } catch {
      // Error handling is done by the mutation
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger ?? <Button variant="destructive">Delete</Button>}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Session</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the session "{sessionName}"? This
            action cannot be undone and all messages will be permanently lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteSession.isPending}
          >
            {deleteSession.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
