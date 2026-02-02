import { Button } from '@/components/ui/button';
import type { ReviewState } from './types';

interface ReviewControlsProps {
  state: ReviewState;
  onStartReview: () => void;
  onClearReview: () => void;
  isConnected: boolean;
}

export function ReviewControls({
  state,
  onStartReview,
  onClearReview,
  isConnected,
}: ReviewControlsProps) {
  const isRunning = state === 'loading-diff' || state === 'reviewing';

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-neutral-200 bg-surface-0 px-3 dark:border-neutral-800 dark:bg-surface-0">
      <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
        All changes
      </span>
      <div className="flex-1" />
      {state === 'complete' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearReview}
          className="h-6 px-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Clear
        </Button>
      )}
      <Button
        variant={state === 'idle' || state === 'error' ? 'primary' : 'secondary'}
        size="sm"
        onClick={onStartReview}
        disabled={!isConnected || isRunning}
        className="h-6 px-3 text-[11px]"
      >
        {isRunning ? 'Reviewing...' : state === 'complete' ? 'Re-run' : 'Run Review'}
      </Button>
    </div>
  );
}
