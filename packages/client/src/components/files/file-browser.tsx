import * as React from 'react';
import { useFileList, useFileSearch, type FileEntry } from '@/api/files';
import { FileTree } from './file-tree';
import { FilePreview } from './file-preview';
import { SearchInput } from '@/components/ui/search-input';

interface FileBrowserProps {
  sessionId: string;
}

export function FileBrowser({ sessionId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = React.useState('/');
  const [selectedFile, setSelectedFile] = React.useState<FileEntry | null>(null);
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');

  const { data: fileList, isLoading: isLoadingFiles } = useFileList(sessionId, currentPath);
  const { data: searchResults, isLoading: isSearching } = useFileSearch(
    sessionId,
    searchQuery
  );

  const handleSelect = (file: FileEntry) => {
    if (file.type === 'file') {
      setSelectedFile(file);
    }
  };

  const handleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    setCurrentPath(path);
  };

  const files = fileList?.files ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
      {/* Search bar */}
      <div className="border-b border-neutral-200 p-3 dark:border-neutral-700">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search files..."
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-64 flex-shrink-0 overflow-auto border-r border-neutral-200 dark:border-neutral-700">
          {searchQuery && searchResults ? (
            <SearchResults
              results={searchResults.results}
              isLoading={isSearching}
              onSelect={(path) => {
                const file: FileEntry = { name: path.split('/').pop() || '', path, type: 'file' };
                setSelectedFile(file);
              }}
            />
          ) : (
            <FileTree
              files={files}
              selectedPath={selectedFile?.path ?? null}
              onSelect={handleSelect}
              onExpand={handleExpand}
              expandedPaths={expandedPaths}
              isLoading={isLoadingFiles}
            />
          )}
        </div>

        {/* File preview */}
        <div className="flex-1 overflow-hidden bg-neutral-50 dark:bg-neutral-900">
          {selectedFile ? (
            <FilePreview sessionId={sessionId} path={selectedFile.path} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Select a file to view its contents
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SearchResultsProps {
  results: Array<{ path: string; line: number; content: string }>;
  isLoading: boolean;
  onSelect: (path: string) => void;
}

function SearchResults({ results, isLoading, onSelect }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"
          />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No results found
      </div>
    );
  }

  return (
    <div className="space-y-1 p-1">
      {results.map((result, index) => (
        <button
          key={`${result.path}-${result.line}-${index}`}
          onClick={() => onSelect(result.path)}
          className="w-full rounded-md p-2 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
            {result.path}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
            Line {result.line}: {result.content.trim()}
          </p>
        </button>
      ))}
    </div>
  );
}
