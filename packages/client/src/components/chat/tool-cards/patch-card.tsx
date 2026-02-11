import { ToolCardShell, ToolCardSection } from './tool-card-shell';
import { PatchIcon } from './icons';
import type { ToolCallData, PatchArgs } from './types';
import { formatToolPath } from './path-display';

export function PatchCard({ tool }: { tool: ToolCallData }) {
  const args = (tool.args ?? {}) as PatchArgs;
  const filePath = args.file_path ?? args.filePath ?? '';
  const { fileName, dirPath } = formatToolPath(filePath);
  const patchContent = args.patch ?? args.diff ?? args.content ?? '';

  const resultStr = typeof tool.result === 'string' ? tool.result : null;

  // Count additions/removals from patch content
  const lines = patchContent.split('\n');
  let additions = 0;
  let removals = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) removals++;
  }

  return (
    <ToolCardShell
      icon={<PatchIcon className="h-3.5 w-3.5" />}
      label="patch"
      status={tool.status}
      defaultExpanded
      summary={
        <span className="flex items-center gap-1.5">
          {filePath && (
            <>
              <span className="text-neutral-500 dark:text-neutral-400">{dirPath}</span>
              <span className="font-semibold text-neutral-700 dark:text-neutral-200">{fileName}</span>
            </>
          )}
          {(additions > 0 || removals > 0) && (
            <span className="text-neutral-400 dark:text-neutral-500">
              {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
              {additions > 0 && removals > 0 && ' '}
              {removals > 0 && <span className="text-red-500 dark:text-red-400">-{removals}</span>}
            </span>
          )}
        </span>
      }
    >
      {patchContent && (
        <ToolCardSection>
          <div className="overflow-auto rounded bg-neutral-50 dark:bg-neutral-900/50" style={{ maxHeight: '360px' }}>
            <div className="min-w-fit font-mono text-[11px] leading-[1.6]">
              {lines.map((line, i) => {
                let className = 'text-neutral-500 dark:text-neutral-400';
                if (line.startsWith('+')) {
                  className = 'bg-emerald-50/80 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300';
                } else if (line.startsWith('-')) {
                  className = 'bg-red-50/80 text-red-800 dark:bg-red-950/20 dark:text-red-300';
                } else if (line.startsWith('@@')) {
                  className = 'text-blue-600 dark:text-blue-400';
                }
                return (
                  <div key={i} className={className}>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {resultStr && (
            <p className="mt-1.5 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
              {resultStr}
            </p>
          )}
        </ToolCardSection>
      )}
    </ToolCardShell>
  );
}
