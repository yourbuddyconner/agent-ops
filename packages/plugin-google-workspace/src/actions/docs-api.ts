import type { DocsRequest } from './markdown-to-docs.js';

const DOCS_API = 'https://docs.googleapis.com/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * Normalize a Google Docs URL or bare ID to a document ID.
 * Accepts both full URLs (e.g. https://docs.google.com/document/d/ID/edit)
 * and bare document IDs.
 */
export function normalizeDocumentId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

/** Authenticated fetch against Google Docs API v1. */
export async function docsFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DOCS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/** Authenticated fetch against Google Drive API v3 (for document discovery). */
export async function driveFetchForDocs(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

const MAX_BATCH_SIZE = 50;

const DELETE_TYPES = new Set(['deleteContentRange']);
const INSERT_TYPES = new Set([
  'insertText',
  'insertTable',
  'insertPageBreak',
  'insertInlineImage',
  'insertSectionBreak',
]);
// Everything else is a format request

/** Build descriptive error from a failed API response. */
export async function apiError(res: Response, api: string): Promise<{ success: false; error: string }> {
  let detail = '';
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message || body.slice(0, 500);
  } catch {
    detail = res.statusText;
  }
  return { success: false, error: `${api} API ${res.status}: ${detail}` };
}

/**
 * Extract the primary index from a request for sorting.
 * Deletes use startIndex, inserts use index, format requests use startIndex from range.
 * Returns -1 if no index found.
 */
function extractRequestIndex(req: DocsRequest): number {
  const key = Object.keys(req)[0];
  const value = req[key] as Record<string, unknown>;

  if (key === 'deleteContentRange') {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  // Insert types use location.index
  if ('location' in value) {
    const location = value.location as { index?: number } | undefined;
    return location?.index ?? -1;
  }

  // Format types use range.startIndex
  if ('range' in value) {
    const range = value.range as { startIndex?: number } | undefined;
    return range?.startIndex ?? -1;
  }

  return -1;
}

/** Sort requests by descending index (highest first = "write backwards"). */
function sortByReverseIndex(requests: DocsRequest[]): DocsRequest[] {
  return [...requests].sort((a, b) => extractRequestIndex(b) - extractRequestIndex(a));
}

/**
 * Execute batchUpdate requests in three phases: delete -> insert -> format.
 * Splits large batches into chunks of MAX_BATCH_SIZE requests max.
 * Returns success/error result.
 */
export async function executeBatchUpdate(
  documentId: string,
  token: string,
  requests: DocsRequest[],
  options?: { preserveOrder?: boolean },
): Promise<{ success: boolean; error?: string }> {
  if (requests.length === 0) {
    return { success: true };
  }

  if (options?.preserveOrder) {
    for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
      const chunk = requests.slice(i, i + MAX_BATCH_SIZE);
      const res = await docsFetch(
        `/documents/${documentId}:batchUpdate`,
        token,
        { method: 'POST', body: JSON.stringify({ requests: chunk }) },
      );
      if (!res.ok) {
        return apiError(res, 'Docs batchUpdate');
      }
    }

    return { success: true };
  }

  // Categorize requests into three phases by examining each request's first key
  const deleteRequests: DocsRequest[] = [];
  const insertRequests: DocsRequest[] = [];
  const formatRequests: DocsRequest[] = [];

  for (const req of requests) {
    const key = Object.keys(req)[0];
    if (DELETE_TYPES.has(key)) {
      deleteRequests.push(req);
    } else if (INSERT_TYPES.has(key)) {
      insertRequests.push(req);
    } else {
      formatRequests.push(req);
    }
  }

  // Sort each phase by reverse index ("write backwards" per Google's recommendation)
  const phases = [
    sortByReverseIndex(deleteRequests),
    sortByReverseIndex(insertRequests),
    sortByReverseIndex(formatRequests),
  ];

  for (const phaseRequests of phases) {
    // Split each phase into chunks of MAX_BATCH_SIZE
    for (let i = 0; i < phaseRequests.length; i += MAX_BATCH_SIZE) {
      const chunk = phaseRequests.slice(i, i + MAX_BATCH_SIZE);
      const res = await docsFetch(
        `/documents/${documentId}:batchUpdate`,
        token,
        { method: 'POST', body: JSON.stringify({ requests: chunk }) },
      );
      if (!res.ok) {
        return apiError(res, 'Docs batchUpdate');
      }
    }
  }

  return { success: true };
}
