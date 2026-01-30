import { ToolCardShell, ToolCardSection, ToolCodeBlock } from './tool-card-shell';
import { WrenchIcon } from './icons';
import type { ToolCallData } from './types';

export function GenericCard({ tool }: { tool: ToolCallData }) {
  const argsStr = tool.args != null
    ? (typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2))
    : null;

  const resultStr = tool.result != null
    ? (typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2))
    : null;

  // Try to extract a one-line summary from args
  const summary = extractSummary(tool.args);

  return (
    <ToolCardShell
      icon={<WrenchIcon className="h-3.5 w-3.5" />}
      label={tool.toolName}
      status={tool.status}
      summary={summary ? (
        <span className="text-neutral-500 dark:text-neutral-400">{summary}</span>
      ) : undefined}
    >
      {(argsStr || resultStr) && (
        <>
          {argsStr && (
            <ToolCardSection label="arguments">
              <ToolCodeBlock maxHeight="160px">
                {argsStr}
              </ToolCodeBlock>
            </ToolCardSection>
          )}
          {resultStr && (
            <ToolCardSection label="result" className="border-t border-neutral-100 dark:border-neutral-800">
              <ToolCodeBlock maxHeight="200px">
                {resultStr.length > 2000 ? resultStr.slice(0, 2000) + '\n... (truncated)' : resultStr}
              </ToolCodeBlock>
            </ToolCardSection>
          )}
        </>
      )}
    </ToolCardShell>
  );
}

function extractSummary(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;

  // Common patterns: command, content, path, query, message, description
  for (const key of ['description', 'command', 'file_path', 'filePath', 'path', 'pattern', 'query', 'message', 'url']) {
    const val = a[key];
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 100 ? val.slice(0, 100) + '...' : val;
    }
  }

  return null;
}
