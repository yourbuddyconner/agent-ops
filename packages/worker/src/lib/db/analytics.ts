import type { D1Database } from '@cloudflare/workers-types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AnalyticsEventRow = {
  id: string;
  event_type: string;
  session_id: string;
  user_id: string | null;
  turn_id: string | null;
  duration_ms: number | null;
  created_at: string;
  channel: string | null;
  model: string | null;
  queue_mode: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_name: string | null;
  error_code: string | null;
  summary: string | null;
  actor_id: string | null;
  properties: string | null;
};

// ─── Batch Insert (DO flush → D1) ──────────────────────────────────────────

export async function batchInsertAnalyticsEvents(
  db: D1Database,
  sessionId: string,
  userId: string | null,
  entries: Array<{
    id: string;
    eventType: string;
    turnId?: string | null;
    durationMs?: number | null;
    createdAt: string;
    channel?: string | null;
    model?: string | null;
    queueMode?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    toolName?: string | null;
    errorCode?: string | null;
    summary?: string | null;
    actorId?: string | null;
    properties?: string | null;
  }>,
): Promise<void> {
  if (entries.length === 0) return;

  const stmts = entries.map((entry) =>
    db.prepare(
      `INSERT OR IGNORE INTO analytics_events
        (id, event_type, session_id, user_id, turn_id, duration_ms, created_at, channel, model, queue_mode, input_tokens, output_tokens, tool_name, error_code, summary, actor_id, properties)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id,
      entry.eventType,
      sessionId,
      userId,
      entry.turnId ?? null,
      entry.durationMs ?? null,
      entry.createdAt,
      entry.channel ?? null,
      entry.model ?? null,
      entry.queueMode ?? null,
      entry.inputTokens ?? null,
      entry.outputTokens ?? null,
      entry.toolName ?? null,
      entry.errorCode ?? null,
      entry.summary ?? null,
      entry.actorId ?? null,
      entry.properties ?? null,
    )
  );

  await db.batch(stmts);
}

// ─── Legacy-compatible batch insert for usage events (DO flush) ─────────────

export async function batchInsertUsageEvents(
  db: D1Database,
  sessionId: string,
  entries: Array<{
    localId: number;
    turnId: string;
    ocMessageId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: number;
  }>,
): Promise<void> {
  if (entries.length === 0) return;

  const stmts = entries.map((entry) =>
    db.prepare(
      `INSERT OR IGNORE INTO analytics_events
        (id, event_type, session_id, turn_id, model, input_tokens, output_tokens, created_at, properties)
       VALUES (?, 'llm_call', ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), ?)`
    ).bind(
      `${sessionId}:${entry.localId}`,
      sessionId,
      entry.turnId,
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.createdAt,
      JSON.stringify({ oc_message_id: entry.ocMessageId }),
    )
  );

  await db.batch(stmts);
}

// ─── Billing / Usage Aggregate Queries ──────────────────────────────────────

export interface UsageHeroStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  totalUsers: number;
}

export async function getUsageHeroStats(
  db: D1Database,
  periodStart: string,
): Promise<UsageHeroStats> {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(SUM(ae.input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(ae.output_tokens), 0) as total_output_tokens,
        COUNT(DISTINCT ae.session_id) as total_sessions,
        COUNT(DISTINCT ae.user_id) as total_users
      FROM analytics_events ae
      WHERE ae.event_type = 'llm_call'
        AND ae.created_at >= ?
    `)
    .bind(periodStart)
    .first<{
      total_input_tokens: number;
      total_output_tokens: number;
      total_sessions: number;
      total_users: number;
    }>();

  return {
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
    totalSessions: row?.total_sessions ?? 0,
    totalUsers: row?.total_users ?? 0,
  };
}

