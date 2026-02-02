import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import type { ReviewFinding } from './types';

interface FindingCardProps {
  finding: ReviewFinding;
  compact?: boolean;
  onApply: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

export function FindingCard({ finding, compact, onApply, onNavigate, onClose }: FindingCardProps) {
  const severityConfig = {
    critical: {
      label: 'Critical',
      bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    },
    warning: {
      label: 'Warning',
      bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    },
    suggestion: {
      label: 'Suggestion',
      bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    },
    nitpick: {
      label: 'Nitpick',
      bg: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
    },
  }[finding.severity];

  return (
    <div
      className={cn(
        'rounded border border-neutral-200 dark:border-neutral-700',
        finding.applied && 'opacity-60',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
              severityConfig.bg
            )}
          >
            {severityConfig.label}
          </span>
          <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {finding.category}
          </span>
          {finding.applied && (
            <span className="inline-flex items-center gap-0.5 rounded bg-green-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
              <CheckIcon className="h-2.5 w-2.5" />
              Applied
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-5 w-5 p-0 text-neutral-400 hover:text-neutral-600"
            >
              <XIcon className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <p className={cn('mt-1.5 font-sans text-[12px] font-medium text-neutral-900 dark:text-neutral-100', compact && 'text-[11px]')}>
        {finding.title}
      </p>

      {!compact && (
        <p className="mt-1 font-sans text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
          {finding.description}
        </p>
      )}

      {!compact && finding.suggestedFix && (
        <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {finding.suggestedFix}
        </pre>
      )}

      {!compact && (
        <div className="mt-1 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
          {finding.file}:{finding.lineStart}
          {finding.lineEnd !== finding.lineStart && `-${finding.lineEnd}`}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {!finding.applied && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onApply}
            className="h-5 px-2 text-[10px]"
          >
            Apply Fix
          </Button>
        )}
        {onNavigate && !compact && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigate}
            className="h-5 px-2 text-[10px] text-neutral-500"
          >
            Go to line
          </Button>
        )}
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
