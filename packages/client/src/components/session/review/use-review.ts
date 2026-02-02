import { useState, useCallback, useEffect } from 'react';
import type { DiffFile, ReviewResultData } from '@/hooks/use-chat';
import type { ReviewState, ReviewSummary, ReviewFinding } from './types';

interface UseReviewOptions {
  sendMessage: (content: string, model?: string) => void;
  requestReview: () => void;
  reviewResult: ReviewResultData | null;
  reviewError: string | null;
  reviewLoading: boolean;
  reviewDiffFiles: DiffFile[] | null;
  isConnected: boolean;
}

export function useReview({
  sendMessage,
  requestReview,
  reviewResult,
  reviewError,
  reviewLoading,
  reviewDiffFiles,
  isConnected,
}: UseReviewOptions) {
  const [state, setState] = useState<ReviewState>('idle');
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[] | null>(null);

  // React to review loading state from useChat
  useEffect(() => {
    if (reviewLoading && state !== 'reviewing') {
      setState('reviewing');
    }
  }, [reviewLoading, state]);

  // React to review result arriving from useChat
  useEffect(() => {
    if (reviewResult && state === 'reviewing') {
      const summary: ReviewSummary = reviewResult;
      setReview(summary);
      setDiffFiles(reviewDiffFiles);
      setState('complete');
      setError(null);

      // Auto-select first file
      if (summary.files.length > 0) {
        const sorted = [...summary.files].sort((a, b) => a.reviewOrder - b.reviewOrder);
        setSelectedFile(sorted[0].path);
      }
    }
  }, [reviewResult, reviewDiffFiles, state]);

  // React to review error arriving from useChat
  useEffect(() => {
    if (reviewError && state === 'reviewing') {
      setError(reviewError);
      setState('error');
      // Still set diffFiles if available (e.g. parse error after diff was fetched)
      if (reviewDiffFiles) {
        setDiffFiles(reviewDiffFiles);
      }
    }
  }, [reviewError, reviewDiffFiles, state]);

  const startReview = useCallback(() => {
    if (!isConnected) return;
    setError(null);
    setReview(null);
    setSelectedFile(null);
    setDiffFiles(null);
    setState('reviewing');
    requestReview();
  }, [isConnected, requestReview]);

  const applyFinding = useCallback(
    (finding: ReviewFinding) => {
      if (!isConnected) return;
      const prompt = `In \`${finding.file}\` around lines ${finding.lineStart}-${finding.lineEnd}: ${finding.title}. ${finding.description}${finding.suggestedFix ? `\n\nSuggested fix: ${finding.suggestedFix}` : ''}. Please fix this.`;
      sendMessage(prompt);

      // Mark finding as applied in review state
      setReview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          files: prev.files.map((f) => ({
            ...f,
            findings: f.findings.map((fd) =>
              fd.id === finding.id ? { ...fd, applied: true } : fd
            ),
          })),
        };
      });
    },
    [isConnected, sendMessage]
  );

  const clearReview = useCallback(() => {
    setState('idle');
    setReview(null);
    setError(null);
    setSelectedFile(null);
    setDiffFiles(null);
  }, []);

  const selectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  return {
    state,
    review,
    error,
    selectedFile,
    diffFiles,
    startReview,
    applyFinding,
    clearReview,
    selectFile,
  };
}
