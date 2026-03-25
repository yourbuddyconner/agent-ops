import { describe, it, expect, vi, beforeEach } from 'vitest';
import { googleDocsActions } from './actions.js';
import type { ActionContext } from '@valet/sdk';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCtx(): ActionContext {
  return {
    credentials: { access_token: 'test-token' },
    userId: 'test-user',
  } as ActionContext;
}

function okResponse(data: unknown = {}) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('docs.update_document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes replaceAllText requests', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          {
            replaceAllText: {
              containsText: { text: '{{NAME}}', matchCase: true },
              replaceText: 'Alice',
            },
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/documents/doc-123:batchUpdate');
    const body = JSON.parse(opts.body);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].replaceAllText.replaceText).toBe('Alice');
  });

  it('executes insertText at a specific index', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          {
            insertText: {
              location: { index: 42 },
              text: 'Hello',
            },
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.requests[0].insertText.location.index).toBe(42);
    expect(body.requests[0].insertText.text).toBe('Hello');
  });

  it('executes deleteContentRange', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          {
            deleteContentRange: {
              range: { startIndex: 10, endIndex: 20 },
            },
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.requests[0].deleteContentRange.range.startIndex).toBe(10);
    expect(body.requests[0].deleteContentRange.range.endIndex).toBe(20);
  });

  it('injects tabId into location objects', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        tabId: 'tab-1',
        requests: [
          {
            insertText: {
              location: { index: 5 },
              text: 'Hi',
            },
          },
          {
            deleteContentRange: {
              range: { startIndex: 10, endIndex: 20 },
            },
          },
        ],
      },
      makeCtx(),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // tabId should be injected into the location object
    expect(body.requests[0].insertText.location.tabId).toBe('tab-1');
    // tabId should be injected into the range object (has startIndex)
    expect(body.requests[1].deleteContentRange.range.tabId).toBe('tab-1');
  });

  it('injects tabId into empty endOfSegmentLocation', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        tabId: 'tab-1',
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: 'Appended',
            },
          },
        ],
      },
      makeCtx(),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.requests[0].insertText.endOfSegmentLocation.tabId).toBe('tab-1');
  });

  it('does not overwrite existing tabId in location objects', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        tabId: 'tab-1',
        requests: [
          {
            insertText: {
              location: { index: 5, tabId: 'tab-2' },
              text: 'Hi',
            },
          },
        ],
      },
      makeCtx(),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Existing tabId should be preserved
    expect(body.requests[0].insertText.location.tabId).toBe('tab-2');
  });

  it('rejects unsupported request types', async () => {
    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          { insertTable: { rows: 2, columns: 2, location: { index: 1 } } },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported request type 'insertTable'");
    expect(result.error).toContain('Supported types');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects requests with multiple keys', async () => {
    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          {
            replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' },
            insertText: { location: { index: 1 }, text: 'c' },
          },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('exactly one request type');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('preserves caller-specified request order', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          { insertText: { location: { index: 1 }, text: 'first' } },
          { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
          { replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' } },
        ],
      },
      makeCtx(),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Requests should be in the exact order provided (not reordered by phase)
    expect(Object.keys(body.requests[0])[0]).toBe('insertText');
    expect(Object.keys(body.requests[1])[0]).toBe('deleteContentRange');
    expect(Object.keys(body.requests[2])[0]).toBe('replaceAllText');
  });

  it('handles API errors', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403, 'Insufficient permissions'));

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [
          { replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' } },
        ],
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
    expect(result.error).toContain('Insufficient permissions');
  });

  it('handles empty requests array', async () => {
    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        requests: [],
      },
      makeCtx(),
    );

    // Empty requests = nothing to do, should succeed
    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
