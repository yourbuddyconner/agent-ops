# Orchestrator Persona Self-Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow the orchestrator to read and edit its own `customInstructions`, and attach/detach skills to its own persona — using the same persona infrastructure as child sessions.

**Architecture:** Add a `personaId` column to `orchestratorIdentities` so the orchestrator gets a real `agentPersonas` row. During onboarding (and via migration for existing users), create an `agentPersonas` entry with an `instructions.md` file containing the orchestrator's `customInstructions`. Link the orchestrator session to this persona via `personaId` on the session record, so `sendPluginContent` automatically resolves attached skills. Add two new OpenCode tools (`get_my_persona`, `update_my_instructions`) that use a new `identity-api` message type through the existing runner↔DO WebSocket relay pattern.

**Tech Stack:** Drizzle ORM (SQLite/D1), Cloudflare Durable Objects, Hono, TypeScript, OpenCode plugin tools

---

## Task 1: Add `personaId` column to `orchestratorIdentities` schema

**Files:**
- Modify: `packages/worker/src/lib/schema/orchestrator.ts`

**Step 1: Add the column**

In `orchestratorIdentities` table definition, add `personaId` column:

```typescript
export const orchestratorIdentities = sqliteTable('orchestrator_identities', {
  id: text().primaryKey(),
  userId: text(),
  orgId: text().notNull().default('default'),
  type: text().notNull().default('personal'),
  name: text().notNull().default('Agent'),
  handle: text().notNull(),
  avatar: text(),
  customInstructions: text(),
  personaId: text(),  // ← NEW: links to agentPersonas.id
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('idx_orch_identity_handle').on(table.orgId, table.handle),
  uniqueIndex('idx_orch_identity_user').on(table.orgId, table.userId),
]);
```

**Step 2: Add D1 migration**

Create a new migration file. Check the existing migrations directory for the naming convention (likely `packages/worker/migrations/NNNN_description.sql`). Add:

```sql
ALTER TABLE orchestrator_identities ADD COLUMN persona_id TEXT;
```

**Step 3: Commit**

```bash
git add packages/worker/src/lib/schema/orchestrator.ts packages/worker/migrations/
git commit -m "schema: add personaId column to orchestrator_identities"
```

---

## Task 2: Update orchestrator identity DB functions to handle `personaId`

**Files:**
- Modify: `packages/worker/src/lib/db/orchestrator.ts`
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Update the shared type**

In `OrchestratorIdentity` interface (line ~697), add `personaId`:

