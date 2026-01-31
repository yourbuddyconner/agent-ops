import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import type { DashboardStatsResponse } from '@agent-ops/shared';

export const dashboardRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Trigger a metrics flush on DOs for sessions that haven't been backfilled yet.
 * Fire-and-forget: best-effort, non-blocking for fresh sessions.
 */
async function backfillUnflushedSessions(env: Env, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;

  await Promise.allSettled(
    sessionIds.map(async (id) => {
      try {
        const doId = env.SESSIONS.idFromName(id);
        const stub = env.SESSIONS.get(doId);
        await stub.fetch(new Request('http://do/flush-metrics', { method: 'POST' }));
      } catch {
        // DO may be evicted — skip
      }
    })
  );
}

/**
 * GET /api/dashboard/stats?period=30
 * Returns aggregated dashboard statistics for the given period (days).
 * All data comes from D1 — message/tool counts are flushed from DOs periodically.
 */
dashboardRouter.get('/stats', async (c) => {
  const user = c.get('user');
  // Accept period in hours (e.g. 1, 24, 168, 720) or legacy days via ?period=30
  const rawPeriod = c.req.query('period') || '720';
  const periodUnit = c.req.query('unit') || 'hours';
  const periodHours = periodUnit === 'days'
    ? Math.min(Math.max(parseInt(rawPeriod), 1), 90) * 24
    : Math.min(Math.max(parseInt(rawPeriod), 1), 2160); // max 90 days in hours
  const period = periodHours;

  const now = new Date();
  const periodStart = new Date(now.getTime() - periodHours * 60 * 60 * 1000);
  const prevPeriodStart = new Date(periodStart.getTime() - periodHours * 60 * 60 * 1000);

  const periodStartStr = periodStart.toISOString();
  const prevPeriodStartStr = prevPeriodStart.toISOString();

  // Lazy backfill: find sessions with message_count still at 0 and trigger DO flush.
  // This handles pre-migration sessions. Once flushed, they won't be picked up again.
  const unflushed = await c.env.DB.prepare(
    `SELECT id FROM sessions WHERE user_id = ? AND message_count = 0 AND status != 'initializing' LIMIT 20`
  ).bind(user.id).all();

  const unflushedIds = (unflushed.results ?? []).map((r: Record<string, unknown>) => String(r.id));
  if (unflushedIds.length > 0) {
    // Fire-and-forget — don't block the response, but await briefly to give DOs time to flush
    await backfillUnflushedSessions(c.env, unflushedIds);
  }

  const [
    aggregateResult,
    prevPeriodResult,
    activityResult,
    topReposResult,
    recentSessionsResult,
    activeSessionsResult,
  ] = await Promise.all([
    // Aggregate stats for current period
    c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(CASE WHEN status IN ('running', 'idle', 'initializing') THEN 1 ELSE 0 END) as active_sessions,
        COUNT(DISTINCT workspace) as unique_repos,
        COALESCE(SUM(message_count), 0) as total_messages,
        COALESCE(SUM(tool_call_count), 0) as total_tool_calls,
        COALESCE(SUM(active_seconds), 0) as total_duration
      FROM sessions
      WHERE user_id = ? AND created_at >= ?
    `).bind(user.id, periodStartStr).first<{
      total_sessions: number;
      active_sessions: number;
      unique_repos: number;
      total_messages: number;
      total_tool_calls: number;
      total_duration: number;
    }>(),

    // Previous period aggregates (for delta)
    c.env.DB.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(message_count), 0) as messages
      FROM sessions
      WHERE user_id = ? AND created_at >= ? AND created_at < ?
    `).bind(user.id, prevPeriodStartStr, periodStartStr).first<{ count: number; messages: number }>(),

    // Daily activity with message counts
    c.env.DB.prepare(`
      WITH RECURSIVE dates(date) AS (
        SELECT date(?, '-' || ? || ' days')
        UNION ALL
        SELECT date(date, '+1 day') FROM dates WHERE date < date('now')
      )
      SELECT
        d.date,
        COALESCE(sc.cnt, 0) as sessions,
        COALESCE(sc.msgs, 0) as messages
      FROM dates d
      LEFT JOIN (
        SELECT date(created_at) as day, COUNT(*) as cnt, COALESCE(SUM(message_count), 0) as msgs
        FROM sessions WHERE user_id = ? AND created_at >= ?
        GROUP BY day
      ) sc ON sc.day = d.date
      ORDER BY d.date
    `).bind(periodStartStr, Math.max(1, Math.ceil(periodHours / 24)), user.id, periodStartStr).all(),

    // Top repos by session count with message totals
    c.env.DB.prepare(`
      SELECT
        workspace,
        COUNT(*) as session_count,
        COALESCE(SUM(message_count), 0) as message_count
      FROM sessions
      WHERE user_id = ? AND created_at >= ?
      GROUP BY workspace
      ORDER BY session_count DESC
      LIMIT 8
    `).bind(user.id, periodStartStr).all(),

    // Recent sessions
    c.env.DB.prepare(`
      SELECT
        id, workspace, status, message_count, tool_call_count,
        active_seconds as duration_seconds,
        created_at, last_active_at, error_message
      FROM sessions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(user.id).all(),

    // Currently active sessions
    c.env.DB.prepare(`
      SELECT id, workspace, status, created_at, last_active_at
      FROM sessions
      WHERE user_id = ? AND status IN ('running', 'idle', 'initializing', 'restoring')
      ORDER BY last_active_at DESC
    `).bind(user.id).all(),
  ]);

  const agg = aggregateResult!;
  const totalSessions = agg.total_sessions;
  const totalMessages = agg.total_messages;
  const totalToolCalls = agg.total_tool_calls;
  const totalDuration = agg.total_duration;
  const avgDuration = totalSessions > 0 ? Math.floor(totalDuration / totalSessions) : 0;

  const prevSessions = prevPeriodResult?.count ?? 0;
  const prevMessages = prevPeriodResult?.messages ?? 0;
  const sessionDelta = prevSessions > 0 ? Math.round(((totalSessions - prevSessions) / prevSessions) * 100) : 0;
  const messageDelta = prevMessages > 0 ? Math.round(((totalMessages - prevMessages) / prevMessages) * 100) : 0;

  const response: DashboardStatsResponse = {
    hero: {
      totalSessions,
      activeSessions: agg.active_sessions,
      totalMessages,
      uniqueRepos: agg.unique_repos,
      totalToolCalls,
      totalSessionDurationSeconds: totalDuration,
      avgSessionDurationSeconds: avgDuration,
      estimatedLinesChanged: totalToolCalls * 15,
      sessionHours: Math.round((totalDuration / 3600) * 10) / 10,
    },
    delta: {
      sessions: sessionDelta,
      messages: messageDelta,
    },
    activity: (activityResult.results ?? []).map((r: Record<string, unknown>) => ({
      date: String(r.date),
      sessions: Number(r.sessions),
      messages: Number(r.messages),
    })),
    topRepos: (topReposResult.results ?? []).map((r: Record<string, unknown>) => ({
      workspace: String(r.workspace),
      sessionCount: Number(r.session_count),
      messageCount: Number(r.message_count),
    })),
    recentSessions: (recentSessionsResult.results ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      workspace: String(r.workspace),
      status: String(r.status) as DashboardStatsResponse['recentSessions'][0]['status'],
      messageCount: Number(r.message_count),
      toolCallCount: Number(r.tool_call_count),
      durationSeconds: Number(r.duration_seconds),
      createdAt: String(r.created_at),
      lastActiveAt: String(r.last_active_at),
      errorMessage: r.error_message ? String(r.error_message) : undefined,
    })),
    activeSessions: (activeSessionsResult.results ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      workspace: String(r.workspace),
      status: String(r.status) as DashboardStatsResponse['activeSessions'][0]['status'],
      createdAt: String(r.created_at),
      lastActiveAt: String(r.last_active_at),
    })),
    period,
  };

  return c.json(response);
});
