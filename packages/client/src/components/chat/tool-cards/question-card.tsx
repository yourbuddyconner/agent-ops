import { ToolCardShell, ToolCardSection } from './tool-card-shell';
import { QuestionIcon } from './icons';
import type { ToolCallData, QuestionArgs } from './types';

export function QuestionCard({ tool }: { tool: ToolCallData }) {
  const args = (tool.args ?? {}) as QuestionArgs;
  const question = args.question ?? '';
  const header = args.header;
  const options = args.options ?? [];

  const resultStr = typeof tool.result === 'string' ? tool.result : null;

  return (
    <ToolCardShell
      icon={<QuestionIcon className="h-3.5 w-3.5" />}
      label="question"
      status={tool.status}
      defaultExpanded
      summary={
        question ? (
          <span className="text-neutral-600 dark:text-neutral-300">
            {question.length > 80 ? question.slice(0, 80) + '...' : question}
          </span>
        ) : undefined
      }
    >
      <ToolCardSection>
        {header && (
          <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {header}
          </div>
        )}
        {question && (
          <p className="mb-2 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {question}
          </p>
        )}
        {options.length > 0 && (
          <div className="space-y-1">
            {options.map((opt, i) => {
              const label = opt.label ?? opt.value ?? `Option ${i + 1}`;
              const isSelected = resultStr != null && (
                resultStr === label ||
                resultStr === opt.value ||
                resultStr === String(i)
              );
              return (
                <div
                  key={i}
                  className={
                    isSelected
                      ? 'flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 dark:border-accent/20 dark:bg-accent/5'
                      : 'flex items-start gap-2 rounded-md border border-neutral-150 px-2 py-1.5 dark:border-neutral-700/60'
                  }
                >
                  <span className={
                    isSelected
                      ? 'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-white'
                      : 'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-600'
                  }>
                    {isSelected && (
                      <svg className="h-2 w-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 8 7 12 13 4" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className={
                      isSelected
                        ? 'font-mono text-[11px] font-medium text-accent'
                        : 'font-mono text-[11px] text-neutral-600 dark:text-neutral-400'
                    }>
                      {label}
                    </span>
                    {opt.description && (
                      <p className="mt-0.5 text-[10px] leading-snug text-neutral-400 dark:text-neutral-500">
                        {opt.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {resultStr && !options.some(opt =>
          resultStr === (opt.label ?? opt.value) ||
          resultStr === opt.value
        ) && (
          <div className="mt-2 rounded-md border border-accent/20 bg-accent/5 px-2 py-1.5">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Answer
            </span>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
              {resultStr}
            </p>
          </div>
        )}
      </ToolCardSection>
    </ToolCardShell>
  );
}
