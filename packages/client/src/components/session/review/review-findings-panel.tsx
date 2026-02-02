import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { ReviewSummary, ReviewFinding, SeverityFilter } from './types';
import { FindingCard } from './finding-card';

interface ReviewFindingsPanelProps {
  review: ReviewSummary;
  selectedFile: string | null;
  onApplyFinding: (finding: ReviewFinding) => void;
  onNavigateToFinding: (finding: ReviewFinding) => void;
}

export function ReviewFindingsPanel({
  review,
  selectedFile,
  onApplyFinding,
  onNavigateToFinding,
}: ReviewFindingsPanelProps) {
  const [filter, setFilter] = useState<SeverityFilter>('all');

  // Get findings for selected file or all files
  const allFindings = selectedFile
    ? review.files.find((f) => f.path === selectedFile)?.findings || []
    : review.files.flatMap((f) => f.findings);

  const filtered =
    filter === 'all' ? allFindings : allFindings.filter((f) => f.severity === filter);

  return (
    <div className="flex h-full flex-col">
      {/* Stats bar */}
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <FilterTab
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label="All"
          count={allFindings.length}
        />
        {review.stats.critical > 0 && (
          <FilterTab
            active={filter === 'critical'}
            onClick={() => setFilter('critical')}
            label="Critical"
            count={review.stats.critical}
            color="text-red-600 dark:text-red-400"
          />
        )}
        {review.stats.warning > 0 && (
          <FilterTab
            active={filter === 'warning'}
            onClick={() => setFilter('warning')}
            label="Warning"
            count={review.stats.warning}
            color="text-amber-600 dark:text-amber-400"
          />
        )}
        {review.stats.suggestion > 0 && (
          <FilterTab
            active={filter === 'suggestion'}
            onClick={() => setFilter('suggestion')}
            label="Suggestion"
            count={review.stats.suggestion}
            color="text-blue-600 dark:text-blue-400"
          />
        )}
        {review.stats.nitpick > 0 && (
          <FilterTab
            active={filter === 'nitpick'}
            onClick={() => setFilter('nitpick')}
            label="Nitpick"
            count={review.stats.nitpick}
            color="text-neutral-500 dark:text-neutral-400"
          />
        )}
      </div>

      {/* Findings list */}
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
              {allFindings.length === 0 ? 'No findings' : 'No findings match filter'}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                onApply={() => onApplyFinding(finding)}
                onNavigate={() => onNavigateToFinding(finding)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors',
        active
          ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
      )}
    >
      <span className={color}>{label}</span>
      <span className="text-neutral-400 dark:text-neutral-500">{count}</span>
    </button>
  );
}
