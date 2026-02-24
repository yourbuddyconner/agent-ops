import type { D1Database } from '@cloudflare/workers-types';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../drizzle.js';
import { triggers } from '../schema/index.js';

// ─── Pure Helpers ────────────────────────────────────────────────────────────

export type TriggerConfig =
  | { type: 'webhook'; path: string; method?: string; secret?: string; headers?: Record<string, string> }
  | { type: 'schedule'; cron: string; timezone?: string; target?: 'workflow' | 'orchestrator'; prompt?: string }
  | { type: 'manual' };

export function scheduleTarget(config: TriggerConfig): 'workflow' | 'orchestrator' {
  if (config.type !== 'schedule') return 'workflow';
  return config.target === 'orchestrator' ? 'orchestrator' : 'workflow';
}

export function requiresWorkflow(config: TriggerConfig): boolean {
  return config.type !== 'schedule' || scheduleTarget(config) === 'workflow';
}

export function deriveRepoFullName(repoUrl?: string, sourceRepoFullName?: string): string | undefined {
  const explicit = sourceRepoFullName?.trim();
  if (explicit) return explicit;

  const rawUrl = repoUrl?.trim();
  if (!rawUrl) return undefined;

  const match = rawUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  return match?.[1] || undefined;
}

// ─── Data Access (Drizzle) ──────────────────────────────────────────────────

