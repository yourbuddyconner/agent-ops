import { ToolCardShell, ToolCardSection } from './tool-card-shell';
import { FilePlusIcon } from './icons';
import type { ToolCallData, WriteArgs } from './types';

export function WriteCard({ tool }: { tool: ToolCallData }) {
  const args = (tool.args ?? {}) as WriteArgs;
  const filePath = args.file_path ?? args.filePath ?? '';
  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.slice(0, filePath.length - fileName.length);
  const content = args.content ?? '';
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <ToolCardShell
      icon={<FilePlusIcon className="h-3.5 w-3.5" />}
      label="write"
      status={tool.status}
      summary={
        <span className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400">{dirPath}</span>
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">{fileName}</span>
          {lineCount > 0 && (
            <span className="text-neutral-400 dark:text-neutral-500">
              {lineCount} lines
            </span>
          )}
        </span>
      }
    >
      {content && (
        <ToolCardSection>
          <div className="overflow-auto rounded bg-neutral-50 dark:bg-neutral-900/50" style={{ maxHeight: '280px' }}>
            <pre className="px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-neutral-600 dark:text-neutral-400">
              {content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content}
            </pre>
          </div>
        </ToolCardSection>
      )}
    </ToolCardShell>
  );
}
