import { Component, type ReactNode, type ErrorInfo } from 'react';

interface PierreWrapperProps {
  maxHeight?: string;
  /** Label for debug logging */
  debugLabel?: string;
  children: ReactNode;
}

/**
 * CSS injected into Pierre's Shadow DOM to make it blend with tool cards.
 * Removes the opaque white/black background so it inherits from the card.
 */
export const PIERRE_INLINE_CSS = `
  :host { --diffs-bg: transparent !important; }
  [data-diffs-header], [data-diffs], [data-error-wrapper] { background-color: transparent !important; }
  [data-diffs-header] { min-height: unset; padding: 0; }
  [data-code] { padding-top: 4px; padding-bottom: 4px; }
  [data-file-info] { display: none; }
`;

/**
 * Error boundary that catches Pierre rendering failures
 * and shows a visible fallback with the error.
 */
class PierreErrorBoundary extends Component<
  { label?: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Pierre:${this.props.label ?? 'unknown'}] Render error:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '8px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
          <strong style={{ color: '#dc2626' }}>Pierre render error ({this.props.label}):</strong>
          <pre style={{ marginTop: '4px', whiteSpace: 'pre-wrap', color: '#991b1b' }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PierreWrapper({ maxHeight = '320px', debugLabel, children }: PierreWrapperProps) {
  return (
    <PierreErrorBoundary label={debugLabel}>
      <div className="overflow-auto rounded" style={{ maxHeight }}>
        {children}
      </div>
    </PierreErrorBoundary>
  );
}

/**
 * Strip OpenCode line-number prefixes from file content.
 * Formats: "  123→content" or "  123|content" or "00001| content"
 */
export function stripLineNumbers(content: string): string {
  const lines = content.split('\n');
  if (lines.length === 0) return content;

  // Check if the first non-empty line has the line-number prefix pattern
  const hasLineNumbers = lines.some((line) => /^\s*\d+[→|]/.test(line));
  if (!hasLineNumbers) return content;

  return lines
    .map((line) => {
      const match = line.match(/^\s*\d+[→|]\s?(.*)$/);
      return match ? match[1] : line;
    })
    .join('\n');
}
