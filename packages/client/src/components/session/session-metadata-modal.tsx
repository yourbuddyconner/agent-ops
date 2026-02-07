import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { SessionMetadataSidebar } from './session-metadata-sidebar';
import { OrchestratorMetadataSidebar } from './orchestrator-metadata-sidebar';
import type { ConnectedUser } from '@/hooks/use-chat';

interface SessionMetadataModalProps {
  sessionId: string;
  connectedUsers?: ConnectedUser[];
  selectedModel?: string;
  isOrchestrator?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal wrapper for session metadata on mobile.
 * Displays session info in a centered card dialog.
 * Touch-optimized with generous spacing.
 */
export function SessionMetadataModal({
  sessionId,
  connectedUsers,
  selectedModel,
  isOrchestrator = false,
  open,
  onOpenChange,
}: SessionMetadataModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[65]',
            'bg-black/60 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'duration-200'
          )}
        />
        <Dialog.Content
          className={cn(
            'session-metadata-mobile fixed inset-x-2 top-[6%] bottom-[4%] z-[65]',
            'flex flex-col',
            'rounded-xl border border-border/80 bg-surface-0',
            'shadow-2xl shadow-black/20',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2',
            'duration-200',
            'dark:bg-surface-1 dark:border-neutral-700/50'
          )}
        >
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-4">
            <Dialog.Title className="flex items-center gap-2.5 font-mono text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                <InfoIcon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
              </div>
              {isOrchestrator ? 'Orchestrator Info' : 'Session Info'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className={cn(
                  // 44px touch target
                  'flex h-10 w-10 -mr-1.5 items-center justify-center rounded-lg',
                  'text-neutral-400 dark:text-neutral-500',
                  'transition-all duration-150',
                  'active:scale-95 active:bg-neutral-100 dark:active:bg-neutral-800'
                )}
                aria-label="Close"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content - reuse existing sidebar component with overridden styling */}
          <div className={cn(
            'flex-1 min-h-0 overflow-y-auto overscroll-contain',
            // Override sidebar width and border
            '[&>div]:w-full [&>div]:border-l-0 [&>div]:h-auto',
            // Better touch scrolling on iOS
            '-webkit-overflow-scrolling-touch'
          )}>
            {isOrchestrator ? (
              <OrchestratorMetadataSidebar
                sessionId={sessionId}
                connectedUsers={connectedUsers}
                selectedModel={selectedModel}
                embedded
              />
            ) : (
              <SessionMetadataSidebar
                sessionId={sessionId}
                connectedUsers={connectedUsers}
                selectedModel={selectedModel}
                embedded
              />
            )}
          </div>

          {/* Bottom safe area for gesture indicator */}
          <div className="flex h-6 shrink-0 items-center justify-center border-t border-border/30 bg-surface-1/50 dark:bg-surface-2/30">
            <div className="h-1 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700" />
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

function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
