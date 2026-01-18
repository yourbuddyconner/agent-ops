import { useFileRead } from '@/api/files';
import { Skeleton } from '@/components/ui/skeleton';

interface FilePreviewProps {
  sessionId: string;
  path: string;
}

export function FilePreview({ sessionId, path }: FilePreviewProps) {
  const { data, isLoading, isError } = useFileRead(sessionId, path);

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Unable to load file content
        </p>
      </div>
    );
  }

  // Get file extension for syntax highlighting hints
  const ext = path.split('.').pop()?.toLowerCase();
  const language = getLanguageFromExtension(ext);

  // Check if it's a binary file (simple heuristic)
  const isBinary = data.content.includes('\u0000');

  if (isBinary) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Binary file cannot be displayed
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-neutral-100 px-4 py-2 dark:border-neutral-700 dark:bg-neutral-800">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {path}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {language}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm">
        <code className="font-mono text-neutral-800 dark:text-neutral-200">
          {data.content}
        </code>
      </pre>
    </div>
  );
}

function getLanguageFromExtension(ext?: string): string {
  const languageMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript (JSX)',
    js: 'JavaScript',
    jsx: 'JavaScript (JSX)',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    md: 'Markdown',
    mdx: 'MDX',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    rb: 'Ruby',
    sh: 'Shell',
    bash: 'Bash',
    sql: 'SQL',
    toml: 'TOML',
    xml: 'XML',
  };

  return languageMap[ext || ''] || 'Plain text';
}