export interface UsageByDayRow {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function getUsageByDay(
  db: D1Database,
  periodStart: string,
): Promise<UsageByDayRow[]> {
  const result = await db
    .prepare(`
      SELECT
        date(ae.created_at) as date,
        ae.model,
        SUM(ae.input_tokens) as input_tokens,
        SUM(ae.output_tokens) as output_tokens
      FROM analytics_events ae
      WHERE ae.event_type = 'llm_call'
        AND ae.created_at >= ?
      GROUP BY date(ae.created_at), ae.model
      ORDER BY date ASC
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    date: String(r.date),
    model: String(r.model),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
  }));
}

export interface UsageByUserRow {
  userId: string;
  email: string;
  name: string | null;
  inputTokens: number;
  outputTokens: number;
  sessionCount: number;
}

export async function getUsageByUser(
  db: D1Database,
  periodStart: string,
): Promise<UsageByUserRow[]> {
  const result = await db
    .prepare(`
      SELECT
        ae.user_id,
        u.email,
        u.name,
        SUM(ae.input_tokens) as input_tokens,
        SUM(ae.output_tokens) as output_tokens,
        COUNT(DISTINCT ae.session_id) as session_count
      FROM analytics_events ae
      LEFT JOIN users u ON u.id = ae.user_id
      WHERE ae.event_type = 'llm_call'
        AND ae.created_at >= ?
        AND ae.user_id IS NOT NULL
      GROUP BY ae.user_id
      ORDER BY (SUM(ae.input_tokens) + SUM(ae.output_tokens)) DESC
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    userId: String(r.user_id),
    email: r.email ? String(r.email) : 'Unknown',
    name: r.name ? String(r.name) : null,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    sessionCount: Number(r.session_count),
  }));
}

export interface UsageByUserModelRow {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function getUsageByUserModel(
  db: D1Database,
  periodStart: string,
): Promise<UsageByUserModelRow[]> {
  const result = await db
    .prepare(`
      SELECT
        ae.user_id,
        ae.model,
        SUM(ae.input_tokens) as input_tokens,
        SUM(ae.output_tokens) as output_tokens
      FROM analytics_events ae
      WHERE ae.event_type = 'llm_call'
        AND ae.created_at >= ?
        AND ae.user_id IS NOT NULL
      GROUP BY ae.user_id, ae.model
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    userId: String(r.user_id),
    model: String(r.model),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
  }));
}

export interface UsageByModelRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}

export async function getUsageByModel(
  db: D1Database,
  periodStart: string,
): Promise<UsageByModelRow[]> {
  const result = await db
    .prepare(`
      SELECT
        model,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as call_count
      FROM analytics_events
      WHERE event_type = 'llm_call'
        AND created_at >= ?
      GROUP BY model
      ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    model: String(r.model),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    callCount: Number(r.call_count),
  }));
}

// ─── Sandbox Usage Queries ──────────────────────────────────────────────────

export interface SandboxHeroStats {
  totalActiveSeconds: number;
}

export async function getSandboxHeroStats(
  db: D1Database,
  periodStart: string,
): Promise<SandboxHeroStats> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(active_seconds), 0) as total_active_seconds
      FROM sessions
      WHERE created_at >= ?
    `)
    .bind(periodStart)
    .first<{ total_active_seconds: number }>();

  return {
    totalActiveSeconds: row?.total_active_seconds ?? 0,
  };
}

export interface SandboxByDayRow {
  date: string;
  activeSeconds: number;
}

export async function getSandboxByDay(
  db: D1Database,
  periodStart: string,
): Promise<SandboxByDayRow[]> {
  const result = await db
    .prepare(`
      SELECT
        date(created_at) as date,
        SUM(active_seconds) as active_seconds
      FROM sessions
      WHERE created_at >= ?
      GROUP BY date(created_at)
      ORDER BY date ASC
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    date: String(r.date),
    activeSeconds: Number(r.active_seconds),
  }));
}

export interface SandboxByUserRow {
  userId: string;
  activeSeconds: number;
  sandboxCpuCores: number | null;
  sandboxMemoryMib: number | null;
}

export async function getSandboxByUser(
  db: D1Database,
  periodStart: string,
): Promise<SandboxByUserRow[]> {
  const result = await db
    .prepare(`
      SELECT
        s.user_id,
        SUM(s.active_seconds) as active_seconds,
        u.sandbox_cpu_cores,
        u.sandbox_memory_mib
      FROM sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.created_at >= ?
        AND s.user_id IS NOT NULL
      GROUP BY s.user_id
    `)
    .bind(periodStart)
    .all();

  return (result.results ?? []).map((r: Record<string, unknown>) => ({
    userId: String(r.user_id),
    activeSeconds: Number(r.active_seconds),
    sandboxCpuCores: r.sandbox_cpu_cores != null ? Number(r.sandbox_cpu_cores) : null,
    sandboxMemoryMib: r.sandbox_memory_mib != null ? Number(r.sandbox_memory_mib) : null,
  }));
}

// ─── Performance Queries ────────────────────────────────────────────────────

export interface PercentileStats {
  p50: number | null;
  p95: number | null;
  count: number;
}

