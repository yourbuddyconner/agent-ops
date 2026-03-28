import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encode as encodeToon } from '@toon-format/toon';
import { googleDocsActions } from './actions.js';
import type { ActionContext } from '@valet/sdk';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCtx(): ActionContext {
  return {
    credentials: { access_token: 'test-token' },
    userId: 'test-user',
  } as ActionContext;
}

function okResponse(data: unknown = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDocument() {
  return {
    body: {
      content: [
        {
          paragraph: {
            elements: [
              {
                startIndex: 1,
                endIndex: 7,
                textRun: { content: 'Intro\n' },
              },
            ],
          },
        },
        {
          table: {
            rows: 2,
            columns: 2,
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            {
                              startIndex: 8,
                              endIndex: 14,
                              textRun: { content: 'Name\n' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            {
                              startIndex: 14,
                              endIndex: 15,
                              textRun: { content: '\n' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            {
                              startIndex: 15,
                              endIndex: 21,
                              textRun: { content: 'Tier\n' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            {
                              startIndex: 21,
                              endIndex: 29,
                              textRun: { content: 'Current\n' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        {
          paragraph: {
            elements: [
              {
                startIndex: 29,
                endIndex: 46,
                textRun: { content: 'Marketing Owner:\n' },
              },
            ],
          },
        },
      ],
    },
  };
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function operationsToon(operations: unknown[]): string {
  return encodeToon(operations);
}

describe('docs.update_document', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('translates replaceAll operations to replaceAllText requests', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'replaceAll',
            find: '{{NAME}}',
            replace: 'Alice',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/documents/doc-123:batchUpdate');
    const body = JSON.parse(opts.body);
    expect(body.requests).toEqual([
      {
        replaceAllText: {
          containsText: { text: '{{NAME}}', matchCase: true },
          replaceText: 'Alice',
        },
      },
    ]);
  });

  it('fills an empty table cell without deleting the placeholder newline', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(makeDocument()))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 0,
            col: 1,
            text: 'Wallet Export v2',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.requests).toEqual([
      {
        insertText: {
          location: { index: 14 },
          text: 'Wallet Export v2',
        },
      },
    ]);
  });

  it('overwrites an existing table cell by deleting current content then inserting new text', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(makeDocument()))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 1,
            col: 1,
            text: 'Tier 1',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.requests).toEqual([
      {
        deleteContentRange: {
          range: { startIndex: 21, endIndex: 28 },
        },
      },
      {
        insertText: {
          location: { index: 21 },
          text: 'Tier 1',
        },
      },
    ]);
  });

  it('tracks downstream indexes across multiple fillCell operations in one batch', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(makeDocument()))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 0,
            col: 1,
            text: 'Wallet Export v2',
          },
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 1,
            col: 1,
            text: 'Tier 1',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.requests).toEqual([
      {
        insertText: {
          location: { index: 14 },
          text: 'Wallet Export v2',
        },
      },
      {
        deleteContentRange: {
          range: { startIndex: 37, endIndex: 44 },
        },
      },
      {
        insertText: {
          location: { index: 37 },
          text: 'Tier 1',
        },
      },
    ]);
  });

  it('inserts text after an anchor string', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(makeDocument()))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'insertText',
            after: 'Marketing Owner:',
            text: ' Jane Smith',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.requests).toEqual([
      {
        insertText: {
          location: { index: 45 },
          text: ' Jane Smith',
        },
      },
    ]);
  });

  it('injects tabId into generated location objects', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse(makeDocument()))
      .mockResolvedValueOnce(okResponse());

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        tabId: 'tab-1',
        operationsToon: operationsToon([
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 1,
            col: 1,
            text: 'Tier 1',
          },
          {
            type: 'insertText',
            after: 'Marketing Owner:',
            text: ' Jane Smith',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.requests[0].deleteContentRange.range.tabId).toBe('tab-1');
    expect(body.requests).toEqual([
      {
        deleteContentRange: {
          range: { startIndex: 21, endIndex: 28, tabId: 'tab-1' },
        },
      },
      {
        insertText: {
          location: { index: 21, tabId: 'tab-1' },
          text: 'Tier 1',
        },
      },
      {
        insertText: {
          location: { index: 44, tabId: 'tab-1' },
          text: ' Jane Smith',
        },
      },
    ]);
  });

  it('reports table bounds errors clearly', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(makeDocument()));

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'fillCell',
            tableIndex: 0,
            row: 7,
            col: 0,
            text: 'Out of bounds',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('operation[0]');
    expect(result.error).toContain('table 0 has 2 rows');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports a missing anchor clearly', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(makeDocument()));

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'insertText',
            after: 'Missing Anchor:',
            text: ' Jane Smith',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("operation[0]: anchor 'Missing Anchor:' not found");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports unknown operation types clearly', async () => {
    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'explodeCell',
            row: 0,
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown operation type 'explodeCell'");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles API errors', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403, 'Insufficient permissions'));

    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([
          {
            type: 'replaceAll',
            find: '{{NAME}}',
            replace: 'Alice',
          },
        ]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
    expect(result.error).toContain('Insufficient permissions');
  });

  it('handles an empty operations array', async () => {
    const result = await googleDocsActions.execute(
      'docs.update_document',
      {
        documentId: 'doc-123',
        operationsToon: operationsToon([]),
      },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
