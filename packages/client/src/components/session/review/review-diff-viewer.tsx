import { useState, useCallback } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { DiffFile } from '@/hooks/use-chat';
import type { ReviewFinding } from './types';
import { FindingCard } from './finding-card';
import { usePierreTheme } from '@/hooks/use-pierre-theme';

interface ReviewDiffViewerProps {
  diffFile: DiffFile | undefined;
  findings: ReviewFinding[];
  onApplyFinding: (finding: ReviewFinding) => void;
}

interface FindingAnnotation {
  finding: ReviewFinding;
}

export function ReviewDiffViewer({ diffFile, findings, onApplyFinding }: ReviewDiffViewerProps) {
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const theme = usePierreTheme();

  const toggleFinding = useCallback((id: string) => {
    setExpandedFinding((prev) => (prev === id ? null : id));
  }, []);

  if (!diffFile || !diffFile.diff) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
          No diff available for this file
        </span>
      </div>
    );
  }

  // Map findings to Pierre line annotations
  const lineAnnotations: DiffLineAnnotation<FindingAnnotation>[] = findings.map((finding) => ({
    side: 'additions' as const,
    lineNumber: finding.lineStart,
    metadata: { finding },
  }));

  const renderAnnotation = (annotation: DiffLineAnnotation<FindingAnnotation>) => {
    const { finding } = annotation.metadata;
    const isExpanded = expandedFinding === finding.id;

    if (isExpanded) {
      return (
        <div style={{ borderLeft: '2px solid #d97706', padding: '8px', background: 'var(--color-surface-1, rgba(0,0,0,0.05))' }}>
          <FindingCard
            finding={finding}
            compact
            onApply={() => onApplyFinding(finding)}
            onClose={() => setExpandedFinding(null)}
          />
        </div>
      );
    }

    return (
      <button
        onClick={() => toggleFinding(finding.id)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
      >
        <SeverityDot severity={finding.severity} />
        <span>{finding.title}</span>
      </button>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <PatchDiff
        patch={diffFile.diff}
        options={{ theme, diffStyle: 'unified', overflow: 'scroll' }}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
      />
    </div>
  );
}

function SeverityDot({ severity }: { severity: ReviewFinding['severity'] }) {
  const colors = {
    critical: '#ef4444',
    warning: '#f59e0b',
    suggestion: '#3b82f6',
    nitpick: '#a3a3a3',
  }[severity];

  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: colors,
      }}
    />
  );
}

