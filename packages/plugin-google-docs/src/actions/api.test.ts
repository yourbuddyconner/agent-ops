import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeBatchUpdate } from './api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse() {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('executeBatchUpdate reverse-index sorting', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sorts delete requests by descending startIndex', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate('doc-1', 'token', [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
      { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
      { deleteContentRange: { range: { startIndex: 30, endIndex: 40 } } },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const indices = body.requests.map(
      (r: { deleteContentRange: { range: { startIndex: number } } }) =>
        r.deleteContentRange.range.startIndex,
    );
    expect(indices).toEqual([50, 30, 10]);
  });

  it('sorts insert requests by descending index', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate('doc-1', 'token', [
      { insertText: { location: { index: 5 }, text: 'a' } },
      { insertText: { location: { index: 50 }, text: 'b' } },
      { insertText: { location: { index: 20 }, text: 'c' } },
    ]);

    // Inserts are in the second phase. Delete phase is empty so first non-empty batch is inserts.
    const calls = mockFetch.mock.calls;
    const insertBody = JSON.parse(calls[0][1].body);
    const indices = insertBody.requests.map(
      (r: { insertText: { location: { index: number } } }) =>
        r.insertText.location.index,
    );
    expect(indices).toEqual([50, 20, 5]);
  });

  it('does not sort when preserveOrder is true', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await executeBatchUpdate(
      'doc-1',
      'token',
      [
        { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
        { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
      ],
      { preserveOrder: true },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const indices = body.requests.map(
      (r: { deleteContentRange: { range: { startIndex: number } } }) =>
        r.deleteContentRange.range.startIndex,
    );
    expect(indices).toEqual([10, 50]);
  });
});