export async function getPercentiles(
  db: D1Database,
  eventType: string,
  periodStart: string,
): Promise<PercentileStats> {
  const countRow = await db
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM analytics_events
      WHERE event_type = ?
        AND created_at >= ?
        AND duration_ms IS NOT NULL
    `)
    .bind(eventType, periodStart)
    .first<{ cnt: number }>();

  const count = countRow?.cnt ?? 0;
  if (count === 0) return { p50: null, p95: null, count: 0 };

  const p50Offset = Math.floor(count * 0.5);
  const p95Offset = Math.floor(count * 0.95);

  const [p50Row, p95Row] = await Promise.all([
    db.prepare(`
      SELECT duration_ms FROM analytics_events
      WHERE event_type = ? AND created_at >= ? AND duration_ms IS NOT NULL
      ORDER BY duration_ms ASC
      LIMIT 1 OFFSET ?
    `).bind(eventType, periodStart, p50Offset).first<{ duration_ms: number }>(),
    db.prepare(`
      SELECT duration_ms FROM analytics_events
      WHERE event_type = ? AND created_at >= ? AND duration_ms IS NOT NULL
      ORDER BY duration_ms ASC
      LIMIT 1 OFFSET ?
    `).bind(eventType, periodStart, Math.min(p95Offset, count - 1)).first<{ duration_ms: number }>(),
  ]);

  return {
    p50: p50Row?.duration_ms ?? null,
    p95: p95Row?.duration_ms ?? null,
    count,
  };
}

export interface PerfTrendRow {
  date: string;
  p50: number | null;
  p95: number | null;
  count: number;
}

export async function getPerfTrend(
  db: D1Database,
  eventType: string,
  periodStart: string,
): Promise<PerfTrendRow[]> {
  // Get daily counts first
  const dailyCounts = await db
    .prepare(`
      SELECT
        date(created_at) as date,
        COUNT(*) as cnt
      FROM analytics_events
      WHERE event_type = ?
        AND created_at >= ?
        AND duration_ms IS NOT NULL
      GROUP BY date(created_at)
      ORDER BY date ASC
    `)
    .bind(eventType, periodStart)
    .all();

  const days = (dailyCounts.results ?? []) as Array<Record<string, unknown>>;
  if (days.length === 0) return [];

  // For each day, compute P50 and P95 using OFFSET
  const results: PerfTrendRow[] = [];
  for (const day of days) {
    const date = String(day.date);
    const count = Number(day.cnt);
    const p50Offset = Math.floor(count * 0.5);
    const p95Offset = Math.min(Math.floor(count * 0.95), count - 1);

    const [p50Row, p95Row] = await Promise.all([
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = ? AND date(created_at) = ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(eventType, date, p50Offset).first<{ duration_ms: number }>(),
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = ? AND date(created_at) = ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(eventType, date, p95Offset).first<{ duration_ms: number }>(),
    ]);

    results.push({
      date,
      p50: p50Row?.duration_ms ?? null,
      p95: p95Row?.duration_ms ?? null,
      count,
    });
  }

  return results;
}

export interface StageBreakdownRow {
  eventType: string;
  p50: number | null;
  p95: number | null;
  count: number;
}

export async function getStageBreakdown(
  db: D1Database,
  periodStart: string,
): Promise<StageBreakdownRow[]> {
  // Get all stage event types with counts
  const stages = await db
    .prepare(`
      SELECT
        event_type,
        COUNT(*) as cnt
      FROM analytics_events
      WHERE created_at >= ?
        AND duration_ms IS NOT NULL
      GROUP BY event_type
      ORDER BY COUNT(*) DESC
    `)
    .bind(periodStart)
    .all();

  const rows = (stages.results ?? []) as Array<Record<string, unknown>>;
  const results: StageBreakdownRow[] = [];

  for (const row of rows) {
    const eventType = String(row.event_type);
    const count = Number(row.cnt);
    const p50Offset = Math.floor(count * 0.5);
    const p95Offset = Math.min(Math.floor(count * 0.95), count - 1);

    const [p50Row, p95Row] = await Promise.all([
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = ? AND created_at >= ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(eventType, periodStart, p50Offset).first<{ duration_ms: number }>(),
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = ? AND created_at >= ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(eventType, periodStart, p95Offset).first<{ duration_ms: number }>(),
    ]);

    results.push({
      eventType,
      p50: p50Row?.duration_ms ?? null,
      p95: p95Row?.duration_ms ?? null,
      count,
    });
  }

  return results;
}

export interface ErrorRateStats {
  totalErrors: number;
  totalCompleted: number;
  errorRate: number;
}

export async function getErrorRate(
  db: D1Database,
  periodStart: string,
): Promise<ErrorRateStats> {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'turn_error' THEN 1 ELSE 0 END), 0) as total_errors,
        COALESCE(SUM(CASE WHEN event_type = 'turn_complete' THEN 1 ELSE 0 END), 0) as total_completed
      FROM analytics_events
      WHERE event_type IN ('turn_error', 'turn_complete')
        AND created_at >= ?
    `)
    .bind(periodStart)
    .first<{ total_errors: number; total_completed: number }>();

  const totalErrors = row?.total_errors ?? 0;
  const totalCompleted = row?.total_completed ?? 0;
  const total = totalErrors + totalCompleted;

  return {
    totalErrors,
    totalCompleted,
    errorRate: total > 0 ? totalErrors / total : 0,
  };
}

