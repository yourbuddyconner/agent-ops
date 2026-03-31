# Session Health Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate scattered watchdog/recovery logic into a testable SessionHealthMonitor class, fix the reconnect drain gap and abort race, and add structured recovery analytics.

**Architecture:** Pure evaluator class that takes a HealthSnapshot and returns typed RecoveryActions + RecoveryEvents. The DO calls `check()` from its alarm handler and executes the actions. Bug fixes go in the runner (reconnect idle, onFatal wiring) and the DO (abort race).

**Tech Stack:** TypeScript, Vitest, Cloudflare Durable Objects, Bun (runner)

---

### Task 1: Add `runner-health` message type to shared protocol

**Files:**
- Modify: `packages/shared/src/types/runner-protocol.ts:305-464` (RunnerToDOMessage union)

- [ ] **Step 1: Add the new message variant**

Add to the `RunnerToDOMessage` union in `packages/shared/src/types/runner-protocol.ts`, after the `| { type: 'ping' }` line (407):

```ts
  | {
      type: 'runner-health';
      kind: 'opencode_crash' | 'opencode_fatal' | 'upgrade_failure';
      exitCode?: number;
      crashCount?: number;
      message?: string;
    }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (additive change, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/runner-protocol.ts
git commit -m "feat: add runner-health message type to runner protocol"
```

---

### Task 2: Add `idleQueuedSince` to PromptQueue

**Files:**
- Modify: `packages/worker/src/durable-objects/prompt-queue.ts:366-381`
- Test: `packages/worker/src/durable-objects/prompt-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/worker/src/durable-objects/prompt-queue.test.ts`:

```ts
describe('idleQueuedSince', () => {
  it('is 0 by default', () => {
    expect(pq.idleQueuedSince).toBe(0);
  });

  it('stores and retrieves a timestamp', () => {
    pq.idleQueuedSince = 1711921234000;
    expect(pq.idleQueuedSince).toBe(1711921234000);
  });

  it('clears when set to 0', () => {
    pq.idleQueuedSince = 1711921234000;
    pq.idleQueuedSince = 0;
    expect(pq.idleQueuedSince).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/prompt-queue.test.ts`
Expected: FAIL with "idleQueuedSince is not a property"

- [ ] **Step 3: Implement**

Add to `packages/worker/src/durable-objects/prompt-queue.ts` after the `errorSafetyNetAt` getter/setter (line 380):

```ts
  get idleQueuedSince(): number {
    return parseInt(this.getState('idleQueuedSince') || '0', 10);
  }

  set idleQueuedSince(ms: number) {
    this.setState('idleQueuedSince', ms ? String(ms) : '');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/prompt-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/durable-objects/prompt-queue.ts packages/worker/src/durable-objects/prompt-queue.test.ts
git commit -m "feat(prompt-queue): add idleQueuedSince state field"
```

---

### Task 3: Add `connectedAt` to RunnerLink

**Files:**
- Modify: `packages/worker/src/durable-objects/runner-link.ts:94-120`
- Test: `packages/worker/src/durable-objects/runner-link.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/worker/src/durable-objects/runner-link.test.ts`:

```ts
describe('connectedAt', () => {
  it('is null by default', () => {
    expect(rl.connectedAt).toBeNull();
  });

  it('stores and retrieves a timestamp', () => {
    rl.connectedAt = Date.now();
    expect(rl.connectedAt).toBeGreaterThan(0);
  });

  it('clears when set to null', () => {
    rl.connectedAt = Date.now();
    rl.connectedAt = null;
    expect(rl.connectedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/runner-link.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Add to `packages/worker/src/durable-objects/runner-link.ts` after the `token` setter (line 120):

```ts
  get connectedAt(): number | null {
    const val = this.deps.getState('runnerConnectedAt');
    return val ? parseInt(val, 10) : null;
  }

  set connectedAt(ms: number | null) {
    this.deps.setState('runnerConnectedAt', ms ? String(ms) : '');
  }