```typescript
export interface OrchestratorIdentity {
  id: string;
  userId?: string;
  orgId: string;
  type: OrchestratorType;
  name: string;
  handle: string;
  avatar?: string;
  customInstructions?: string;
  personaId?: string;  // ← NEW
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Update `rowToIdentity` converter**

In `packages/worker/src/lib/db/orchestrator.ts`, update `rowToIdentity` (~line 31):

```typescript
function rowToIdentity(row: typeof orchestratorIdentities.$inferSelect): OrchestratorIdentity {
  return {
    id: row.id,
    userId: row.userId || undefined,
    orgId: row.orgId,
    type: row.type as OrchestratorIdentity['type'],
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.customInstructions || undefined,
    personaId: row.personaId || undefined,  // ← NEW
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

**Step 3: Update `createOrchestratorIdentity` to accept and store `personaId`**

Add `personaId` to the data param and insert/return:

```typescript
export async function createOrchestratorIdentity(
  db: AppDb,
  data: { id: string; userId: string; name: string; handle: string; avatar?: string; customInstructions?: string; personaId?: string; orgId?: string }
): Promise<OrchestratorIdentity> {
  const orgId = data.orgId || 'default';

  await db.insert(orchestratorIdentities).values({
    id: data.id,
    userId: data.userId,
    orgId,
    type: 'personal',
    name: data.name,
    handle: data.handle,
    avatar: data.avatar || null,
    customInstructions: data.customInstructions || null,
    personaId: data.personaId || null,  // ← NEW
  });

  return {
    id: data.id,
    userId: data.userId,
    orgId,
    type: 'personal',
    name: data.name,
    handle: data.handle,
    avatar: data.avatar,
    customInstructions: data.customInstructions,
    personaId: data.personaId,  // ← NEW
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

**Step 4: Update `updateOrchestratorIdentity` to handle `personaId`**

Add `personaId` to the updates type and set logic:

```typescript
export async function updateOrchestratorIdentity(
  db: AppDb,
  id: string,
  updates: Partial<Pick<OrchestratorIdentity, 'name' | 'handle' | 'avatar' | 'customInstructions' | 'personaId'>>
): Promise<void> {
  const setValues: Record<string, unknown> = {};

  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.handle !== undefined) setValues.handle = updates.handle;
  if (updates.avatar !== undefined) setValues.avatar = updates.avatar || null;
  if (updates.customInstructions !== undefined) setValues.customInstructions = updates.customInstructions || null;
  if (updates.personaId !== undefined) setValues.personaId = updates.personaId || null;  // ← NEW

  if (Object.keys(setValues).length === 0) return;

  setValues.updatedAt = sql`datetime('now')`;
  await db
    .update(orchestratorIdentities)
    .set(setValues)
    .where(eq(orchestratorIdentities.id, id));
}
```

**Step 5: Commit**

```bash
git add packages/worker/src/lib/db/orchestrator.ts packages/shared/src/types/index.ts
git commit -m "feat: add personaId support to orchestrator identity DB layer"
```

---

## Task 3: Create persona row during orchestrator onboarding

**Files:**
- Modify: `packages/worker/src/services/orchestrator.ts`

**Step 1: Update `onboardOrchestrator` to create a persona**

After creating the orchestrator identity, create an `agentPersonas` row and link it. Import the persona DB functions at the top of the file:

```typescript
import { createPersona, upsertPersonaFile } from '../lib/db/personas.js';
```

In the `onboardOrchestrator` function, after identity creation (~line 177-194), create the persona and link it:

```typescript
if (!identity) {
  const handleTaken = await db.getOrchestratorIdentityByHandle(appDb, params.handle);
  if (handleTaken) {
    return { ok: false, reason: 'handle_taken' };
  }

  const identityId = crypto.randomUUID();
  const personaId = crypto.randomUUID();

  // Create a real persona for the orchestrator (enables skill attachments)
  await createPersona(appDb, {
    id: personaId,
    name: `${params.name} (Orchestrator)`,
    slug: `orchestrator-${params.handle}`,
    description: 'Auto-managed orchestrator persona',
    visibility: 'private',
    createdBy: userId,
  });

  // Seed the custom instructions as a persona file
  if (params.customInstructions) {
    await upsertPersonaFile(appDb, {
      id: crypto.randomUUID(),
      personaId,
      filename: 'custom-instructions.md',
      content: params.customInstructions,
      sortOrder: 10,
    });
  }

  identity = await db.createOrchestratorIdentity(appDb, {
    id: identityId,
    userId,
    name: params.name,
    handle: params.handle,
    avatar: params.avatar,
    customInstructions: params.customInstructions,
    personaId,  // ← Link persona
  });
} else {
  // Existing identity — update it (persona already exists if previously migrated)
  await db.updateOrchestratorIdentity(appDb, identity.id, {
    name: params.name,
    handle: params.handle,
    customInstructions: params.customInstructions,
  });
  identity = (await db.getOrchestratorIdentity(appDb, userId))!;
}
```

**Step 2: Pass `personaId` when creating the orchestrator session**

In `restartOrchestratorSession`, pass `personaId` to `db.createSession`:

```typescript
await db.createSession(appDb, {
  id: sessionId,
  userId,
  workspace: 'orchestrator',
  title: `${identity.name} (Orchestrator)`,
  isOrchestrator: true,
  purpose: 'orchestrator',
  personaId: identity.personaId,  // ← NEW: enables skill resolution in sendPluginContent
});
```

Note: The `identity` param type needs to include `personaId`. Update the function signature:

```typescript
export async function restartOrchestratorSession(
  env: Env,
  userId: string,
  userEmail: string,
  identity: { id: string; name: string; handle: string; customInstructions?: string | null; personaId?: string | null },
  requestUrl?: string
): Promise<{ sessionId: string }> {
```

**Step 3: Commit**

```bash
git add packages/worker/src/services/orchestrator.ts
git commit -m "feat: create persona row during orchestrator onboarding and link to session"
```

---

## Task 4: Add identity-api message handling to the SessionAgent DO

The orchestrator needs two new operations via the existing runner↔DO WebSocket relay:
- `get-identity`: returns the orchestrator's identity + persona info
- `update-instructions`: updates `customInstructions` on both the identity and the persona file

**Files:**
- Modify: `packages/worker/src/durable-objects/session-agent.ts`

**Step 1: Add message routing for `identity-api`**

Find the message switch/case block (around line 3254 where `persona-api` is handled). Add a new case:

```typescript
case 'identity-api':
  await this.handleIdentityApi(msg.requestId!, msg.action || '', msg.payload);
  break;
```

**Step 2: Implement `handleIdentityApi`**

Add this private method near `handlePersonaApi` (~line 4832):

```typescript
private async handleIdentityApi(requestId: string, action: string, payload?: Record<string, unknown>) {
  try {
    const userId = this.getStateValue('userId')!;

    if (action === 'get') {
      const identity = await getOrchestratorIdentity(this.appDb, userId);
      if (!identity) {
        this.sendToRunner({ type: 'identity-api-result', requestId, error: 'Orchestrator identity not found', statusCode: 404 } as any);
        return;
      }
      this.sendToRunner({ type: 'identity-api-result', requestId, data: { identity } } as any);
      return;
    }

    if (action === 'update-instructions') {
      const instructions = payload?.instructions as string | undefined;
      if (instructions === undefined) {
        this.sendToRunner({ type: 'identity-api-result', requestId, error: 'instructions field is required', statusCode: 400 } as any);
        return;
      }

      const identity = await getOrchestratorIdentity(this.appDb, userId);
      if (!identity) {
        this.sendToRunner({ type: 'identity-api-result', requestId, error: 'Orchestrator identity not found', statusCode: 404 } as any);
        return;
      }

      // Update customInstructions on the identity row
      await updateOrchestratorIdentity(this.appDb, identity.id, { customInstructions: instructions || undefined });

      // Also update the persona file if the identity has a linked persona
      if (identity.personaId) {
        await upsertPersonaFile(this.appDb, {
          id: crypto.randomUUID(),
          personaId: identity.personaId,
          filename: 'custom-instructions.md',
          content: instructions || '',
          sortOrder: 10,
        });
      }

      this.sendToRunner({ type: 'identity-api-result', requestId, data: { ok: true, customInstructions: instructions } } as any);
      return;
    }

    this.sendToRunner({ type: 'identity-api-result', requestId, error: `Unknown identity-api action: ${action}`, statusCode: 400 } as any);
  } catch (err) {
    console.error('[SessionAgentDO] handleIdentityApi error:', err);
    this.sendToRunner({ type: 'identity-api-result', requestId, error: err instanceof Error ? err.message : String(err), statusCode: 500 } as any);
  }
}
```

**Step 3: Import the required functions at the top of the file**

Ensure these are imported (they may already be partially imported — check first):

```typescript
import { getOrchestratorIdentity, updateOrchestratorIdentity } from '../lib/db/orchestrator.js';
```

`upsertPersonaFile` should already be imported from the persona API handling.

**Step 4: Add the result type to the message handler**

Find where `persona-api-result` is handled in the runner message parsing (around line 1204 in agent-client.ts's message handler). Add `identity-api-result` to the same case:

```typescript
case "skill-api-result":
case "persona-api-result":
case "identity-api-result":  // ← ADD THIS
  if (msg.error) {
    this.resolvePendingRequest(msg.requestId, { error: msg.error, statusCode: msg.statusCode });
  } else {
    this.resolvePendingRequest(msg.requestId, { data: msg.data ?? {} });
  }
  break;
```

**Step 5: Commit**

```bash
git add packages/worker/src/durable-objects/session-agent.ts
git commit -m "feat: add identity-api message handling in SessionAgent DO"
```

---

## Task 5: Add `requestIdentityApi` to the runner agent-client

**Files:**
- Modify: `packages/runner/src/agent-client.ts`

**Step 1: Add the request method**

Near `requestPersonaApi` (~line 777), add:

```typescript
// ─── Identity API ──────────────────────────────────────────────────

requestIdentityApi(action: string, payload?: Record<string, unknown>): Promise<{ data?: unknown; error?: string; statusCode?: number }> {
  const requestId = crypto.randomUUID();
  return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
    this.send({ type: "identity-api", requestId, action, payload });
  });
}
```

**Step 2: Commit**

```bash
git add packages/runner/src/agent-client.ts
git commit -m "feat: add requestIdentityApi to runner agent-client"
```

---

## Task 6: Add gateway routes and callbacks for identity API

**Files:**
- Modify: `packages/runner/src/gateway.ts`
- Modify: `packages/runner/src/bin.ts`

**Step 1: Add callback to `GatewayCallbacks` interface**

In `gateway.ts` (~line 677), add before the closing brace:

```typescript
// Identity API (orchestrator self-edit)
onIdentityApi?: (action: string, payload?: Record<string, unknown>) => Promise<{ data?: unknown; error?: string; statusCode?: number }>;
```

**Step 2: Add gateway routes**

After the persona routes section (~line 1255), add:

```typescript
// ─── Identity API (orchestrator self-edit) ──────────────────────────

