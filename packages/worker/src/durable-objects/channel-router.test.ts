import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelRouter, type ReplyIntent } from './channel-router.js';

describe('ChannelRouter', () => {
  let router: ChannelRouter;

  beforeEach(() => {
    router = new ChannelRouter();
  });

  // ── trackReply ──────────────────────────────────────────────────────────

  describe('trackReply', () => {
    it('starts with no pending reply', () => {
      expect(router.hasPending).toBe(false);
      expect(router.pendingSnapshot).toBeNull();
    });

    it('tracks a reply target', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:thread_ts' });

      expect(router.hasPending).toBe(true);
      expect(router.pendingSnapshot).toEqual({
        channelType: 'slack',
        channelId: 'C123:thread_ts',
        resultContent: null,
        resultMessageId: null,
        handled: false,
      });
    });

    it('overwrites previous tracking on new prompt', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.trackReply({ channelType: 'telegram', channelId: 'chat_456' });

      expect(router.pendingSnapshot?.channelType).toBe('telegram');
      expect(router.pendingSnapshot?.channelId).toBe('chat_456');
    });
  });

  // ── setResult ───────────────────────────────────────────────────────────

  describe('setResult', () => {
    it('attaches result content to pending reply', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('Hello from the agent', 'msg-001');

      expect(router.pendingSnapshot?.resultContent).toBe('Hello from the agent');
      expect(router.pendingSnapshot?.resultMessageId).toBe('msg-001');
    });

    it('no-ops when no pending reply', () => {
      router.setResult('Hello', 'msg-001');
      expect(router.hasPending).toBe(false);
    });

    it('no-ops when pending reply is already handled', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.markHandled('slack', 'C123:t1');
      router.setResult('Hello', 'msg-001');

      expect(router.pendingSnapshot?.resultContent).toBeNull();
    });

    it('overwrites previous result on subsequent finalize', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('First attempt', 'msg-001');
      router.setResult('Second attempt', 'msg-002');

      expect(router.pendingSnapshot?.resultContent).toBe('Second attempt');
      expect(router.pendingSnapshot?.resultMessageId).toBe('msg-002');
    });
  });

  // ── markHandled ─────────────────────────────────────────────────────────

  describe('markHandled', () => {
    it('marks matching channel as handled', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.markHandled('slack', 'C123:t1');

      expect(router.pendingSnapshot?.handled).toBe(true);
    });

    it('does not mark if channel does not match', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.markHandled('slack', 'C999:t2');

      expect(router.pendingSnapshot?.handled).toBe(false);
    });

    it('does not mark if channel type does not match', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.markHandled('telegram', 'C123:t1');

      expect(router.pendingSnapshot?.handled).toBe(false);
    });

    it('no-ops when no pending reply', () => {
      // Should not throw
      router.markHandled('slack', 'C123:t1');
      expect(router.hasPending).toBe(false);
    });
  });

  // ── consumePendingReply ─────────────────────────────────────────────────

  describe('consumePendingReply', () => {
    it('returns reply intent when result is set and not handled', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('Agent response', 'msg-001');

      const intent = router.consumePendingReply();

      expect(intent).toEqual({
        channelType: 'slack',
        channelId: 'C123:t1',
        content: 'Agent response',
        messageId: 'msg-001',
      } satisfies ReplyIntent);
    });

    it('clears state after consumption', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('Agent response', 'msg-001');

      router.consumePendingReply();

      expect(router.hasPending).toBe(false);
      expect(router.consumePendingReply()).toBeNull();
    });

    it('returns null when no pending reply', () => {
      expect(router.consumePendingReply()).toBeNull();
    });

    it('returns null when pending reply was handled', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('Agent response', 'msg-001');
      router.markHandled('slack', 'C123:t1');

      expect(router.consumePendingReply()).toBeNull();
    });

    it('returns null when no result content was set', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });

      expect(router.consumePendingReply()).toBeNull();
    });

    it('clears state even when returning null', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });

      router.consumePendingReply();

      expect(router.hasPending).toBe(false);
    });
  });

  // ── recover ─────────────────────────────────────────────────────────────

  describe('recover', () => {
    it('rehydrates pending state from prompt_queue data', () => {
      router.recover('slack', 'C123:t1');

      expect(router.hasPending).toBe(true);
      expect(router.pendingSnapshot).toEqual({
        channelType: 'slack',
        channelId: 'C123:t1',
        resultContent: null,
        resultMessageId: null,
        handled: false,
      });
    });

    it('allows setting result after recovery', () => {
      router.recover('slack', 'C123:t1');
      router.setResult('Recovered response', 'msg-recovered');

      const intent = router.consumePendingReply();
      expect(intent).toEqual({
        channelType: 'slack',
        channelId: 'C123:t1',
        content: 'Recovered response',
        messageId: 'msg-recovered',
      });
    });
  });

  // ── clear ───────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('resets all state', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('Hello', 'msg-001');

      router.clear();

      expect(router.hasPending).toBe(false);
      expect(router.consumePendingReply()).toBeNull();
    });

    it('no-ops when already empty', () => {
      router.clear();
      expect(router.hasPending).toBe(false);
    });
  });

  // ── pendingSnapshot immutability ────────────────────────────────────────

  describe('pendingSnapshot', () => {
    it('returns a copy, not the internal state', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });

      const snapshot = router.pendingSnapshot!;
      // Use Object.assign to bypass Readonly for this mutation test
      Object.assign(snapshot, { handled: true, resultContent: 'tampered' });

      // Internal state should be unaffected
      expect(router.pendingSnapshot?.handled).toBe(false);
      expect(router.pendingSnapshot?.resultContent).toBeNull();
    });
  });

  // ── Full lifecycle ──────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('happy path: track → setResult → consume', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('The answer is 42', 'msg-final');

      const intent = router.consumePendingReply();
      expect(intent).not.toBeNull();
      expect(intent!.content).toBe('The answer is 42');
      expect(router.hasPending).toBe(false);
    });

    it('explicit reply path: track → markHandled → consume returns null', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.setResult('The answer is 42', 'msg-final');
      router.markHandled('slack', 'C123:t1');

      expect(router.consumePendingReply()).toBeNull();
    });

    it('dispatch failure path: track → clear', () => {
      router.trackReply({ channelType: 'slack', channelId: 'C123:t1' });
      router.clear();

      expect(router.consumePendingReply()).toBeNull();
    });

    it('hibernation recovery path: recover → setResult → consume', () => {
      router.recover('telegram', 'chat_789');
      router.setResult('Post-hibernation response', 'msg-wake');

      const intent = router.consumePendingReply();
      expect(intent).toEqual({
        channelType: 'telegram',
        channelId: 'chat_789',
        content: 'Post-hibernation response',
        messageId: 'msg-wake',
      });
    });

    it('web UI prompt (no channel): never tracks, consume returns null', () => {
      // DO simply never calls trackReply for web prompts
      expect(router.consumePendingReply()).toBeNull();
    });
  });
});
