# Session health monitor

## Problem

The SessionAgentDO has several independent recovery mechanisms for detecting and recovering from stuck states. They're scattered across the alarm handler, runner message handlers, the cron job in `index.ts`, and the Runner process. When recovery fires, the analytics are sparse — audit events with no structured cause data. When the system silently restarts, there's no way to attribute why.

Codex traced a specific failure mode: during rapid message sending (especially Telegram voice notes), the runner WebSocket drops during an abort, reconnects, but never sends `agentStatus: idle`. The DO sets `runnerReady=false` on reconnect and waits for idle to drain the queue. Idle never comes. Messages sit queued with `runnerBusy=false` until the session eventually dies and the auto-restart cron picks it up. No existing watchdog covers this case — they all require `runnerBusy=true`.

There are also two root bugs to fix alongside the monitoring work:
1. Runner doesn't emit idle on reconnect
2. Abort handler clears `runnerBusy` before `handlePromptComplete()`, creating a race where a rapid new prompt can be dispatched then immediately marked completed

## Goals

1. Fix the reconnect drain gap and abort race
2. Unified recovery analytics with cause attribution
3. One class that owns all watchdog evaluation logic
4. Catch the `runnerBusy=false` + queued items case that nothing covers today

## Non-goals

- Replacing the DO as the orchestrator of side effects
- Changing the sandbox spawn/terminate lifecycle
- Rewriting the prompt queue state machine

## Design

### SessionHealthMonitor class

New file: `packages/worker/src/durable-objects/session-health-monitor.ts`

A pure evaluator. Takes a snapshot of session state, returns recovery actions and analytics events. No DO dependencies, no side effects, fully unit-testable.

```ts
interface HealthSnapshot {
  now: number;
  runnerConnected: boolean;
  runnerReady: boolean;
  runnerBusy: boolean;
  queuedCount: number;
  processingCount: number;
  lastDispatchedAt: number;
  idleQueuedSince: number;       // 0 if not in idle-with-queued state
  errorSafetyNetAt: number;
  sessionStatus: string;
  runnerDisconnectedAt: number | null;
  runnerConnectedAt: number | null;
}

type RecoveryAction =
  | { type: 'revert_and_drain'; reason: string }
  | { type: 'drain_queue'; reason: string }
  | { type: 'force_complete'; reason: string }
  | { type: 'mark_not_busy'; reason: string }

interface RecoveryEvent {
  eventType: 'session.recovery';
  cause: string;
  properties: Record<string, unknown>;
}

interface RecoveryResult {
  actions: RecoveryAction[];
  events: RecoveryEvent[];
}
```

The `check(snapshot)` method evaluates all watchdog conditions and returns what should happen. The DO calls it from `onAlarm()` and executes the actions via a switch:

```ts
const result = this.healthMonitor.check(snapshot);
for (const event of result.events) {
  this.emitEvent(event.eventType, { ...event.properties, summary: event.cause });
}
for (const action of result.actions) {
  switch (action.type) {
    case 'revert_and_drain':
      this.promptQueue.revertProcessingToQueued();
      this.promptQueue.runnerBusy = false;
      this.promptQueue.clearDispatchTimers();
      await this.sendNextQueuedPrompt();
      break;
    case 'drain_queue':
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
  this.broadcastToClients({ type: 'status', data: { runnerBusy: this.promptQueue.runnerBusy, watchdogRecovery: true } });
  this.emitAuditEvent(`watchdog.${action.type}`, action.reason);
}
```

### Watchdog conditions

All existing conditions move into `check()`, plus two new ones:

| Condition | Existing? | Trigger | Action |
|-----------|-----------|---------|--------|
| Stuck processing | Yes (line 920) | `runnerBusy=true`, processing entries exist, `lastDispatchedAt` > 5min ago, runner disconnected | `revert_and_drain` |
| Stuck queue (busy, 0 processing) | Yes (line 937) | `runnerBusy=true`, 0 processing, queued > 0 | `mark_not_busy` + `drain_queue` if runner connected |
| Error safety-net | Yes (line 960) | `errorSafetyNetAt` set and expired, `runnerBusy=true` | `force_complete` |
| **Idle queue stuck** | **New** | `runnerBusy=false`, queued > 0, runner connected, persisted > 60s | `drain_queue` |
| **Ready timeout** | **New** | `runnerConnected=true`, `runnerReady=false`, persisted > 2min | emit event (no action — let existing grace period handle it) |

