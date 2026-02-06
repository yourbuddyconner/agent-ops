import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

interface FullScreenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Full-screen modal for mobile panels (Terminal, Logs, etc.)
 * Takes over the entire viewport with a header and close button.
 * Touch-optimized with 44px minimum tap targets.
 */
export function FullScreenModal({
  open,
  onOpenChange,
  title,
  children,
  className,
}: FullScreenModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-black/80',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'duration-200'
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed inset-0 z-[60] flex flex-col',
            'bg-surface-0 dark:bg-surface-0',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2',
            'duration-200',
            className
          )}
        >
          {/* Header - taller for mobile touch */}
          <div className={cn(
            'flex h-14 shrink-0 items-center justify-between',
            'border-b border-border bg-surface-0 dark:bg-surface-1',
            'px-4'
          )}>
            <Dialog.Title className={cn(
              'font-mono text-[13px] font-semibold tracking-tight',
              'text-neutral-900 dark:text-neutral-100',
              'flex items-center gap-2.5'
            )}>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 dark:bg-accent/15">
                <TerminalIcon className="h-3.5 w-3.5 text-accent" />
              </div>
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className={cn(
                  // 44px touch target
                  'flex h-11 w-11 -mr-2 items-center justify-center rounded-lg',
                  'text-neutral-500 dark:text-neutral-400',
                  'transition-all duration-150',
                  'active:scale-95 active:bg-neutral-100 dark:active:bg-neutral-800'
                )}
                aria-label="Close"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          {/* Content with safe area padding for notched devices */}
          <div className="flex-1 min-h-0 overflow-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}