// ─── Event Feed ─────────────────────────────────────────────────────────────

export interface EventFeedRow {
  id: string;
  eventType: string;
  sessionId: string;
  userId: string | null;
  turnId: string | null;
  durationMs: number | null;
  createdAt: string;
  channel: string | null;
  model: string | null;
  toolName: string | null;
  errorCode: string | null;
  summary: string | null;
  properties: string | null;
}

export interface EventFeedOptions {
  limit?: number;
  offset?: number;
  typePrefix?: string;
}

export async function getEventFeed(
  db: D1Database,
  periodStart: string,
  options: EventFeedOptions = {},
): Promise<{ events: EventFeedRow[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let whereClause = 'WHERE created_at >= ?';
  const binds: unknown[] = [periodStart];

  if (options.typePrefix) {
    whereClause += ' AND event_type LIKE ?';
    binds.push(`${options.typePrefix}%`);
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM analytics_events ${whereClause}`)
    .bind(...binds)
    .first<{ cnt: number }>();

  const result = await db
    .prepare(`
      SELECT id, event_type, session_id, user_id, turn_id, duration_ms, created_at,
             channel, model, tool_name, error_code, summary, properties
      FROM analytics_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...binds, limit, offset)
    .all();

  const events = (result.results ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    eventType: String(r.event_type),
    sessionId: String(r.session_id),
    userId: r.user_id != null ? String(r.user_id) : null,
    turnId: r.turn_id != null ? String(r.turn_id) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    createdAt: String(r.created_at),
    channel: r.channel != null ? String(r.channel) : null,
    model: r.model != null ? String(r.model) : null,
    toolName: r.tool_name != null ? String(r.tool_name) : null,
    errorCode: r.error_code != null ? String(r.error_code) : null,
    summary: r.summary != null ? String(r.summary) : null,
    properties: r.properties != null ? String(r.properties) : null,
  }));

  return { events, total: countRow?.cnt ?? 0 };
}

// ─── Slow Paths ─────────────────────────────────────────────────────────────

export interface SlowPathRow {
  dimension: string;
  p50: number | null;
  p95: number | null;
  count: number;
}

export async function getSlowPaths(
  db: D1Database,
  periodStart: string,
  dimension: 'model' | 'channel' | 'tool_name',
): Promise<SlowPathRow[]> {
  const groups = await db
    .prepare(`
      SELECT
        ${dimension} as dim,
        COUNT(*) as cnt
      FROM analytics_events
      WHERE event_type = 'turn_complete'
        AND created_at >= ?
        AND duration_ms IS NOT NULL
        AND ${dimension} IS NOT NULL
      GROUP BY ${dimension}
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `)
    .bind(periodStart)
    .all();

  const rows = (groups.results ?? []) as Array<Record<string, unknown>>;
  const results: SlowPathRow[] = [];

  for (const row of rows) {
    const dim = String(row.dim);
    const count = Number(row.cnt);
    const p50Offset = Math.floor(count * 0.5);
    const p95Offset = Math.min(Math.floor(count * 0.95), count - 1);

    const [p50Row, p95Row] = await Promise.all([
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = 'turn_complete' AND ${dimension} = ? AND created_at >= ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(dim, periodStart, p50Offset).first<{ duration_ms: number }>(),
      db.prepare(`
        SELECT duration_ms FROM analytics_events
        WHERE event_type = 'turn_complete' AND ${dimension} = ? AND created_at >= ? AND duration_ms IS NOT NULL
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).bind(dim, periodStart, p95Offset).first<{ duration_ms: number }>(),
    ]);

    results.push({
      dimension: dim,
      p50: p50Row?.duration_ms ?? null,
      p95: p95Row?.duration_ms ?? null,
      count,
    });
  }

  return results;
}