```

- [ ] **Step 4: Set connectedAt in upgradeRunner**

In `packages/worker/src/durable-objects/session-agent.ts`, find `upgradeRunner()` (around line 748 where `this.runnerLink.ready = false` is set). Add after it:

```ts
this.runnerLink.connectedAt = Date.now();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/runner-link.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/worker/src/durable-objects/runner-link.ts packages/worker/src/durable-objects/runner-link.test.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat(runner-link): add connectedAt timestamp"
```

---

### Task 4: Create SessionHealthMonitor

**Files:**
- Create: `packages/worker/src/durable-objects/session-health-monitor.ts`
- Create: `packages/worker/src/durable-objects/session-health-monitor.test.ts`

- [ ] **Step 1: Write the types and class skeleton**

Create `packages/worker/src/durable-objects/session-health-monitor.ts`:

```ts
/**
 * SessionHealthMonitor — pure evaluator for session health watchdog conditions.
 *
 * Owns:
 * - All watchdog condition evaluation (stuck processing, stuck queue, idle queue, ready timeout, error safety-net)
 * - Recovery action and analytics event generation
 *
 * Does NOT own: executing recovery actions, broadcasting, alarm scheduling.
 * The DO calls check() and executes the returned actions.
 */

export interface HealthSnapshot {
  now: number;
  runnerConnected: boolean;
  runnerReady: boolean;
  runnerBusy: boolean;
  queuedCount: number;
  processingCount: number;
  lastDispatchedAt: number;
  idleQueuedSince: number;
  errorSafetyNetAt: number;
  sessionStatus: string;
  runnerDisconnectedAt: number | null;
  runnerConnectedAt: number | null;
}

export type RecoveryAction =
  | { type: 'revert_and_drain'; reason: string }
  | { type: 'drain_queue'; reason: string }
  | { type: 'force_complete'; reason: string }
  | { type: 'mark_not_busy'; reason: string }

export interface RecoveryEvent {
  eventType: 'session.recovery';
  cause: string;
  properties: Record<string, unknown>;
}

export interface RecoveryResult {
  actions: RecoveryAction[];
  events: RecoveryEvent[];
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

const STUCK_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_QUEUE_STUCK_TIMEOUT_MS = 60 * 1000;
const READY_TIMEOUT_MS = 2 * 60 * 1000;

// ─── Monitor ─────────────────────────────────────────────────────────────────

export class SessionHealthMonitor {
  check(snapshot: HealthSnapshot): RecoveryResult {
    const actions: RecoveryAction[] = [];
    const events: RecoveryEvent[] = [];

    // Only evaluate when session is running
    if (snapshot.sessionStatus !== 'running') {
      return { actions, events };
    }

    this.checkStuckProcessing(snapshot, actions, events);
    this.checkStuckQueue(snapshot, actions, events);
    this.checkErrorSafetyNet(snapshot, actions, events);
    this.checkIdleQueueStuck(snapshot, actions, events);
    this.checkReadyTimeout(snapshot, events);

    return { actions, events };
  }

  private buildProperties(snapshot: HealthSnapshot, extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      runnerConnected: snapshot.runnerConnected,
      runnerReady: snapshot.runnerReady,
      runnerBusy: snapshot.runnerBusy,
      queuedCount: snapshot.queuedCount,
      processingCount: snapshot.processingCount,
      lastDispatchedAt: snapshot.lastDispatchedAt,
      sessionStatus: snapshot.sessionStatus,
      ...extra,
    };
  }

  // ─── Stuck Processing ──────────────────────────────────────────────────────

  private checkStuckProcessing(
    s: HealthSnapshot,
    actions: RecoveryAction[],
    events: RecoveryEvent[],
  ): void {
    if (!s.runnerBusy) return;
    if (s.processingCount === 0) return;
    if (s.runnerConnected) return;
    if (!s.lastDispatchedAt) return;
    const elapsed = s.now - s.lastDispatchedAt;
    if (elapsed < STUCK_PROCESSING_TIMEOUT_MS) return;

    const reason = `Prompt stuck in processing for ${Math.round(elapsed / 1000)}s with no runner`;
    actions.push({ type: 'revert_and_drain', reason });
    events.push({
      eventType: 'session.recovery',
      cause: 'stuck_processing',
      properties: this.buildProperties(s, { staleDurationMs: elapsed }),
    });
  }

