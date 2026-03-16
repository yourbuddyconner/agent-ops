# Action Approval UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make action approval cards reviewable at a glance by requiring the model to provide a summary and redesigning the UI to show it prominently with expandable structured detail.

**Architecture:** Add a required `summary` field to the `call_tool` pipeline (OpenCode tool → runner gateway → agent-client WebSocket → SessionAgent DO). The summary replaces the JSON dump as the approval card body. The frontend renders it as primary text with a "Show details" toggle for formatted key-value params.

**Tech Stack:** TypeScript, React, Hono (runner gateway), Cloudflare Durable Objects, Slack Block Kit, Telegram Bot API

---

### Task 1: Add `summary` to the OpenCode `call_tool` tool definition

This is the model-facing tool. Adding `summary` as a required arg here forces the model to explain every tool call.

**Files:**
- Modify: `docker/opencode/tools/call_tool.ts`

**Step 1: Add `summary` arg to the tool definition**

In `docker/opencode/tools/call_tool.ts`, add a required `summary` argument and pass it through to the gateway:

```typescript
export default tool({
  description:
    "Call a tool by its ID with the given parameters. Use list_tools first to discover available tools and their required parameters.",
  args: {
    tool_id: tool.schema
      .string()
      .describe("The fully-qualified tool ID (e.g. 'gmail:send_email', 'github:create_issue')"),
    params: tool.schema
      .string()
      .optional()
      .describe("JSON object of parameters for the tool. Must match the schema from list_tools."),
    summary: tool.schema
      .string()
      .describe("A brief, human-readable summary of what this tool call will do and why. This is shown to the user for approval. Example: 'Send a Slack message to #engineering with the deployment status update'"),
  },
  async execute(args) {
    try {
      if (!args.tool_id) {
        return "Error: tool_id is required. Use list_tools to discover available tools."
      }
      if (!args.summary) {
        return "Error: summary is required. Provide a brief human-readable description of what this tool call does."
      }

      let params: Record<string, unknown> = {}
      if (args.params) {
        try {
          params = JSON.parse(args.params)
        } catch {
          return "Error: params must be a valid JSON object."
        }
      }

      const res = await fetch("http://localhost:9000/api/tools/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: args.tool_id, params, summary: args.summary }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Tool call failed: ${errText}`
      }

      const data = (await res.json()) as { result?: unknown; error?: string }
      if (data.error) {
        return `Tool error: ${data.error}`
      }

      if (data.result === undefined || data.result === null) {
        return "Tool executed successfully (no data returned)."
      }

      return formatOutput(data.result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to call tool: ${msg}`
    }
  },
})
```

**Step 2: Commit**

```bash
git add docker/opencode/tools/call_tool.ts
git commit -m "feat: add required summary arg to call_tool OpenCode tool"
```

---

### Task 2: Thread `summary` through the runner gateway and agent-client

The runner gateway receives the HTTP call from OpenCode, passes it to the callback, which sends it over WebSocket to the DO. All three need `summary`.

**Files:**
- Modify: `packages/runner/src/gateway.ts:700,1842-1857`
- Modify: `packages/runner/src/agent-client.ts:766-771`
- Modify: `packages/runner/src/bin.ts:322-331`

**Step 1: Update the gateway callback type and HTTP handler**

In `packages/runner/src/gateway.ts`:

Line 700 — update the `onCallTool` callback signature:
```typescript
onCallTool?: (toolId: string, params: Record<string, unknown>, summary?: string) => Promise<{ result: unknown }>;
```

Lines 1842-1857 — update the HTTP handler to extract and pass `summary`:
```typescript
app.post("/api/tools/call", async (c) => {
    if (!callbacks.onCallTool) {
      return c.json({ error: "Call tool handler not configured" }, 500);
    }
    try {
      const body = await c.req.json() as { toolId?: string; params?: Record<string, unknown>; summary?: string };
      if (!body.toolId) {
        return c.json({ error: "Missing required field: toolId" }, 400);
      }
      const result = await callbacks.onCallTool(body.toolId, body.params || {}, body.summary);
      return c.json(result);
    } catch (err) {
      console.error("[Gateway] Call tool error:", err);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
```

**Step 2: Update agent-client `requestCallTool`**

In `packages/runner/src/agent-client.ts`, line 766:
```typescript
requestCallTool(toolId: string, params: Record<string, unknown>, summary?: string): Promise<{ result: unknown }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, TOOL_OP_TIMEOUT_MS, () => {
      this.send({ type: "call-tool", requestId, toolId, params, summary });
    });
  }
```

**Step 3: Update bin.ts callback to pass summary through**

In `packages/runner/src/bin.ts`, line 322:
```typescript
onCallTool: async (toolId, params, summary) => {
      // Enforce whitelist on tool invocation
      if (activeToolWhitelist) {
        const { service, actionId } = parseToolId(toolId);
        if (!isToolAllowed(service, actionId)) {
          throw new Error(`Tool "${toolId}" is not available for this persona`);
        }
      }
      return await agentClient.requestCallTool(toolId, params, summary);
    },
```

**Step 4: Commit**

```bash
git add packages/runner/src/gateway.ts packages/runner/src/agent-client.ts packages/runner/src/bin.ts
git commit -m "feat: thread summary through runner gateway and agent-client"
```

---

### Task 3: Use `summary` in SessionAgent DO approval logic

The DO receives `call-tool` with `summary` and should use it as the approval body instead of the JSON dump.

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts:3379-3381,8838,8947-9007`

**Step 1: Update the call-tool case to extract summary**

At line 3379:
```typescript
case 'call-tool':
  await this.handleCallTool(msg.requestId!, msg.toolId!, msg.params ?? {}, msg.summary);
  break;
```

**Step 2: Update handleCallTool signature and approval body**

At line 8838, add `summary` parameter:
```typescript
private async handleCallTool(requestId: string, toolId: string, params: Record<string, unknown>, summary?: string) {
```

At lines 8947-8968, add `summary` to context and replace the body formatting:

```typescript
const approvalContext: Record<string, unknown> = {
  toolId,
  service,
  actionId,
  params,
  riskLevel,
  isOrgScoped,
  invocationId: invocationResult.invocationId,
  summary,  // <-- add summary to context
};
const approvalCh = this.activeChannel;
if (approvalCh) {
  approvalContext.channelType = approvalCh.channelType;
  approvalContext.channelId = approvalCh.channelId;
}

// Use model-provided summary as the body; fall back to action name if missing
const approvalBody = summary || `\`${toolId}\` (risk: **${riskLevel}**)`;
```

This removes the old JSON dump formatting entirely. The `params` remain available in `context.params` for the expandable detail UI.

**Step 3: Validate summary is present**

Before the approval section (right after risk level is resolved, around line 8940), add a validation error if summary is missing on approval-required actions:

```typescript
if (invocationResult.outcome === 'pending_approval' && !summary) {
  this.sendToRunner({
    type: 'call-tool-result',
    requestId,
    error: `Action "${toolId}" requires approval but no summary was provided. The call_tool summary parameter is required.`,
  } as any);
  return;
}
```

**Step 4: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat: use model-provided summary as approval body in SessionAgent"
```

---

### Task 4: Redesign the frontend approval card

Replace the current flat text rendering with a summary-first layout and expandable structured detail.

**Files:**
- Modify: `packages/client/src/components/session/interactive-prompt-card.tsx`

**Step 1: Rewrite the component**

Replace the entire `InteractivePromptCard` component with the new design:

```tsx
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApproveAction, useDenyAction } from '@/api/action-invocations';
import type { InteractivePromptState } from '@/hooks/use-chat';

function useCountdown(expiresAt?: number) {
  const [remaining, setRemaining] = React.useState<string>('');

  React.useEffect(() => {
    if (!expiresAt) return;

    function update() {
      const diff = expiresAt! - Date.now();
      if (diff <= 0) {
        setRemaining('expired');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

// ─── Param Formatting Utilities ─────────────────────────────────────────────

/** Convert camelCase or snake_case key to human-readable label */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Check if a string looks like an ID (UUID, hex, etc.) */
function looksLikeId(value: string): boolean {
  return /^[a-f0-9-]{20,}$/i.test(value) || /^[A-Za-z0-9_-]{15,}$/.test(value);
}

/** Check if a string contains markdown formatting */
function looksLikeMarkdown(value: string): boolean {
  return /[#*_`\[\]|]/.test(value) && value.length > 50;
}

function ParamValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-neutral-400">null</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (typeof value === 'number') {
    return <span className="font-mono text-xs">{value}</span>;
  }

  if (typeof value === 'string') {
    if (looksLikeId(value)) {
      return <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{value}</code>;
    }
    if (value.length > 200 && looksLikeMarkdown(value)) {
      return (
        <div className="mt-1 max-h-48 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800/50">
          <pre className="whitespace-pre-wrap">{value}</pre>
        </div>
      );
    }
    if (value.length > 200) {
      return <span className="text-xs">{value.slice(0, 200)}…</span>;
    }
    return <span className="text-xs">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="italic text-neutral-400">[]</span>;
    if (value.every((v) => typeof v === 'string') && value.length <= 5) {
      return <span className="text-xs">{value.join(', ')}</span>;
    }
    return (
      <ul className="ml-4 list-disc text-xs">
        {value.map((item, i) => (
          <li key={i}><ParamValue value={item} /></li>
        ))}
      </ul>
    );
  }

  if (typeof value === 'object') {
    return (
      <div className="ml-2 border-l border-neutral-200 pl-2 dark:border-neutral-700">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="mt-1">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{humanizeKey(k)}: </span>
            <ParamValue value={v} />
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-xs">{String(value)}</span>;
}

function ExpandableParams({ params }: { params: Record<string, unknown> }) {
  const [expanded, setExpanded] = React.useState(false);
  const entries = Object.entries(params);

  if (entries.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
          {entries.map(([key, value]) => (
            <div key={key}>
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{humanizeKey(key)}: </span>
              <ParamValue value={value} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface InteractivePromptCardProps {
  prompt: InteractivePromptState;
  onAnswer: (promptId: string, answer: string | boolean) => void;
  onApproveWs?: (invocationId: string) => void;
  onDenyWs?: (invocationId: string) => void;
}

export function InteractivePromptCard({ prompt, onAnswer, onApproveWs, onDenyWs }: InteractivePromptCardProps) {
  const approveMutation = useApproveAction();
  const denyMutation = useDenyAction();
  const countdown = useCountdown(prompt.expiresAt);
  const [freeformValue, setFreeformValue] = React.useState('');

  const isResolved = prompt.status !== 'pending';
  const isLoading = approveMutation.isPending || denyMutation.isPending;
  const isApproval = prompt.type === 'approval';

  const invocationId = (prompt.context?.invocationId as string) ?? prompt.id;
  const toolId = prompt.context?.toolId as string | undefined;
  const riskLevel = prompt.context?.riskLevel as string | undefined;
  const params = prompt.context?.params as Record<string, unknown> | undefined;

  function handleActionClick(actionId: string) {
    if (isApproval) {
      if (actionId === 'approve') {
        if (onApproveWs) {
          onApproveWs(invocationId);
        } else {
          approveMutation.mutate(invocationId);
        }
      } else if (actionId === 'deny') {
        if (onDenyWs) {
          onDenyWs(invocationId);
        } else {
          denyMutation.mutate({ invocationId });
        }
      }
    } else {
      const action = prompt.actions.find((a) => a.id === actionId);
      if (action) {
        onAnswer(prompt.id, action.label);
      }
    }
  }

  function handleFreeformSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = freeformValue.trim();
    if (trimmed) {
      onAnswer(prompt.id, trimmed);
    }
  }

  const hasActions = prompt.actions.length > 0;

  return (
    <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
      {/* Header: action name + risk badge + countdown */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isApproval && toolId && (
            <code className="truncate text-xs text-neutral-500 dark:text-neutral-400">{toolId}</code>
          )}
          {!isApproval && (
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {prompt.title}
            </span>
          )}
          {isApproval && riskLevel && (
            <Badge variant={riskBadgeVariant(riskLevel)}>{riskLevel}</Badge>
          )}
        </div>
        {!isResolved && countdown && countdown !== 'expired' && (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {countdown}
          </span>
        )}
      </div>

      {/* Summary: model-provided explanation */}
      {prompt.body && (
        <p className="mt-1.5 text-sm text-neutral-800 dark:text-neutral-200">
          {prompt.body}
        </p>
      )}

      {/* Expandable detail: formatted params */}
      {isApproval && params && Object.keys(params).length > 0 && !isResolved && (
        <ExpandableParams params={params} />
      )}

      {/* Action buttons or freeform input */}
      {isResolved ? (
        <div className="mt-2">
          <Badge variant={prompt.status === 'resolved' ? 'success' : 'secondary'}>
            {prompt.status === 'resolved' ? 'Resolved' : 'Expired'}
          </Badge>
        </div>
      ) : hasActions ? (
        <div className="mt-3 flex gap-2">
          {prompt.actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.style === 'primary' ? 'primary' : 'outline'}
              onClick={() => handleActionClick(action.id)}
              disabled={isLoading}
              className={
                action.style === 'danger'
                  ? 'border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20'
                  : action.style === 'primary'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : ''
              }
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : (
        <form onSubmit={handleFreeformSubmit} className="mt-3 flex gap-2">
          <input
            type="text"
            value={freeformValue}
            onChange={(e) => setFreeformValue(e.target.value)}
            placeholder="Type your answer..."
            className="flex-1 rounded-md border border-neutral-300 bg-surface-0 px-2.5 py-1.5 text-[13px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-400/40 dark:border-neutral-600 dark:bg-surface-1 dark:text-neutral-100"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!freeformValue.trim()}>
            Answer
          </Button>
        </form>
      )}
    </div>
  );
}

function riskBadgeVariant(level: string): 'success' | 'warning' | 'error' | 'default' {
  switch (level) {
    case 'low': return 'success';
    case 'medium': return 'warning';
    case 'high': return 'error';
    case 'critical': return 'error';
    default: return 'default';
  }
}
```

**Step 2: Verify it builds**

Run: `cd packages/client && npm run build`
Expected: Build succeeds with no type errors.

**Step 3: Commit**

```bash
git add packages/client/src/components/session/interactive-prompt-card.tsx
git commit -m "feat: redesign approval card with summary + expandable structured detail"
```

---

### Task 5: Update channel plugin approval rendering

Update Slack and Telegram transports to use the model's summary as the primary message text.

**Files:**
- Modify: `packages/plugin-slack/src/channels/transport.ts:489-567`
- Modify: `packages/plugin-telegram/src/channels/transport.ts:403-459`

**Step 1: Update Slack transport**

In `packages/plugin-slack/src/channels/transport.ts`, update the `sendInteractivePrompt` method. Change the Block Kit section text to use the summary from context:

At lines 514-521, replace the section block:
```typescript
const summary = (prompt.context?.summary as string) || prompt.body || '';
const toolId = (prompt.context?.toolId as string) || '';
const riskLevel = (prompt.context?.riskLevel as string) || '';

const headerText = riskLevel
  ? `*${prompt.title}* • \`${toolId}\` [${riskLevel.toUpperCase()}]`
  : `*${prompt.title}*`;

const blocks: Record<string, unknown>[] = [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${headerText}\n${summary}`,
    },
  },
];
```

Also update the no-actions path (lines 495-496) similarly:
```typescript
const summary = (prompt.context?.summary as string) || prompt.body || '';
const text = `*${prompt.title}*\n${summary}\n_Reply to this thread with your answer._`;
```

**Step 2: Update Telegram transport**

In `packages/plugin-telegram/src/channels/transport.ts`, update `sendInteractivePrompt`. At lines 417-421, replace the text building:

```typescript
const summary = (prompt.context?.summary as string) || prompt.body || '';
const toolId = (prompt.context?.toolId as string) || '';
const riskLevel = (prompt.context?.riskLevel as string) || '';

let text = riskLevel
  ? `*${prompt.title}* • \`${toolId}\` [${riskLevel.toUpperCase()}]\n${summary}`
  : `*${prompt.title}*\n${summary}`;

if (prompt.expiresAt) {
  const expiryDate = new Date(prompt.expiresAt);
  text += `\n\n_Expires ${expiryDate.toLocaleString()}_`;
}
```

**Step 3: Commit**

```bash
git add packages/plugin-slack/src/channels/transport.ts packages/plugin-telegram/src/channels/transport.ts
git commit -m "feat: use model summary in Slack and Telegram approval messages"
```

---

### Task 6: Update system prompt to document the summary requirement

The orchestrator system prompt should tell the model that `summary` is required and what makes a good summary.

**Files:**
- Modify: `packages/worker/src/lib/orchestrator-persona.ts:89-106`

**Step 1: Update the Integration Tools section**

Replace lines 102-104 with expanded instructions:

```typescript
**How it works:**
1. \`list_tools\` — discover available tools. Filter by \`service\` (e.g. "slack", "gmail") or \`query\` (keyword search).
2. \`call_tool\` — invoke a tool by its ID (format: \`service:actionId\`, e.g. \`slack:slack.list_channels\`). Pass parameters as documented in the tool's param schema.
   - **\`summary\` is required** — provide a clear, human-readable description of what this specific call does. This is shown to the user for approval on medium/high/critical risk actions.
   - Good: "Send a Slack message to #engineering with the deployment status update"
   - Good: "Replace the Q1 Budget Google Doc with updated figures for March"
   - Bad: "Call the tool" / "Execute action" / generic descriptions
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/orchestrator-persona.ts
git commit -m "docs: document required summary param in orchestrator system prompt"
```
