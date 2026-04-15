/**
 * Refresh round-trip helper — re-fetch a session's messages via the API and
 * assert the same observable state appears as the live response captured.
 *
 * Catches the entire "format drift" bug class:
 *   - V1/V2 storage shape changes (the child-card recovery bug)
 *   - Messages persisted with different attribution than they were broadcast with
 *   - Tool calls dropped from history but visible live (or vice versa)
 *   - Channel/thread filtering regressions in GET /messages
 *
 * Cheap insurance: call once at the end of every smoke test as a one-liner.
 */
import { expect } from 'vitest';
import type { SmokeClient } from './client.js';
import type { AgentResponse } from './agent.js';
import { ToolCallTrace, type ToolCall } from './tool-trace.js';

/**
 * Re-fetch the session's messages for the given thread and assert that
 * the persisted state contains the same tool calls and the same final
 * assistant text as the live response. Tolerates additional messages
 * arriving between live capture and re-fetch (extra is fine; missing isn't).
 */
export async function assertRefreshReproducesState(
  client: SmokeClient,
  response: AgentResponse,
): Promise<void> {
  const refreshed = await client.getMessages(response.sessionId, {
    limit: 200,
    threadId: response.threadId,
  });
  const refreshedMessages = (refreshed?.messages ?? []) as typeof response.messages;
  if (refreshedMessages.length === 0) {
    throw new Error(
      `refresh round-trip: GET /messages returned 0 messages for thread ${response.threadId} ` +
      `(live response had ${response.messages.length}). The persistence layer or thread filter is broken.`,
    );
  }

  // 1. Tool-call set must be a superset of what we saw live.
  const liveTrace = new ToolCallTrace(response.messages);
  const refreshedTrace = new ToolCallTrace(refreshedMessages);
  const liveCallSet = liveTrace.calls.map(callKey);
  const refreshedCallSet = new Set(refreshedTrace.calls.map(callKey));
  const missing = liveCallSet.filter((k) => !refreshedCallSet.has(k));
  if (missing.length > 0) {
    throw new Error(
      `refresh round-trip: ${missing.length} tool call(s) visible live but missing after refresh:\n  ${missing.join('\n  ')}\n` +
      `Live calls: ${liveCallSet.join(', ')}\n` +
      `Refreshed calls: ${[...refreshedCallSet].join(', ')}`,
    );
  }

  // 2. Tool-result strings must match (catches "result truncated on persistence" bugs).
  for (const liveCall of liveTrace.calls) {
    if (typeof liveCall.result !== 'string') continue;
    const persistedCall = refreshedTrace.calls.find(
      (c) => c.callId === liveCall.callId || (c.toolName === liveCall.toolName && c.index === liveCall.index),
    );
    if (!persistedCall || typeof persistedCall.result !== 'string') continue;
    expect(persistedCall.result, `refresh round-trip: tool ${liveCall.toolName} result drift between live and persisted`).toBe(liveCall.result);
  }

  // 3. Final assistant text must appear in the persisted messages somewhere.
  if (response.raw && response.raw.length > 50) {
    const fragment = response.raw.slice(0, 50);
    const hasFragment = refreshedMessages.some((m) => {
      const text = typeof m.content === 'string' ? m.content : '';
      const partsText = Array.isArray(m.parts)
        ? (m.parts as Record<string, unknown>[])
            .filter((p) => p && p.type === 'text')
            .map((p) => (typeof p.text === 'string' ? p.text : ''))
            .join('')
        : '';
      return text.includes(fragment) || partsText.includes(fragment);
    });
    if (!hasFragment) {
      throw new Error(
        `refresh round-trip: live final text ("${fragment}...") not found in any persisted message. ` +
        `Either the final message wasn't persisted or text is stored in an unexpected shape.`,
      );
    }
  }
}

function callKey(c: ToolCall): string {
  return `${c.toolName}#${c.callId || c.index}`;
}