  // ─── Stuck Queue (busy, 0 processing) ─────────────────────────────────────

  private checkStuckQueue(
    s: HealthSnapshot,
    actions: RecoveryAction[],
    events: RecoveryEvent[],
  ): void {
    if (!s.runnerBusy) return;
    if (s.processingCount > 0) return;
    if (s.queuedCount === 0) return;

    const reason = `runnerBusy=true with ${s.queuedCount} queued items but 0 processing`;
    actions.push({ type: 'mark_not_busy', reason });
    if (s.runnerConnected) {
      actions.push({ type: 'drain_queue', reason });
    }
    events.push({
      eventType: 'session.recovery',
      cause: 'stuck_queue_busy_no_processing',
      properties: this.buildProperties(s),
    });
  }

  // ─── Error Safety-Net ──────────────────────────────────────────────────────

  private checkErrorSafetyNet(
    s: HealthSnapshot,
    actions: RecoveryAction[],
    events: RecoveryEvent[],
  ): void {
    if (!s.errorSafetyNetAt) return;
    if (s.now < s.errorSafetyNetAt) return;

    if (s.runnerBusy) {
      actions.push({ type: 'force_complete', reason: 'Forced prompt complete after error safety-net timeout' });
    }
    events.push({
      eventType: 'session.recovery',
      cause: 'error_safety_net',
      properties: this.buildProperties(s, {
        errorSafetyNetAt: s.errorSafetyNetAt,
        staleDurationMs: s.now - s.errorSafetyNetAt,
      }),
    });
  }

  // ─── Idle Queue Stuck (new) ────────────────────────────────────────────────

  private checkIdleQueueStuck(
    s: HealthSnapshot,
    actions: RecoveryAction[],
    events: RecoveryEvent[],
  ): void {
    if (s.runnerBusy) return;
    if (s.queuedCount === 0) return;
    if (!s.runnerConnected) return;
    if (!s.idleQueuedSince) return;
    const elapsed = s.now - s.idleQueuedSince;
    if (elapsed < IDLE_QUEUE_STUCK_TIMEOUT_MS) return;

    const reason = `${s.queuedCount} items queued for ${Math.round(elapsed / 1000)}s with runner idle`;
    actions.push({ type: 'drain_queue', reason });
    events.push({
      eventType: 'session.recovery',
      cause: 'idle_queue_stuck',
      properties: this.buildProperties(s, { staleDurationMs: elapsed, idleQueuedSince: s.idleQueuedSince }),
    });
  }

  // ─── Ready Timeout (observation only) ──────────────────────────────────────

  private checkReadyTimeout(
    s: HealthSnapshot,
    events: RecoveryEvent[],
  ): void {
    if (!s.runnerConnected) return;
    if (s.runnerReady) return;
    if (!s.runnerConnectedAt) return;
    const elapsed = s.now - s.runnerConnectedAt;
    if (elapsed < READY_TIMEOUT_MS) return;

    events.push({
      eventType: 'session.recovery',
      cause: 'ready_timeout',
      properties: this.buildProperties(s, {
        staleDurationMs: elapsed,
        runnerConnectedAt: s.runnerConnectedAt,
      }),
    });
  }
}
```

- [ ] **Step 2: Write tests**

Create `packages/worker/src/durable-objects/session-health-monitor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SessionHealthMonitor, type HealthSnapshot } from './session-health-monitor.js';

function baseSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    now: Date.now(),
    runnerConnected: true,
    runnerReady: true,
    runnerBusy: false,
    queuedCount: 0,
    processingCount: 0,
    lastDispatchedAt: 0,
    idleQueuedSince: 0,
    errorSafetyNetAt: 0,
    sessionStatus: 'running',
    runnerDisconnectedAt: null,
    runnerConnectedAt: Date.now() - 10_000,
    ...overrides,
  };
}

