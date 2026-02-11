export interface FormattedToolPath {
  dirPath: string;
  fileName: string;
}

function stripWorkspacePrefix(path: string): string {
  const normalized = path.replace(/\\/g, '/');

  const modalWorkspace = normalized.match(/^\/__modal\/volumes\/[^/]+\/[^/]+\/(.+)$/);
  if (modalWorkspace) {
    return modalWorkspace[1];
  }

  const rootWorkspace = normalized.match(/^\/workspace\/(.+)$/);
  if (rootWorkspace) {
    return rootWorkspace[1];
  }

  const namedWorkspace = normalized.match(/^\/workspaces\/[^/]+\/(.+)$/);
  if (namedWorkspace) {
    return namedWorkspace[1];
  }

  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
}

export function formatToolPath(rawPath: string, visibleDirSegments = 3): FormattedToolPath {
  if (!rawPath) return { dirPath: '', fileName: '' };

  const displayPath = stripWorkspacePrefix(rawPath);
  const parts = displayPath.split('/').filter(Boolean);
  if (parts.length === 0) return { dirPath: '', fileName: rawPath };

  const fileName = parts[parts.length - 1] || rawPath;
  const dirParts = parts.slice(0, -1);

  if (dirParts.length === 0) return { dirPath: '', fileName };

  const shown = dirParts.length > visibleDirSegments
    ? dirParts.slice(-visibleDirSegments)
    : dirParts;

  return {
    dirPath: `${dirParts.length > visibleDirSegments ? '…/' : ''}${shown.join('/')}/`,
    fileName,
  };
}
