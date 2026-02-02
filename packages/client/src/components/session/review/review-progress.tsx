import type { ReviewState } from './types';

interface ReviewProgressProps {
  state: ReviewState;
}

export function ReviewProgress({ state }: ReviewProgressProps) {
  const message =
    state === 'loading-diff'
      ? 'Loading diff...'
      : state === 'reviewing'
        ? 'Analyzing changes...'
        : 'Processing...';

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <SpinnerIcon className="h-5 w-5 animate-spin text-neutral-400" />
      <span className="font-mono text-[12px] text-neutral-500 dark:text-neutral-400">
        {message}
      </span>
    </div>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
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
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