export async function createTrigger(
  db: D1Database,
  params: {
    id: string;
    userId: string;
    workflowId: string | null;
    name: string;
    enabled: boolean;
    type: string;
    config: string;
    variableMapping: string | null;
    now: string;
  }
) {
  const drizzle = getDb(db);
  await drizzle.insert(triggers).values({
    id: params.id,
    userId: params.userId,
    workflowId: params.workflowId,
    name: params.name,
    enabled: params.enabled,
    type: params.type,
    config: params.config,
    variableMapping: params.variableMapping,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

export async function getTriggerForUpdate(db: D1Database, userId: string, triggerId: string) {
  const drizzle = getDb(db);
  const row = await drizzle
    .select({
      config: triggers.config,
      workflowId: triggers.workflowId,
    })
    .from(triggers)
    .where(and(eq(triggers.id, triggerId), eq(triggers.userId, userId)))
    .get();

  if (!row) return null;
  // Return with snake_case keys to match original raw-SQL shape
  return { config: row.config, workflow_id: row.workflowId } as { config: string; workflow_id: string | null };
}

export async function deleteTrigger(db: D1Database, triggerId: string, userId: string) {
  const drizzle = getDb(db);
  return drizzle
    .delete(triggers)
    .where(and(eq(triggers.id, triggerId), eq(triggers.userId, userId)));
}

export async function enableTrigger(db: D1Database, triggerId: string, userId: string, now: string) {
  const drizzle = getDb(db);
  return drizzle
    .update(triggers)
    .set({ enabled: true, updatedAt: now })
    .where(and(eq(triggers.id, triggerId), eq(triggers.userId, userId)));
}

export async function disableTrigger(db: D1Database, triggerId: string, userId: string, now: string) {
  const drizzle = getDb(db);
  return drizzle
    .update(triggers)
    .set({ enabled: false, updatedAt: now })
    .where(and(eq(triggers.id, triggerId), eq(triggers.userId, userId)));
}

export async function updateTriggerLastRun(db: D1Database, triggerId: string, now: string) {
  const drizzle = getDb(db);
  await drizzle
    .update(triggers)
    .set({ lastRunAt: now })
    .where(eq(triggers.id, triggerId));
}

export async function updateTriggerFull(
  db: D1Database,
  triggerId: string,
  userId: string,
  params: {
    workflowId: string | null;
    name: string;
    enabled: boolean;
    type: string;
    config: string;
    variableMapping: string | null;
    now: string;
  },
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(triggers)
    .set({
      workflowId: params.workflowId,
      name: params.name,
      enabled: params.enabled,
      type: params.type,
      config: params.config,
      variableMapping: params.variableMapping,
      updatedAt: params.now,
    })
    .where(and(eq(triggers.id, triggerId), eq(triggers.userId, userId)));
}

// ─── Data Access (Raw SQL) ──────────────────────────────────────────────────

export async function listTriggers(db: D1Database, userId: string) {
  return db.prepare(`
    SELECT t.*, w.name as workflow_name
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `).bind(userId).all();
}

export async function getTrigger(db: D1Database, userId: string, triggerId: string) {
  return db.prepare(`
    SELECT t.*, w.name as workflow_name
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.id = ? AND t.user_id = ?
  `).bind(triggerId, userId).first();
}

export async function getWorkflowForTrigger(db: D1Database, userId: string, workflowIdOrSlug: string) {
  return db.prepare(`
    SELECT id FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(workflowIdOrSlug, workflowIdOrSlug, userId).first<{ id: string }>();
}

export async function checkWebhookPathUniqueness(
  db: D1Database,
  userId: string,
  path: string,
  excludeId?: string
) {
  if (excludeId) {
    return db.prepare(`
      SELECT id FROM triggers
      WHERE user_id = ?
      AND type = 'webhook'
      AND json_extract(config, '$.path') = ?
      AND id != ?
    `).bind(userId, path, excludeId).first();
  }

  return db.prepare(`
    SELECT id FROM triggers
    WHERE user_id = ?
    AND type = 'webhook'
    AND json_extract(config, '$.path') = ?
  `).bind(userId, path).first();
}

export async function updateTrigger(
  db: D1Database,
  triggerId: string,
  setClauses: string[],
  values: unknown[]
) {
  await db.prepare(`
    UPDATE triggers SET ${setClauses.join(', ')} WHERE id = ?
  `).bind(...values).run();
}

export async function getTriggerForRun(db: D1Database, userId: string, triggerId: string) {
  return db.prepare(`
    SELECT t.*, w.id as wf_id, w.name as workflow_name, w.version as workflow_version, w.data as workflow_data
    FROM triggers t
    LEFT JOIN workflows w ON t.workflow_id = w.id
    WHERE t.id = ? AND t.user_id = ?
  `).bind(triggerId, userId).first<{
    id: string;
    type: 'webhook' | 'schedule' | 'manual';
    config: string;
    wf_id: string | null;
    workflow_name: string | null;
    workflow_version: string | null;
    workflow_data: string | null;
    variable_mapping: string | null;
  }>();
}

export async function getWorkflowForManualRun(db: D1Database, userId: string, workflowIdOrSlug: string) {
  return db.prepare(`
    SELECT id, name, version, data FROM workflows WHERE (id = ? OR slug = ?) AND user_id = ?
  `).bind(workflowIdOrSlug, workflowIdOrSlug, userId).first<{
    id: string;
    name: string;
    version: string | null;
    data: string;
  }>();
}

// ─── DO Helpers (Raw SQL) ───────────────────────────────────────────────────

export async function findScheduleTriggerByNameAndWorkflow(
  db: D1Database,
  userId: string,
  workflowId: string | null,
  name: string,
) {
  return db.prepare(`
    SELECT *
    FROM triggers
    WHERE user_id = ?
      AND type = 'schedule'
      AND ((? IS NULL AND workflow_id IS NULL) OR workflow_id = ?)
      AND lower(name) = lower(?)
    ORDER BY datetime(updated_at) DESC
    LIMIT 1
  `).bind(userId, workflowId, workflowId, name).first<Record<string, unknown>>();
}

export async function findScheduleTriggersByWorkflow(
  db: D1Database,
  userId: string,
  workflowId: string | null,
  limit: number,
) {
  return db.prepare(`
    SELECT *
    FROM triggers
    WHERE user_id = ?
      AND type = 'schedule'
      AND ((? IS NULL AND workflow_id IS NULL) OR workflow_id = ?)
    ORDER BY datetime(updated_at) DESC
    LIMIT ?
  `).bind(userId, workflowId, workflowId, limit).all<Record<string, unknown>>();
}

export async function findScheduleTriggersByName(
  db: D1Database,
  userId: string,
  name: string,
  limit: number,
) {
  return db.prepare(`
    SELECT *
    FROM triggers
    WHERE user_id = ?
      AND type = 'schedule'
      AND lower(name) = lower(?)
    ORDER BY datetime(updated_at) DESC
    LIMIT ?
  `).bind(userId, name, limit).all<Record<string, unknown>>();
}
