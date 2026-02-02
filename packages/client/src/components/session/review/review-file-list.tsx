import { cn } from '@/lib/cn';
import type { ReviewFileSummary, ReviewFinding } from './types';

interface ReviewFileListProps {
  files: ReviewFileSummary[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export function ReviewFileList({ files, selectedFile, onSelectFile }: ReviewFileListProps) {
  const sorted = [...files].sort((a, b) => a.reviewOrder - b.reviewOrder);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {sorted.map((file, i) => {
        const isActive = file.path === selectedFile;
        const findingCounts = countBySeverity(file.findings);

        return (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelectFile(file.path)}
            className={cn(
              'flex items-start gap-2 border-b border-neutral-100 px-3 py-2 text-left transition-colors dark:border-neutral-800/50',
              isActive
                ? 'bg-accent/5 dark:bg-accent/10'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/30'
            )}
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-neutral-100 font-mono text-[9px] font-bold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <FileStatusBadge file={file} />
                <span className="truncate font-mono text-[11px] text-neutral-800 dark:text-neutral-200">
                  {file.path.split('/').pop()}
                </span>
              </div>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                {file.path}
              </span>
              {file.findings.length > 0 && (
                <div className="mt-1 flex gap-1">
                  {findingCounts.critical > 0 && (
                    <SeverityPill count={findingCounts.critical} severity="critical" />
                  )}
                  {findingCounts.warning > 0 && (
                    <SeverityPill count={findingCounts.warning} severity="warning" />
                  )}
                  {findingCounts.suggestion > 0 && (
                    <SeverityPill count={findingCounts.suggestion} severity="suggestion" />
                  )}
                  {findingCounts.nitpick > 0 && (
                    <SeverityPill count={findingCounts.nitpick} severity="nitpick" />
                  )}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FileStatusBadge({ file }: { file: ReviewFileSummary }) {
  const isAdded = file.linesDeleted === 0 && file.linesAdded > 0;
  const isDeleted = file.linesAdded === 0 && file.linesDeleted > 0;
  const status = isAdded ? 'added' : isDeleted ? 'deleted' : 'modified';

  const config = {
    added: { label: 'A', bg: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
    modified: { label: 'M', bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
    deleted: { label: 'D', bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  }[status];

  return (
    <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold', config.bg)}>
      {config.label}
    </span>
  );
}

function SeverityPill({ count, severity }: { count: number; severity: ReviewFinding['severity'] }) {
  const colors = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    suggestion: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    nitpick: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  }[severity];

  return (
    <span className={cn('inline-flex h-4 items-center rounded px-1 font-mono text-[9px] font-medium', colors)}>
      {count}
    </span>
  );
}

function countBySeverity(findings: ReviewFinding[]) {
  const counts = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
  for (const f of findings) {
    if (f.severity in counts) {
      counts[f.severity]++;
    }
  }
  return counts;
}
