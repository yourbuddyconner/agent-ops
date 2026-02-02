import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { DiffFile } from '@/hooks/use-chat';
import type { ReviewFinding } from './types';
import { FindingCard } from './finding-card';

interface ReviewDiffViewerProps {
  diffFile: DiffFile | undefined;
  findings: ReviewFinding[];
  onApplyFinding: (finding: ReviewFinding) => void;
}

export function ReviewDiffViewer({ diffFile, findings, onApplyFinding }: ReviewDiffViewerProps) {
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

  if (!diffFile || !diffFile.diff) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
          No diff available for this file
        </span>
      </div>
    );
  }

  const lines = diffFile.diff.split('\n');

  // Map findings to line numbers for gutter markers
  const findingsByLine = new Map<number, ReviewFinding[]>();
  // Track which line is the first in each finding's range (render card only there)
  const findingFirstLine = new Map<string, number>();
  for (const finding of findings) {
    findingFirstLine.set(finding.id, finding.lineStart);
    for (let line = finding.lineStart; line <= finding.lineEnd; line++) {
      const existing = findingsByLine.get(line) || [];
      existing.push(finding);
      findingsByLine.set(line, existing);
    }
  }

  // Parse diff to extract line numbers
  let currentLine = 0;

  return (
    <div className="h-full overflow-auto">
      <pre className="p-3 font-mono text-[11px] leading-relaxed">
        {lines.map((line, i) => {
          // Track line numbers from hunk headers
          const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
          if (hunkMatch) {
            currentLine = parseInt(hunkMatch[1], 10) - 1;
          }

          // Increment line number for non-deleted lines
          if (!line.startsWith('-') && !line.startsWith('---') && !line.startsWith('@@')) {
            currentLine++;
          }

          const lineFindings = findingsByLine.get(currentLine);
          const highestSeverity = lineFindings
            ? getHighestSeverity(lineFindings)
            : null;
          const hasFindings = lineFindings && lineFindings.length > 0;
          const isExpanded = lineFindings?.some((f) => f.id === expandedFinding);

          return (
            <div key={i}>
              <div
                className={cn(
                  'flex',
                  {
                    'text-green-700 dark:text-green-400':
                      line.startsWith('+') && !line.startsWith('+++'),
                    'text-red-600 dark:text-red-400':
                      line.startsWith('-') && !line.startsWith('---'),
                    'text-blue-600 dark:text-blue-400': line.startsWith('@@'),
                    'text-neutral-500 dark:text-neutral-400':
                      !line.startsWith('+') &&
                      !line.startsWith('-') &&
                      !line.startsWith('@@'),
                  },
                  hasFindings && 'bg-amber-50/50 dark:bg-amber-900/10'
                )}
              >
                {/* Gutter marker */}
                <span className="w-5 shrink-0 text-center">
                  {hasFindings && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFinding(
                          expandedFinding === lineFindings![0].id
                            ? null
                            : lineFindings![0].id
                        )
                      }
                      className="inline-block"
                      title={`${lineFindings!.length} finding(s)`}
                    >
                      <SeverityDot severity={highestSeverity!} />
                    </button>
                  )}
                </span>
                <span className="flex-1">{line}</span>
              </div>
              {/* Inline finding expansion — only on the first line of the finding's range */}
              {isExpanded &&
                lineFindings!
                  .filter((f) => f.id === expandedFinding && findingFirstLine.get(f.id) === currentLine)
                  .map((finding) => (
                    <div
                      key={finding.id}
                      className="ml-5 border-l-2 border-amber-300 bg-surface-1 p-2 dark:border-amber-700 dark:bg-surface-2"
                    >
                      <FindingCard
                        finding={finding}
                        compact
                        onApply={() => onApplyFinding(finding)}
                        onClose={() => setExpandedFinding(null)}
                      />
                    </div>
                  ))}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function SeverityDot({ severity }: { severity: ReviewFinding['severity'] }) {
  const colors = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    suggestion: 'bg-blue-500',
    nitpick: 'bg-neutral-400',
  }[severity];

  return <span className={cn('inline-block h-2 w-2 rounded-full', colors)} />;
}

function getHighestSeverity(findings: ReviewFinding[]): ReviewFinding['severity'] {
  const order: ReviewFinding['severity'][] = ['critical', 'warning', 'suggestion', 'nitpick'];
  for (const sev of order) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return 'nitpick';
}
