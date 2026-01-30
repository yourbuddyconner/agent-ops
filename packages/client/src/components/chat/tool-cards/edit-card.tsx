import { ToolCardShell, ToolCardSection } from './tool-card-shell';
import { FileEditIcon } from './icons';
import type { ToolCallData, EditArgs } from './types';

function parseArgs(raw: unknown): EditArgs {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as EditArgs;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as EditArgs; } catch { return {}; }
  }
  return {};
}

export function EditCard({ tool }: { tool: ToolCallData }) {
  const args = parseArgs(tool.args);
  const filePath = args.file_path ?? args.filePath ?? '';
  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.slice(0, filePath.length - fileName.length);

  const oldStr = args.old_string ?? args.oldString ?? '';
  const newStr = args.new_string ?? args.newString ?? '';
  const replaceAll = args.replace_all ?? args.replaceAll;

  const resultStr = typeof tool.result === 'string' ? tool.result : null;

  return (
    <ToolCardShell
      icon={<FileEditIcon className="h-3.5 w-3.5" />}
      label="edit"
      status={tool.status}
      defaultExpanded
      summary={
        <span className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400">{dirPath}</span>
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">{fileName}</span>
          {replaceAll && (
            <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              all
            </span>
          )}
        </span>
      }
    >
      {(oldStr || newStr) ? (
        <ToolCardSection>
          <div className="overflow-auto rounded bg-neutral-50 dark:bg-neutral-900/50" style={{ maxHeight: '320px' }}>
            {oldStr && (
              <div className="border-b border-neutral-200 dark:border-neutral-700/60">
                <DiffBlock type="remove" content={oldStr} />
              </div>
            )}
            {newStr && (
              <DiffBlock type="add" content={newStr} />
            )}
          </div>
          {resultStr && (
            <p className="mt-1.5 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
              {resultStr}
            </p>
          )}
        </ToolCardSection>
      ) : (tool.args != null || resultStr) ? (
        <ToolCardSection>
          {tool.args != null && (
            <pre className="overflow-auto font-mono text-[11px] leading-[1.6] text-neutral-500 dark:text-neutral-400" style={{ maxHeight: '200px' }}>
              {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
            </pre>
          )}
          {resultStr && (
            <p className="mt-1.5 border-t border-neutral-100 pt-1.5 font-mono text-[10px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
              {resultStr}
            </p>
          )}
        </ToolCardSection>
      ) : null}
    </ToolCardShell>
  );
}

function DiffBlock({ type, content }: { type: 'add' | 'remove'; content: string }) {
  const lines = content.split('\n');
  const isAdd = type === 'add';

  return (
    <div className="min-w-fit font-mono text-[11px] leading-[1.6]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            isAdd
              ? 'bg-emerald-50/80 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300'
              : 'bg-red-50/80 text-red-800 dark:bg-red-950/20 dark:text-red-300'
          }
        >
          <span className="inline-block w-5 select-none text-center opacity-50">
            {isAdd ? '+' : '-'}
          </span>
          <span className="whitespace-pre">{line}</span>
        </div>
      ))}
    </div>
  );
}
