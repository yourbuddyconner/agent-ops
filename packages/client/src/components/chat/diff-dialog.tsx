import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';
import type { DiffFile } from '@/hooks/use-chat';

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: DiffFile[] | null;
  loading: boolean;
}

export function DiffDialog({ open, onOpenChange, files, loading }: DiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden dark:border-neutral-700 dark:bg-neutral-900">
        <DialogHeader>
          <DialogTitle>Changes</DialogTitle>
          <DialogDescription>
            Files modified during this session
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 mt-2 max-h-[60vh] overflow-y-auto px-6">
          {loading && <DiffSkeleton />}

          {!loading && (!files || files.length === 0) && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
                No file changes detected.
              </p>
            </div>
          )}

          {!loading && files && files.length > 0 && (
            <div className="space-y-1">
              {files.map((file) => (
                <DiffFileEntry key={file.path} file={file} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiffFileEntry({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(false);
  const hasDiff = !!file.diff;

  return (
    <div className="rounded border border-neutral-200 dark:border-neutral-700">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => hasDiff && setExpanded(!expanded)}
        disabled={!hasDiff}
      >
        <StatusBadge status={file.status} />
        <span className="flex-1 truncate font-mono text-[12px] text-neutral-800 dark:text-neutral-200">
          {file.path}
        </span>
        {hasDiff && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              'shrink-0 text-neutral-400 transition-transform',
              expanded && 'rotate-180'
            )}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {expanded && file.diff && (
        <div className="border-t border-neutral-200 dark:border-neutral-700">
          <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
            {file.diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn({
                  'text-green-700 dark:text-green-400': line.startsWith('+') && !line.startsWith('+++'),
                  'text-red-600 dark:text-red-400': line.startsWith('-') && !line.startsWith('---'),
                  'text-blue-600 dark:text-blue-400': line.startsWith('@@'),
                  'text-neutral-500 dark:text-neutral-400': !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@'),
                })}
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DiffFile['status'] }) {
  const config = {
    added: { label: 'A', bg: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
    modified: { label: 'M', bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
    deleted: { label: 'D', bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  }[status];

  return (
    <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold', config.bg)}>
      {config.label}
    </span>
  );
}

function DiffSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 dark:border-neutral-700">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}
