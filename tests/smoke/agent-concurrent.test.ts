/**
 * Concurrent multi-channel smoke test — direct regression coverage for the
 * channel routing bug that motivated the explicit-channel-routing refactor.
 *
 * The bug: when the orchestrator processed two prompts on different threads
 * concurrently, mutable cursor state (currentPromptChannel) got clobbered by
 * the second handlePrompt write before the first prompt's SSE stream finished.
 * Assistant message attribution leaked across threads — output for prompt A
 * could land on thread B's view, or vice versa.
 *
 * This test sends two prompts in parallel on distinct threads with non-
 * overlapping marker tokens, then asserts each thread's persisted history
 * contains its own marker AND NOT the other's. If routing regresses, both
 * assertions catch it loudly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SmokeClient } from './client.js';
import { dispatchAndWait, type AgentResponse } from './agent.js';
import { ToolCallTrace } from './tool-trace.js';
import { assertRefreshReproducesState } from './refresh-helper.js';

const client = new SmokeClient();

const PROMPT_A = `You are running an automated smoke test for channel isolation. Reply with EXACTLY this string and nothing else:

ALPHA_MARKER_A1B2C3 — channel A response (no other text, no JSON wrapping, no markdown)

Then output ONLY this JSON object on a new line:

{"smoke_test":"concurrent","marker":"ALPHA","got_other_marker":false}

Set "got_other_marker" to true ONLY if you see "BRAVO" in any prior message in this thread (you should NOT — if you do, channel routing is broken).`;

const PROMPT_B = `You are running an automated smoke test for channel isolation. Reply with EXACTLY this string and nothing else:

BRAVO_MARKER_X9Y8Z7 — channel B response (no other text, no JSON wrapping, no markdown)

Then output ONLY this JSON object on a new line:

{"smoke_test":"concurrent","marker":"BRAVO","got_other_marker":false}

Set "got_other_marker" to true ONLY if you see "ALPHA" in any prior message in this thread (you should NOT — if you do, channel routing is broken).`;

describe('agent: concurrent multi-channel isolation', () => {
  let responseA: AgentResponse;
  let responseB: AgentResponse;

  beforeAll(async () => {
    // Resolve session and create two distinct threads up front so the dispatch
    // calls go out as close to simultaneously as possible.
    const orch = await client.getOrchestrator();
    if (!orch.exists || !orch.sessionId) {
      throw new Error('No orchestrator session found');
    }
    const sessionId = orch.sessionId;
    const [threadA, threadB] = await Promise.all([
      client.createThread(sessionId),
      client.createThread(sessionId),
    ]);

    // Fire both dispatches in parallel. dispatchAndWait sends the prompt then
    // polls for the response — the parallelism is real because both POSTs go
    // out before either polling loop begins.
    [responseA, responseB] = await Promise.all([
      dispatchAndWait(client, PROMPT_A, { threadId: threadA.id, timeoutMs: 90_000 }),
      dispatchAndWait(client, PROMPT_B, { threadId: threadB.id, timeoutMs: 90_000 }),
    ]);

    console.log(`Thread A finished in ${responseA.durationMs}ms; thread B in ${responseB.durationMs}ms`);
    console.log(`Thread A markers in raw: ALPHA=${responseA.raw.includes('ALPHA_MARKER_A1B2C3')}, BRAVO=${responseA.raw.includes('BRAVO_MARKER_X9Y8Z7')}`);
    console.log(`Thread B markers in raw: ALPHA=${responseB.raw.includes('ALPHA_MARKER_A1B2C3')}, BRAVO=${responseB.raw.includes('BRAVO_MARKER_X9Y8Z7')}`);
  }, 120_000);

  it('thread A response contains its own marker', () => {
    expect(responseA.raw).toContain('ALPHA_MARKER_A1B2C3');
  });

  it('thread A response does NOT contain thread B marker (no leakage)', () => {
    expect(responseA.raw).not.toContain('BRAVO_MARKER_X9Y8Z7');
  });

  it('thread B response contains its own marker', () => {
    expect(responseB.raw).toContain('BRAVO_MARKER_X9Y8Z7');
  });

  it('thread B response does NOT contain thread A marker (no leakage)', () => {
    expect(responseB.raw).not.toContain('ALPHA_MARKER_A1B2C3');
  });

  it('thread A persisted messages do not contain thread B marker', () => {
    const allText = JSON.stringify(responseA.messages);
    expect(allText).not.toContain('BRAVO_MARKER_X9Y8Z7');
  });

  it('thread B persisted messages do not contain thread A marker', () => {
    const allText = JSON.stringify(responseB.messages);
    expect(allText).not.toContain('ALPHA_MARKER_A1B2C3');
  });

  it('agent self-reports correct marker per thread', () => {
    expect(responseA.json?.marker).toBe('ALPHA');
    expect(responseB.json?.marker).toBe('BRAVO');
  });

  it('agent did NOT see the other thread\'s marker (got_other_marker=false on both)', () => {
    expect(responseA.json?.got_other_marker).toBe(false);
    expect(responseB.json?.got_other_marker).toBe(false);
  });

  it('every assistant message in thread A is attributed to thread A', () => {
    const wrongAttribution = responseA.messages.filter(
      (m) => m.role === 'assistant' && m.threadId && m.threadId !== responseA.threadId,
    );
    expect(wrongAttribution, `${wrongAttribution.length} thread A assistant messages have wrong threadId`).toEqual([]);
  });

  it('every assistant message in thread B is attributed to thread B', () => {
    const wrongAttribution = responseB.messages.filter(
      (m) => m.role === 'assistant' && m.threadId && m.threadId !== responseB.threadId,
    );
    expect(wrongAttribution, `${wrongAttribution.length} thread B assistant messages have wrong threadId`).toEqual([]);
  });

  it('trace: thread A has no orphaned tool calls', () => {
    new ToolCallTrace(responseA.messages).expectAllTerminal();
  });

  it('trace: thread B has no orphaned tool calls', () => {
    new ToolCallTrace(responseB.messages).expectAllTerminal();
  });

  it('refresh round-trip: thread A persisted state matches live', async () => {
    await assertRefreshReproducesState(client, responseA);
  });

  it('refresh round-trip: thread B persisted state matches live', async () => {
    await assertRefreshReproducesState(client, responseB);
  });
});