describe('SessionHealthMonitor', () => {
  const monitor = new SessionHealthMonitor();

  it('returns nothing for a healthy session', () => {
    const result = monitor.check(baseSnapshot());
    expect(result.actions).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('returns nothing for non-running sessions', () => {
    const result = monitor.check(baseSnapshot({ sessionStatus: 'hibernated', queuedCount: 5, idleQueuedSince: 1 }));
    expect(result.actions).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  describe('stuck processing', () => {
    it('reverts when processing is stuck and runner disconnected', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        runnerConnected: false,
        processingCount: 1,
        lastDispatchedAt: now - 6 * 60 * 1000,
      }));
      expect(result.actions).toEqual([{ type: 'revert_and_drain', reason: expect.stringContaining('stuck in processing') }]);
      expect(result.events[0].cause).toBe('stuck_processing');
    });

    it('does not fire when runner is connected', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        runnerConnected: true,
        processingCount: 1,
        lastDispatchedAt: now - 6 * 60 * 1000,
      }));
      expect(result.actions).toHaveLength(0);
    });

    it('does not fire before timeout', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        runnerConnected: false,
        processingCount: 1,
        lastDispatchedAt: now - 60 * 1000,
      }));
      expect(result.actions).toHaveLength(0);
    });
  });

  describe('stuck queue (busy, 0 processing)', () => {
    it('clears busy and drains when runner connected', () => {
      const result = monitor.check(baseSnapshot({
        runnerBusy: true,
        runnerConnected: true,
        processingCount: 0,
        queuedCount: 3,
      }));
      expect(result.actions).toEqual([
        { type: 'mark_not_busy', reason: expect.any(String) },
        { type: 'drain_queue', reason: expect.any(String) },
      ]);
      expect(result.events[0].cause).toBe('stuck_queue_busy_no_processing');
    });

    it('clears busy without drain when runner disconnected', () => {
      const result = monitor.check(baseSnapshot({
        runnerBusy: true,
        runnerConnected: false,
        processingCount: 0,
        queuedCount: 3,
      }));
      expect(result.actions).toEqual([
        { type: 'mark_not_busy', reason: expect.any(String) },
      ]);
    });
  });

  describe('error safety-net', () => {
    it('forces complete when expired and runner busy', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        errorSafetyNetAt: now - 1000,
      }));
      expect(result.actions).toEqual([{ type: 'force_complete', reason: expect.any(String) }]);
      expect(result.events[0].cause).toBe('error_safety_net');
    });

    it('emits event but no action when not busy', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: false,
        errorSafetyNetAt: now - 1000,
      }));
      expect(result.actions).toHaveLength(0);
      expect(result.events[0].cause).toBe('error_safety_net');
    });

    it('does not fire before expiry', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        errorSafetyNetAt: now + 30_000,
      }));
      const safetyEvents = result.events.filter(e => e.cause === 'error_safety_net');
      expect(safetyEvents).toHaveLength(0);
    });
  });

  describe('idle queue stuck', () => {
    it('drains when queue idle for >60s with runner connected', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: false,
        runnerConnected: true,
        queuedCount: 2,
        idleQueuedSince: now - 65_000,
      }));
      expect(result.actions).toEqual([{ type: 'drain_queue', reason: expect.stringContaining('items queued') }]);
      expect(result.events[0].cause).toBe('idle_queue_stuck');
    });

    it('does not fire before 60s', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: false,
        runnerConnected: true,
        queuedCount: 2,
        idleQueuedSince: now - 30_000,
      }));
      expect(result.actions).toHaveLength(0);
    });

    it('does not fire when runner disconnected', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: false,
        runnerConnected: false,
        queuedCount: 2,
        idleQueuedSince: now - 65_000,
      }));
      expect(result.actions).toHaveLength(0);
    });

    it('does not fire when runnerBusy', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerBusy: true,
        runnerConnected: true,
        queuedCount: 2,
        idleQueuedSince: now - 65_000,
      }));
      // Should be caught by stuck_queue_busy_no_processing instead, not idle_queue_stuck
      const idleEvents = result.events.filter(e => e.cause === 'idle_queue_stuck');
      expect(idleEvents).toHaveLength(0);
    });
  });

  describe('ready timeout', () => {
    it('emits event when connected but not ready for >2min', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerConnected: true,
        runnerReady: false,
        runnerConnectedAt: now - 3 * 60 * 1000,
      }));
      expect(result.actions).toHaveLength(0);
      expect(result.events[0].cause).toBe('ready_timeout');
    });

    it('does not fire before 2min', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerConnected: true,
        runnerReady: false,
        runnerConnectedAt: now - 60_000,
      }));
      const readyEvents = result.events.filter(e => e.cause === 'ready_timeout');
      expect(readyEvents).toHaveLength(0);
    });

    it('does not fire when already ready', () => {
      const now = Date.now();
      const result = monitor.check(baseSnapshot({
        now,
        runnerConnected: true,
        runnerReady: true,
        runnerConnectedAt: now - 3 * 60 * 1000,
      }));
      const readyEvents = result.events.filter(e => e.cause === 'ready_timeout');
      expect(readyEvents).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/session-health-monitor.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-health-monitor.ts packages/worker/src/durable-objects/session-health-monitor.test.ts
git commit -m "feat: add SessionHealthMonitor class with tests"
```

---

### Task 5: Replace inline watchdog logic in alarm handler

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts:920-973` (alarm handler watchdog section)

- [ ] **Step 1: Import and instantiate the monitor**

At the top of `session-agent.ts`, add:

```ts
import { SessionHealthMonitor, type HealthSnapshot } from './session-health-monitor.js';
```

In the `SessionAgentDO` class, add a field:

```ts
private readonly healthMonitor = new SessionHealthMonitor();
```

- [ ] **Step 2: Add a `buildHealthSnapshot` helper**

Add a private method to the DO:

```ts
private buildHealthSnapshot(): HealthSnapshot {
  return {
    now: Date.now(),
    runnerConnected: this.runnerLink.isConnected,
    runnerReady: this.runnerLink.isReady,
    runnerBusy: this.promptQueue.runnerBusy,
    queuedCount: this.promptQueue.length,
    processingCount: this.promptQueue.processingCount,
    lastDispatchedAt: this.promptQueue.lastPromptDispatchedAt,
    idleQueuedSince: this.promptQueue.idleQueuedSince,
    errorSafetyNetAt: this.promptQueue.errorSafetyNetAt,
    sessionStatus: this.sessionState.status,
    runnerDisconnectedAt: this.runnerDisconnectedAt,
    runnerConnectedAt: this.runnerLink.connectedAt,
  };
}
```

- [ ] **Step 3: Replace the inline watchdog blocks**

Replace the three blocks in the alarm handler (lines 920-973: stuck-processing watchdog, stuck-queue watchdog, error safety-net) with:

```ts
    // ─── Health Monitor ──────────────────────────────────────────────────
    {
      const snapshot = this.buildHealthSnapshot();
      const result = this.healthMonitor.check(snapshot);

      for (const event of result.events) {
        this.emitEvent(event.eventType, {
          summary: event.cause,
          properties: event.properties,
        });
      }

      for (const action of result.actions) {
        switch (action.type) {
          case 'revert_and_drain':
            this.promptQueue.revertProcessingToQueued();
            this.promptQueue.runnerBusy = false;
            this.promptQueue.clearDispatchTimers();
            this.promptQueue.idleQueuedSince = 0;
            if (this.runnerLink.isConnected) {
              await this.sendNextQueuedPrompt();
            }
            break;
          case 'drain_queue':
            this.promptQueue.idleQueuedSince = 0;
            await this.sendNextQueuedPrompt();
            break;
          case 'force_complete':
            this.promptQueue.errorSafetyNetAt = 0;
            await this.handlePromptComplete();
            break;
          case 'mark_not_busy':
            this.promptQueue.runnerBusy = false;
            this.promptQueue.clearDispatchTimers();
            break;
        }
        this.broadcastToClients({
          type: 'status',
          data: { runnerBusy: this.promptQueue.runnerBusy, watchdogRecovery: true },
        });
        this.emitAuditEvent(`watchdog.${action.type}`, action.reason);
      }
    }
```

- [ ] **Step 4: Set `idleQueuedSince` at the right moments**

In `handlePromptComplete()` (around line 3282), after the queue drain attempt, if the queue still has items and we're setting `runnerBusy=false`, record when the idle-with-queued state started:

```ts
// After the existing: if (await this.sendNextQueuedPrompt()) { ... return; }
// In the else branch where queue is empty or drain returned false:
if (this.promptQueue.length > 0 && !this.promptQueue.runnerBusy) {
  if (!this.promptQueue.idleQueuedSince) {
    this.promptQueue.idleQueuedSince = Date.now();
  }
} else {
  this.promptQueue.idleQueuedSince = 0;
}
```

Also clear `idleQueuedSince` when a prompt is successfully dispatched. In `sendNextQueuedPrompt()` after the successful dispatch (around line 3947 after `stampDispatched`):

```ts
this.promptQueue.idleQueuedSince = 0;
```

And in the direct dispatch path of `handlePrompt()` (around line 1518 after `stampDispatched`):

```ts
this.promptQueue.idleQueuedSince = 0;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "refactor: replace inline watchdog logic with SessionHealthMonitor"
```

---

### Task 6: Fix abort race

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts:2276-2289` (aborted handler)

- [ ] **Step 1: Remove early runnerBusy clear and broadcast from abort handler**

Replace the `'aborted'` handler (lines 2276-2289):

```ts
      'aborted': async (msg) => {
        // Runner confirmed abort — mark idle, broadcast
        this.promptQueue.runnerBusy = false;
        this.broadcastToClients({
          type: 'agentStatus',
          status: 'idle',
        });
        this.broadcastToClients({
          type: 'status',
          data: { runnerBusy: false, aborted: true },
        });
        // Drain the queue — if prompts were queued after abort, process them now
        await this.handlePromptComplete();
      },
```

With:

```ts
      'aborted': async (_msg) => {
        // Runner confirmed abort — let handlePromptComplete clear runnerBusy
        // and broadcast status. Don't clear runnerBusy early — that creates a
        // race where a rapid new prompt can be dispatched then immediately
        // completed by markCompleted().
        this.broadcastToClients({
          type: 'agentStatus',
          status: 'idle',
        });
        await this.handlePromptComplete();
      },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "fix: remove early runnerBusy clear from abort handler to prevent race"
```

---

### Task 7: Fix reconnect drain gap

**Files:**
- Modify: `packages/runner/src/agent-client.ts:125-136` (open handler)
- Modify: `packages/runner/src/bin.ts:160-175`
- Modify: `packages/runner/src/prompt.ts`

- [ ] **Step 1: Add reconnect callback to AgentClient**

In `packages/runner/src/agent-client.ts`, add a callback field and registration method near the other fields (around line 58):

```ts
  private reconnectCallback?: () => void;
```

Add the registration method:

```ts
  onReconnect(cb: () => void): void {
    this.reconnectCallback = cb;
  }
```

In the `open` event handler (line 125-136), after `resolve()` (line 135), add:

```ts
        if (this.hasEverConnected && this.reconnectCallback) {
          this.reconnectCallback();
        }
```

Note: `hasEverConnected` is set to true on first connect (line 132). On the first connect, `hasEverConnected` was false *before* this open handler sets it to true on line 132, so `this.hasEverConnected` is true by the time we reach the check. To avoid firing on first connect, check the value *before* it's set. Move the reconnect check before line 132:

Actually, `hasEverConnected` is already true after line 132 runs. The callback should only fire on reconnect (not first connect). Add a local flag:

```ts
        const isReconnect = this.hasEverConnected;
```

Add this line right after `if (this.ws !== socket) return;` (line 126), before `this.hasEverConnected = true` (line 132). Then after `resolve()`:

```ts
        if (isReconnect && this.reconnectCallback) {
          this.reconnectCallback();
        }
```

- [ ] **Step 2: Add `isAnyChannelBusy` to PromptHandler**

In `packages/runner/src/prompt.ts`, add a public method:

```ts
  isAnyChannelBusy(): boolean {
    for (const ch of this.channels.values()) {
      if (ch.activeMessageId) return true;
    }
    return false;
  }
```

- [ ] **Step 3: Wire the reconnect callback in bin.ts**

In `packages/runner/src/bin.ts`, after the `promptHandler` is created (around line 349), add:

```ts
  agentClient.onReconnect(() => {
    if (!promptHandler.isAnyChannelBusy()) {
      console.log('[Runner] Reconnected while idle — sending agentStatus idle to drain queued work');
      agentClient.sendAgentStatus('idle');
    } else {
      console.log('[Runner] Reconnected while busy — skipping idle emit, SSE will send it when done');
    }
  });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/agent-client.ts packages/runner/src/prompt.ts packages/runner/src/bin.ts
git commit -m "fix: emit agentStatus idle on runner reconnect to drain stuck queues"
```

---

### Task 8: Wire onFatal and onCrashed

**Files:**
- Modify: `packages/runner/src/bin.ts:160-165`
- Modify: `packages/worker/src/durable-objects/session-agent.ts` (runner message handlers)

- [ ] **Step 1: Add `sendRunnerHealth` to AgentClient**

In `packages/runner/src/agent-client.ts`, add:

```ts
  sendRunnerHealth(kind: 'opencode_crash' | 'opencode_fatal' | 'upgrade_failure', details?: { exitCode?: number; crashCount?: number; message?: string }): void {
    this.send({ type: 'runner-health', kind, ...details });
  }
```

- [ ] **Step 2: Wire callbacks in bin.ts**

In `packages/runner/src/bin.ts`, after the `openCodeManager` is created (around line 165), add:

```ts
  openCodeManager.onCrashed((exitCode) => {
    console.log(`[Runner] OpenCode crashed with exit code ${exitCode}`);
    agentClient.sendRunnerHealth('opencode_crash', { exitCode });
  });

  openCodeManager.onFatal(() => {
    console.log('[Runner] OpenCode entered fatal state');
    agentClient.sendRunnerHealth('opencode_fatal', { message: 'OpenCode entered fatal state after too many crashes' });
  });
```

- [ ] **Step 3: Add handler in session-agent.ts**

In the runner message handlers object (where `'complete'`, `'error'`, etc. are handled), add:

```ts
      'runner-health': (msg) => {
        const kind = msg.kind;
        const detail = [
          kind,
          msg.exitCode != null ? `exit=${msg.exitCode}` : '',
          msg.crashCount != null ? `crashes=${msg.crashCount}` : '',
          msg.message || '',
        ].filter(Boolean).join(', ');

        console.warn(`[SessionAgentDO] Runner health event: ${detail}`);

        this.emitEvent('session.recovery', {
          summary: `runner_health: ${kind}`,
          properties: {
            kind,
            exitCode: msg.exitCode,
            crashCount: msg.crashCount,
            message: msg.message,
          },
        });
        this.emitAuditEvent('runner.health', detail);
      },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/agent-client.ts packages/runner/src/bin.ts packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat: wire OpenCode crash/fatal events to DO analytics via runner-health message"
```

---

### Task 9: Final typecheck and test run

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Verify no regressions in existing watchdog tests**

Run: `cd packages/worker && pnpm vitest run src/durable-objects/`
Expected: PASS

- [ ] **Step 4: Commit any remaining changes**

If any fixes were needed, commit them individually with descriptive messages.
