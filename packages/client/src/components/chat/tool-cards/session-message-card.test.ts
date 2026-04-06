import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encode } from '@toon-format/toon';
import { ReadMessagesCard } from './session-message-card';

describe('ReadMessagesCard', () => {
  it('renders full TOON read_messages results without adding a truncation suffix', () => {
    const fullContent = 'A'.repeat(2600);
    const result = encode([
      {
        role: 'assistant',
        content: fullContent,
        createdAt: '2026-04-06T12:00:00.000Z',
        parts: [{ type: 'text', text: fullContent }],
      },
    ]);

    const html = renderToStaticMarkup(
      createElement(ReadMessagesCard, {
        tool: {
          toolName: 'read_messages',
          status: 'completed',
          args: { session_id: 'session-123' },
          result,
        },
      }),
    );

    expect(html).toContain(fullContent);
    expect(html).not.toContain('... (truncated)');
  });
});
