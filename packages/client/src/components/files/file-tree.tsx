import { cn } from '@/lib/cn';
import type { FileEntry } from '@/api/files';

interface FileTreeProps {
  files: FileEntry[];
  selectedPath: string | null;
  onSelect: (file: FileEntry) => void;
  onExpand?: (path: string) => void;
  expandedPaths?: Set<string>;
  isLoading?: boolean;
}

export function FileTree({
  files,
  selectedPath,
  onSelect,
  onExpand,
  expandedPaths = new Set(),
  isLoading,
}: FileTreeProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-6 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"
            style={{ width: `${60 + Math.random() * 40}%` }}
          />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No files found
      </div>
    );
  }

  // Sort: directories first, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-0.5 p-1">
      {sortedFiles.map((file) => (
        <FileTreeItem
          key={file.path}
          file={file}
          isSelected={selectedPath === file.path}
          isExpanded={expandedPaths.has(file.path)}
          onSelect={onSelect}
          onExpand={onExpand}
        />
      ))}
    </div>
  );
}

interface FileTreeItemProps {
  file: FileEntry;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: (file: FileEntry) => void;
  onExpand?: (path: string) => void;
  depth?: number;
}

function FileTreeItem({
  file,
  isSelected,
  isExpanded,
  onSelect,
  onExpand,
  depth = 0,
}: FileTreeItemProps) {
  const handleClick = () => {
    if (file.type === 'directory' && onExpand) {
      onExpand(file.path);
    } else {
      onSelect(file);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        isSelected
          ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
          : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {file.type === 'directory' ? (
        <FolderIcon expanded={isExpanded} />
      ) : (
        <FileIcon filename={file.name} />
      )}
      <span className="truncate">{file.name}</span>
      {file.size !== undefined && file.type === 'file' && (
        <span className="ml-auto text-xs text-neutral-400">
          {formatFileSize(file.size)}
        </span>
      )}
    </button>
  );
}

function FolderIcon({ expanded }: { expanded: boolean }) {
  if (expanded) {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-amber-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }

  return (
    <svg
      className="h-4 w-4 shrink-0 text-amber-500"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z"
        clipRule="evenodd"
      />
      <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
    </svg>
  );
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase();

  // Different colors for different file types
  let colorClass = 'text-neutral-400';

  if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
    colorClass = 'text-blue-500';
  } else if (['json', 'yaml', 'yml', 'toml'].includes(ext || '')) {
    colorClass = 'text-green-500';
  } else if (['md', 'mdx', 'txt'].includes(ext || '')) {
    colorClass = 'text-neutral-500';
  } else if (['css', 'scss', 'less'].includes(ext || '')) {
    colorClass = 'text-pink-500';
  } else if (['py', 'go', 'rs', 'java', 'rb'].includes(ext || '')) {
    colorClass = 'text-purple-500';
  }

  return (
    <svg
      className={cn('h-4 w-4 shrink-0', colorClass)}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
