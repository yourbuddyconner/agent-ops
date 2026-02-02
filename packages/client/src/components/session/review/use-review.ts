import { useState, useCallback, useEffect, useRef } from 'react';
import type { DiffFile } from '@/hooks/use-chat';
import type { Message } from '@/api/types';
import type { ReviewState, ReviewSummary, ReviewFinding, ReviewFileSummary } from './types';

const REVIEW_PROMPT = `You are a code reviewer. Analyze the following diff and produce a structured JSON review.

Return ONLY a fenced JSON block (\`\`\`json ... \`\`\`) with this exact structure:

{
  "overallSummary": "Brief summary of all changes",
  "files": [
    {
      "path": "file/path.ts",
      "summary": "What changed in this file",
      "reviewOrder": 1,
      "linesAdded": 10,
      "linesDeleted": 5,
      "findings": [
        {
          "id": "f1",
          "file": "file/path.ts",
          "lineStart": 10,
          "lineEnd": 15,
          "severity": "warning",
          "category": "logic",
          "title": "Short title",
          "description": "Detailed description of the issue",
          "suggestedFix": "Optional code or description of fix"
        }
      ]
    }
  ],
  "stats": { "critical": 0, "warning": 1, "suggestion": 0, "nitpick": 0 }
}

Severity levels:
- critical: Bugs, security issues, data loss risks
- warning: Logic errors, performance problems, missing error handling
- suggestion: Better approaches, readability improvements
- nitpick: Style, naming, minor preferences

Categories: logic, security, performance, error-handling, types, style, naming, documentation, testing, architecture

Review these changes:

`;

interface UseReviewOptions {
  sendMessage: (content: string, model?: string) => void;
  requestDiff: () => void;
  messages: Message[];
  diffData: DiffFile[] | null;
  diffLoading: boolean;
  isConnected: boolean;
}

export function useReview({
  sendMessage,
  requestDiff,
  messages,
  diffData,
  diffLoading,
  isConnected,
}: UseReviewOptions) {
  const [state, setState] = useState<ReviewState>('idle');
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[] | null>(null);

  // Track the message count when we sent the review prompt so we can watch for the response
  const reviewPromptIndexRef = useRef<number>(-1);
  const waitingForResponseRef = useRef(false);

  // When diff data arrives while we're loading-diff, proceed to send the review prompt
  useEffect(() => {
    if (state === 'loading-diff' && !diffLoading && diffData) {
      setDiffFiles(diffData);

      if (diffData.length === 0) {
        setError('No file changes to review.');
        setState('error');
        return;
      }

      // Build the diff text
      const diffText = diffData
        .map((f) => `--- ${f.status.toUpperCase()}: ${f.path} ---\n${f.diff || '(no diff)'}`)
        .join('\n\n');

      const prompt = REVIEW_PROMPT + diffText;

      // Record current message count before sending
      reviewPromptIndexRef.current = messages.length;
      waitingForResponseRef.current = true;
      setState('reviewing');
      sendMessage(prompt);
    }
  }, [state, diffLoading, diffData, messages.length, sendMessage]);

  // Watch for the agent's response after we sent the review prompt
  useEffect(() => {
    if (!waitingForResponseRef.current || reviewPromptIndexRef.current < 0) return;

    // Look at messages that arrived after we sent the prompt
    const newMessages = messages.slice(reviewPromptIndexRef.current);
    for (const msg of newMessages) {
      if (msg.role === 'assistant' && msg.content) {
        const parsed = parseReviewResponse(msg.content);
        if (parsed) {
          setReview(parsed);
          setState('complete');
          waitingForResponseRef.current = false;
          reviewPromptIndexRef.current = -1;

          // Auto-select first file
          if (parsed.files.length > 0) {
            const sorted = [...parsed.files].sort((a, b) => a.reviewOrder - b.reviewOrder);
            setSelectedFile(sorted[0].path);
          }
          return;
        }
      }
    }
  }, [messages]);

  const startReview = useCallback(() => {
    if (!isConnected) return;
    setError(null);
    setReview(null);
    setSelectedFile(null);
    setState('loading-diff');
    requestDiff();
  }, [isConnected, requestDiff]);

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
    waitingForResponseRef.current = false;
    reviewPromptIndexRef.current = -1;
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

function parseReviewResponse(content: string): ReviewSummary | null {
  // Extract JSON from fenced code block
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1].trim());

    // Validate structure
    if (!parsed.files || !Array.isArray(parsed.files) || !parsed.overallSummary) {
      return null;
    }

    // Compute stats if missing
    if (!parsed.stats) {
      const stats = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
      for (const file of parsed.files) {
        for (const finding of file.findings || []) {
          if (finding.severity in stats) {
            stats[finding.severity as keyof typeof stats]++;
          }
        }
      }
      parsed.stats = stats;
    }

    // Ensure all files have findings array and IDs on findings
    let idCounter = 0;
    for (const file of parsed.files as ReviewFileSummary[]) {
      file.findings = file.findings || [];
      for (const finding of file.findings) {
        if (!finding.id) {
          finding.id = `rf-${++idCounter}`;
        }
        if (!finding.file) {
          finding.file = file.path;
        }
      }
    }

    return parsed as ReviewSummary;
  } catch {
    return null;
  }
}
