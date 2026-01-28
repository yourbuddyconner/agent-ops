interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  return (
    <div className="flex gap-3 bg-surface-1 px-4 py-3 dark:bg-surface-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent/10 font-mono text-[10px] font-semibold text-accent">
        A
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Assistant</span>
          <span className="label-mono text-neutral-400 dark:text-neutral-500">typing...</span>
        </div>

        <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 text-pretty dark:text-neutral-300">
          {content}
          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent/60" />
        </div>
      </div>
    </div>
  );
}
