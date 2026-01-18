interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  return (
    <div className="flex gap-3 bg-neutral-50 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-700">
        A
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-900">Assistant</span>
          <span className="text-xs text-neutral-400">typing...</span>
        </div>

        <div className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 text-pretty">
          {content}
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-neutral-400" />
        </div>
      </div>
    </div>
  );
}
