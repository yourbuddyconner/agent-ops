import { ToolCardShell, ToolCardSection } from './tool-card-shell';
import { FileIcon } from './icons';
import type { ToolCallData, ReadArgs } from './types';

export function ReadCard({ tool }: { tool: ToolCallData }) {
  const args = (tool.args ?? {}) as ReadArgs;
  const filePath = args.file_path ?? args.filePath ?? '';
  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.slice(0, filePath.length - fileName.length);

  const resultStr = typeof tool.result === 'string' ? tool.result : null;
  const lineCount = resultStr ? resultStr.split('\n').length : 0;

  // Extract line range info
  const rangeInfo = args.offset || args.limit
    ? `L${args.offset ?? 1}${args.limit ? `–${(args.offset ?? 1) + args.limit}` : ''}`
    : lineCount > 0
      ? `${lineCount} lines`
      : '';

  return (
    <ToolCardShell
      icon={<FileIcon className="h-3.5 w-3.5" />}
      label="read"
      status={tool.status}
      summary={
        <span className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400">{dirPath}</span>
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">{fileName}</span>
          {rangeInfo && (
            <span className="text-neutral-400 dark:text-neutral-500">
              {rangeInfo}
            </span>
          )}
        </span>
      }
    >
      {resultStr && (
        <ToolCardSection>
          <div className="overflow-auto rounded bg-neutral-50 dark:bg-neutral-900/50" style={{ maxHeight: '280px' }}>
            <FileContent content={resultStr} />
          </div>
        </ToolCardSection>
      )}
    </ToolCardShell>
  );
}

function FileContent({ content }: { content: string }) {
  const lines = content.split('\n');
  // Try to detect line-numbered output from OpenCode (format: "  123→content" or "00001| content")
  const hasLineNumbers = lines.length > 0 && /^\s*\d+[→|]/.test(lines[0]);

  if (hasLineNumbers) {
    return (
      <table className="w-full border-collapse font-mono text-[11px] leading-[1.6]">
        <tbody>
          {lines.map((line, i) => {
            const match = line.match(/^\s*(\d+)[→|]\s?(.*)$/);
            const lineNum = match ? match[1] : String(i + 1);
            const lineContent = match ? match[2] : line;
            return (
              <tr key={i} className="hover:bg-accent/[0.04] dark:hover:bg-accent/[0.03]">
                <td className="select-none border-r border-neutral-200 px-2 py-0 text-right tabular-nums text-neutral-300 dark:border-neutral-700/60 dark:text-neutral-600">
                  {lineNum}
                </td>
                <td className="px-2 py-0 whitespace-pre text-neutral-600 dark:text-neutral-400">
                  {lineContent}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <pre className="px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-neutral-600 dark:text-neutral-400">
      {content}
    </pre>
  );
}