The 60s threshold for idle-queue-stuck prevents false positives from normal queue drain timing. To track duration without making the monitor stateful, PromptQueue records `idleQueuedSince` — the timestamp when the queue first had items while `runnerBusy` was false. It's set when `handlePromptComplete()` finishes with items still queued (drain failed or runner not connected), and cleared when the queue is successfully drained or becomes empty. The snapshot passes this to the monitor, which checks `now - idleQueuedSince > 60_000`. Using `lastDispatchedAt` as a proxy would cause false positives after disconnects where it reflects the old prompt's dispatch time.

The ready timeout is observation-only for now — it emits analytics so we can see how often it happens before deciding on automatic recovery. It uses `runnerConnectedAt` (a new field on RunnerLink, set in `upgradeRunner()`) to measure how long the runner has been connected without becoming ready.

### Recovery event schema

Every recovery emits a single `session.recovery` event to `analytics_events` with structured properties:

```ts
{
  eventType: 'session.recovery',
  cause: 'idle_queue_stuck',        // or 'stuck_processing', 'error_safety_net', etc.
  properties: {
    runnerConnected: true,
    runnerReady: false,
    runnerBusy: false,
    queuedCount: 2,
    processingCount: 0,
    lastDispatchedAt: 1711921234000,
    staleDurationMs: 65000,
    sessionStatus: 'running',
  }
}
```

This gives enough context to attribute cause after the fact. You can query `SELECT * FROM analytics_events WHERE event_type = 'session.recovery'` and group by cause.

### Bug fix 1: reconnect drain gap

In `packages/runner/src/bin.ts`, register a reconnect callback on `AgentClient` that checks OpenCode's status via `PromptHandler` before emitting idle. The fix goes in `bin.ts` (not `agent-client.ts`) because AgentClient has no access to OpenCode state — it only manages the DO WebSocket.

On reconnect, `bin.ts` calls into PromptHandler to check whether any channel has an active prompt. If no channel is busy, it sends `agentClient.sendAgentStatus('idle')`. If OpenCode is mid-generation, it skips the idle emit — the normal SSE flow will send idle when the generation finishes.

The DO's `agentStatus: idle` handler (line 2174) already drains queued items when `!runnerBusy && queue > 0`, so this is sufficient to unstick the queue.

### Bug fix 2: abort race

In `session-agent.ts`, the `aborted` handler at line 2278 sets `runnerBusy = false` and broadcasts `{ runnerBusy: false }` to clients before calling `handlePromptComplete()` at line 2288. Remove both the early `runnerBusy = false` assignment and the associated client broadcast from the abort handler. `handlePromptComplete()` already sets `runnerBusy = false` and broadcasts the status update (line 3296-3300), so the abort handler should just call `handlePromptComplete()` directly. This closes the window where a rapid prompt can observe `runnerBusy=false` and get dispatched, then immediately completed by `markCompleted()`.

### Bug fix 3: wire onFatal

Add a new runner-to-DO message type `runner-health` to the shared message types. This is distinct from `error` (which is turn-scoped and requires a `messageId`). The `runner-health` message carries a `kind` field (`'opencode_crash' | 'opencode_fatal' | 'upgrade_failure'`), an exit code, and a crash count.

In `packages/runner/src/bin.ts`, wire `openCodeManager.onFatal()` and `openCodeManager.onCrashed()` to send `runner-health` messages to the DO via the new message type.

In `session-agent.ts`, add a handler for `runner-health` that emits a `session.recovery` analytics event with the crash details. This makes OpenCode crashes visible in the session's analytics instead of disappearing into console logs.

## Files changed

| File | Change |
|------|--------|
| `packages/worker/src/durable-objects/session-health-monitor.ts` | New file — the monitor class |
| `packages/worker/src/durable-objects/session-health-monitor.test.ts` | New file — unit tests |
| `packages/worker/src/durable-objects/session-agent.ts` | Replace inline watchdog logic with `monitor.check()` call; fix abort race; add `runner-health` handler |
| `packages/worker/src/durable-objects/prompt-queue.ts` | Add `idleQueuedSince` state field |
| `packages/worker/src/durable-objects/runner-link.ts` | Add `connectedAt` timestamp |
| `packages/shared/src/types/index.ts` | Add `runner-health` message type to `RunnerToDOMessage` |
| `packages/runner/src/bin.ts` | Wire `onFatal`/`onCrashed` callbacks; emit idle on reconnect after checking OpenCode status |
| `packages/runner/src/agent-client.ts` | Add reconnect callback hook |

## Testing

The monitor is pure functions over snapshots, so unit tests cover all watchdog conditions directly. Each test constructs a `HealthSnapshot`, calls `check()`, and asserts the returned actions and events.

Integration testing: deploy, trigger rapid interrupts on a Telegram orchestrator session, verify that `session.recovery` events appear in the analytics table with correct cause attribution. Verify the reconnect drain gap no longer occurs.