app.get("/api/identity", async (c) => {
  if (!callbacks.onIdentityApi) {
    return c.json({ error: "Identity API handler not configured" }, 500);
  }
  try {
    const result = await callbacks.onIdentityApi("get");
    if (result.error) return c.json({ error: result.error }, (result.statusCode ?? 500) as ContentfulStatusCode);
    return c.json(result.data ?? {});
  } catch (err) {
    console.error("[Gateway] Identity get error:", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.put("/api/identity/instructions", async (c) => {
  if (!callbacks.onIdentityApi) {
    return c.json({ error: "Identity API handler not configured" }, 500);
  }
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const result = await callbacks.onIdentityApi("update-instructions", body);
    if (result.error) return c.json({ error: result.error }, (result.statusCode ?? 500) as ContentfulStatusCode);
    return c.json(result.data ?? { ok: true });
  } catch (err) {
    console.error("[Gateway] Identity update instructions error:", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

**Step 3: Wire callback in `bin.ts`**

In `bin.ts`, in the `startGateway` call (~line 336-338), add after `onPersonaApi`:

```typescript
// Identity API (orchestrator self-edit)
onIdentityApi: async (action, payload) => {
  return await agentClient.requestIdentityApi(action, payload);
},
```

**Step 4: Commit**

```bash
git add packages/runner/src/gateway.ts packages/runner/src/bin.ts
git commit -m "feat: add identity API gateway routes and callback wiring"
```

---

## Task 7: Create `get_my_persona` OpenCode tool

**Files:**
- Create: `docker/opencode/tools/get_my_persona.ts`

**Step 1: Create the tool**

```typescript
import { tool } from "@opencode-ai/plugin"
import { formatOutput } from "./_format"

export default tool({
  description:
    "Get your own orchestrator identity and persona. Returns your name, handle, " +
    "custom instructions, and linked persona ID. Use the persona ID with " +
    "list_persona_skills / attach_skill_to_persona / detach_skill_from_persona " +
    "to manage your own skills.",
  args: {
    _placeholder: tool.schema.string().optional().describe("Unused"),
  },
  async execute() {
    try {
      const res = await fetch("http://localhost:9000/api/identity")

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to get identity: ${errText}`
      }

      const data = await res.json()
      return formatOutput(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to get identity: ${msg}`
    }
  },
})
```

**Step 2: Commit**

```bash
git add docker/opencode/tools/get_my_persona.ts
git commit -m "feat: add get_my_persona OpenCode tool"
```

---

## Task 8: Create `update_my_instructions` OpenCode tool

**Files:**
- Create: `docker/opencode/tools/update_my_instructions.ts`

**Step 1: Create the tool**

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Update your own custom instructions. These instructions shape your personality, " +
    "communication style, and behavior. Changes take effect on next session restart. " +
    "Pass the full instructions text — this replaces the current custom instructions entirely.",
  args: {
    instructions: tool.schema
      .string()
      .describe("The new custom instructions markdown content (replaces existing)"),
  },
  async execute(args) {
    if (!args.instructions?.trim()) {
      return "Error: instructions content is required"
    }

    try {
      const res = await fetch("http://localhost:9000/api/identity/instructions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: args.instructions }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to update instructions: ${errText}`
      }

      return "Custom instructions updated successfully. Changes will take effect on next session restart."
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to update instructions: ${msg}`
    }
  },
})
```

**Step 2: Commit**

```bash
git add docker/opencode/tools/update_my_instructions.ts
git commit -m "feat: add update_my_instructions OpenCode tool"
```

---

## Task 9: Update orchestrator system prompt to document new tools

**Files:**
- Modify: `packages/worker/src/lib/orchestrator-persona.ts`

**Step 1: Add self-edit documentation to the system prompt**

In the `ORCHESTRATOR_SYSTEM_PROMPT` constant, after the "Integration Tools" section (~line 106) and before "Spawning Child Sessions", add:

```markdown
## Your Persona & Skills

You have a real persona in the persona system, just like child session personas. This lets you manage your own custom instructions and attach skills to yourself.

**Reading your persona:**
- \`get_my_persona\` — returns your identity (name, handle, custom instructions) and your persona ID

**Editing your custom instructions:**
- \`update_my_instructions\` — replaces your custom instructions. Use this when the user asks you to change your personality, communication style, or behavior.

**Managing your skills:**
Your persona ID (from \`get_my_persona\`) works with the standard persona-skill tools:
- \`list_persona_skills\` — list skills attached to your persona
- \`attach_skill_to_persona\` — add a skill to yourself
- \`detach_skill_from_persona\` — remove a skill from yourself

Skills attached to your persona are automatically loaded into your system prompt on session restart, just like child session personas.
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/orchestrator-persona.ts
git commit -m "docs: document self-edit tools in orchestrator system prompt"
```

---

## Task 10: Backfill migration — create persona rows for existing orchestrators

Existing orchestrator identities won't have a `personaId`. We need to handle this gracefully.

**Files:**
- Modify: `packages/worker/src/services/orchestrator.ts`

**Step 1: Add persona backfill to `restartOrchestratorSession`**

At the start of `restartOrchestratorSession`, after fetching the identity, check if it needs a persona created:

```typescript
export async function restartOrchestratorSession(
  env: Env,
  userId: string,
  userEmail: string,
  identity: { id: string; name: string; handle: string; customInstructions?: string | null; personaId?: string | null },
  requestUrl?: string
): Promise<{ sessionId: string }> {
  const appDb = getDb(env.DB);

  // Backfill: create persona for orchestrators that predate persona support
  if (!identity.personaId) {
    const personaId = crypto.randomUUID();
    await createPersona(appDb, {
      id: personaId,
      name: `${identity.name} (Orchestrator)`,
      slug: `orchestrator-${identity.handle}`,
      description: 'Auto-managed orchestrator persona',
      visibility: 'private',
      createdBy: userId,
    });
    if (identity.customInstructions) {
      await upsertPersonaFile(appDb, {
        id: crypto.randomUUID(),
        personaId,
        filename: 'custom-instructions.md',
        content: identity.customInstructions,
        sortOrder: 10,
      });
    }
    await db.updateOrchestratorIdentity(appDb, identity.id, { personaId });
    identity = { ...identity, personaId };
  }

  const personaFiles = buildOrchestratorPersonaFiles(identity as any);
  // ... rest of function unchanged
```

**Step 2: Commit**

```bash
git add packages/worker/src/services/orchestrator.ts
git commit -m "feat: backfill persona for existing orchestrators on restart"
```

---

## Task 11: Update `buildOrchestratorPersonaFiles` to skip inline customInstructions when persona exists

Since `customInstructions` now lives as a persona file (delivered via `sendPluginContent` skill resolution), the hardcoded `01-IDENTITY.md` should stop duplicating them.

**Files:**
- Modify: `packages/worker/src/lib/orchestrator-persona.ts`

**Step 1: Accept `personaId` in the identity param and skip custom instructions injection when present**

```typescript
export function buildOrchestratorPersonaFiles(
  identity: OrchestratorIdentity
): { filename: string; content: string; sortOrder: number }[] {
  const files: { filename: string; content: string; sortOrder: number }[] = [];

  files.push({
    filename: '00-ORCHESTRATOR-SYSTEM.md',
    content: ORCHESTRATOR_SYSTEM_PROMPT,
    sortOrder: 0,
  });

  const identityLines = [
    `# Identity`,
    ``,
    `You are **${identity.name}** (@${identity.handle}), a personal orchestrator agent.`,
    ``,
  ];
  // Only inline custom instructions if there's no linked persona
  // (persona-linked instructions are delivered via sendPluginContent as skills/files)
  if (!identity.personaId && identity.customInstructions) {
    identityLines.push(`## Custom Instructions`, ``, identity.customInstructions, ``);
  }
  files.push({
    filename: '01-IDENTITY.md',
    content: identityLines.join('\n'),
    sortOrder: 1,
  });

  return files;
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/orchestrator-persona.ts
git commit -m "refactor: skip inline customInstructions when orchestrator has linked persona"
```

---

## Task 12: Verify type safety and build

**Step 1: Run TypeScript check on all modified packages**

```bash
cd packages/worker && npx tsc --noEmit
cd packages/runner && npx tsc --noEmit
cd packages/shared && npx tsc --noEmit
```

Expected: No type errors. Fix any issues found.

**Step 2: Run existing tests**

```bash
# Check what test runner is used
cat package.json | grep -A5 '"test"'
# Run tests
npm test
```

Expected: All existing tests pass.

**Step 3: Commit any type fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from orchestrator persona changes"
```

---

## Summary of Changes

| Layer | What Changes |
|-------|-------------|
| **Schema** | `orchestratorIdentities` gains `personaId` column |
| **Types** | `OrchestratorIdentity` gains `personaId` field |
| **DB** | `createOrchestratorIdentity` / `updateOrchestratorIdentity` handle `personaId` |
| **Onboarding** | `onboardOrchestrator` creates a real `agentPersonas` row |
| **Restart** | `restartOrchestratorSession` backfills persona for existing identities, passes `personaId` to session |
| **DO** | New `identity-api` message handler (`get`, `update-instructions`) |
| **Runner** | New `requestIdentityApi` in agent-client, new gateway routes + callback |
| **Tools** | `get_my_persona` and `update_my_instructions` OpenCode tools |
| **System Prompt** | Documents new self-edit capabilities |
| **Persona Files** | `customInstructions` no longer duplicated when persona is linked |

**What works automatically (no new code needed):**
- `list_persona_skills` — already works with any persona ID
- `attach_skill_to_persona` — already works with any persona ID
- `detach_skill_from_persona` — already works with any persona ID
- `sendPluginContent` — already resolves skills for sessions with `personaId`
- Skill delivery to the orchestrator sandbox — existing pipeline
