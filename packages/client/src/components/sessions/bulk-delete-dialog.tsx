import { useBulkDeleteSessions } from '@/api/sessions';
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

interface BulkDeleteDialogProps {
  sessionIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function BulkDeleteDialog({
  sessionIds,
  open,
  onOpenChange,
  onDeleted,
}: BulkDeleteDialogProps) {
  const bulkDelete = useBulkDeleteSessions();
  const count = sessionIds.length;

  const handleDelete = async () => {
    try {
      await bulkDelete.mutateAsync(sessionIds);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // Error handling is done by the mutation
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {count} session{count !== 1 ? 's' : ''}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete {count} session{count !== 1 ? 's' : ''}.
            Running sessions will be terminated first. All messages and data will
            be permanently lost. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={bulkDelete.isPending}
          >
            {bulkDelete.isPending
              ? 'Deleting...'
              : `Delete ${count} session${count !== 1 ? 's' : ''}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
