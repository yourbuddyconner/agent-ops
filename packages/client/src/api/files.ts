import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface FileListResponse {
  files: FileEntry[];
}

export interface FileReadResponse {
  content: string;
  path: string;
}

export interface FileSearchResult {
  path: string;
  line: number;
  content: string;
}

export interface FileSearchResponse {
  results: FileSearchResult[];
}

export interface FileFindResponse {
  paths: string[];
}

export const fileKeys = {
  all: ['files'] as const,
  list: (sessionId: string, path?: string) =>
    [...fileKeys.all, 'list', sessionId, path] as const,
  read: (sessionId: string, path: string) =>
    [...fileKeys.all, 'read', sessionId, path] as const,
  search: (sessionId: string, query: string) =>
    [...fileKeys.all, 'search', sessionId, query] as const,
  find: (sessionId: string, query: string) =>
    [...fileKeys.all, 'find', sessionId, query] as const,
};

export function useFileList(sessionId: string, path?: string) {
  return useQuery({
    queryKey: fileKeys.list(sessionId, path),
    queryFn: () => {
      const params = new URLSearchParams({ sessionId });
      if (path) params.set('path', path);
      return api.get<FileListResponse>(`/files/list?${params}`);
    },
    enabled: !!sessionId,
  });
}

export function useFileRead(sessionId: string, path: string) {
  return useQuery({
    queryKey: fileKeys.read(sessionId, path),
    queryFn: () =>
      api.get<FileReadResponse>(
        `/files/read?sessionId=${sessionId}&path=${encodeURIComponent(path)}`
      ),
    enabled: !!sessionId && !!path,
  });
}

export function useFileFinder(sessionId: string, query: string) {
  return useQuery({
    queryKey: fileKeys.find(sessionId, query),
    queryFn: () =>
      api.get<FileFindResponse>(
        `/files/find?sessionId=${sessionId}&query=${encodeURIComponent(query)}&limit=20`
      ),
    enabled: !!sessionId && !!query && query.length >= 1,
  });
}

export function useFileSearch(sessionId: string, query: string) {
  return useQuery({
    queryKey: fileKeys.search(sessionId, query),
    queryFn: () =>
      api.get<FileSearchResponse>(
        `/files/search?sessionId=${sessionId}&query=${encodeURIComponent(query)}`
      ),
    enabled: !!sessionId && !!query && query.length >= 2,
  });
}
