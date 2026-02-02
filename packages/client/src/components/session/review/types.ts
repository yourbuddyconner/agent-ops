export interface ReviewFinding {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
  category: string;
  title: string;
  description: string;
  suggestedFix?: string;
  applied?: boolean;
}

export interface ReviewFileSummary {
  path: string;
  summary: string;
  reviewOrder: number;
  findings: ReviewFinding[];
  linesAdded: number;
  linesDeleted: number;
}

export interface ReviewSummary {
  files: ReviewFileSummary[];
  overallSummary: string;
  stats: { critical: number; warning: number; suggestion: number; nitpick: number };
}

export type ReviewState = 'idle' | 'reviewing' | 'complete' | 'error';

export type SeverityFilter = 'all' | ReviewFinding['severity'];
