import type { D1Database } from '@cloudflare/workers-types';
import type { AgentSession, SessionGitState, AdoptionMetrics, SessionSourceType, PRState, SessionFileChanged, ChildSessionSummary, SessionParticipant, SessionParticipantRole, SessionParticipantSummary, SessionShareLink, AuditLogEntry, SessionPurpose } from '@agent-ops/shared';
import { mapSession, mapSessionWithOwner, mapSessionGitState, mapShareLink, generateShareToken, ROLE_HIERARCHY, ACTIVE_SESSION_STATUSES, DEFAULT_MAX_ACTIVE_SESSIONS } from './mappers.js';
import { getOrgSettings } from './org.js';

// ─── Exported Types ─────────────────────────────────────────────────────────

export type SessionOwnershipFilter = 'all' | 'mine' | 'shared';

export interface GetChildSessionsOptions {
  limit?: number;
  cursor?: string;
  status?: string;
  excludeStatuses?: string[];
}

export interface PaginatedChildSessions {
  children: ChildSessionSummary[];
  cursor?: string;
  hasMore: boolean;
  totalCount: number;
}

export interface ConcurrencyCheckResult {
  allowed: boolean;
  reason?: string;
  activeCount: number;
  limit: number;
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

export async function createSession(
  db: D1Database,
  data: { id: string; userId: string; workspace: string; title?: string; parentSessionId?: string; containerId?: string; metadata?: Record<string, unknown>; personaId?: string; isOrchestrator?: boolean; purpose?: SessionPurpose }
): Promise<AgentSession> {
  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, workspace, status, container_id, metadata, title, parent_session_id, persona_id, is_orchestrator, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      data.id,
      data.userId,
      data.workspace,
      'initializing',
      data.containerId || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.title || null,
      data.parentSessionId || null,
      data.personaId || null,
      data.isOrchestrator ? 1 : 0,
      data.purpose || (data.isOrchestrator ? 'orchestrator' : 'interactive')
    )
    .run();

  return {
    id: data.id,
    userId: data.userId,
    workspace: data.workspace,
    status: 'initializing',
    title: data.title,
    parentSessionId: data.parentSessionId,
    containerId: data.containerId,
    metadata: data.metadata,
    personaId: data.personaId,
    isOrchestrator: data.isOrchestrator,
    purpose: data.purpose || (data.isOrchestrator ? 'orchestrator' : 'interactive'),
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };
}

export async function getSession(db: D1Database, id: string): Promise<AgentSession | null> {
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  return row ? mapSession(row) : null;
}

export async function getUserSessions(
  db: D1Database,
  userId: string,
  options: { limit?: number; cursor?: string; status?: string; ownership?: SessionOwnershipFilter } = {}
): Promise<{ sessions: AgentSession[]; cursor?: string; hasMore: boolean }> {
  const limit = options.limit || 20;
  const ownership = options.ownership || 'all';

  // Build the base query with owner info joined
  let query = `
    SELECT DISTINCT
      s.*,
      owner.name as owner_name,
      owner.email as owner_email,
      owner.avatar_url as owner_avatar_url,
      ap.name as persona_name,
      (SELECT COUNT(*) FROM session_participants sp2 WHERE sp2.session_id = s.id) as participant_count
    FROM sessions s
    JOIN users owner ON owner.id = s.user_id
    LEFT JOIN agent_personas ap ON ap.id = s.persona_id
    LEFT JOIN session_participants sp ON sp.session_id = s.id AND sp.user_id = ?
    WHERE `;

  const params: (string | number)[] = [userId];

  // Apply ownership filter
  if (ownership === 'mine') {
    query += 's.user_id = ?';
    params.push(userId);
  } else if (ownership === 'shared') {
    query += 's.user_id != ? AND sp.user_id IS NOT NULL';
    params.push(userId);
  } else {
    // 'all' - owned by user OR user is a participant
    query += '(s.user_id = ? OR sp.user_id IS NOT NULL)';
    params.push(userId);
  }

  // Orchestrator sessions are private to their owner and should never appear
  // in other users' lists even if they were previously shared.
  query += ' AND (s.is_orchestrator = 0 OR s.user_id = ?)';
  params.push(userId);

  // Workflow sessions are internal runtime sessions and are hidden from standard lists.
  query += " AND COALESCE(s.purpose, 'interactive') != 'workflow'";

  if (options.status) {
    query += ' AND s.status = ?';
    params.push(options.status);
  }

  if (options.cursor) {
    query += ' AND s.created_at < ?';
    params.push(options.cursor);
  }

  query += ' ORDER BY s.created_at DESC LIMIT ?';
  params.push(limit + 1);

  const stmt = db.prepare(query);
  const result = await stmt.bind(...params).all();
  const rows = result.results || [];

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  // Fetch participants for all sessions in batch
  const sessionIds = pageRows.map((row: any) => row.id);
  const participantsBySession = await getParticipantsForSessions(db, sessionIds);

  const sessions = pageRows.map((row: any) => mapSessionWithOwner(row, userId, participantsBySession.get(row.id) || []));

  return {
    sessions,
    // Use the raw DB string (YYYY-MM-DD HH:MM:SS) so it matches SQLite's format
    cursor: hasMore ? String((pageRows[pageRows.length - 1] as any).created_at) : undefined,
    hasMore,
  };
}

async function getParticipantsForSessions(
  db: D1Database,
  sessionIds: string[]
): Promise<Map<string, SessionParticipantSummary[]>> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT sp.session_id, sp.user_id, sp.role, u.name, u.email, u.avatar_url
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.session_id IN (${placeholders})
       ORDER BY sp.created_at ASC`
    )
    .bind(...sessionIds)
    .all();

  const map = new Map<string, SessionParticipantSummary[]>();
  for (const row of result.results || []) {
    const r = row as any;
    const sessionId = r.session_id;
    if (!map.has(sessionId)) {
      map.set(sessionId, []);
    }
    map.get(sessionId)!.push({
      userId: r.user_id,
      name: r.name || undefined,
      email: r.email || undefined,
      avatarUrl: r.avatar_url || undefined,
      role: r.role as SessionParticipantRole,
    });
  }
  return map;
}

export async function updateSessionStatus(
  db: D1Database,
  id: string,
  status: AgentSession['status'],
  containerId?: string,
  errorMessage?: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE sessions SET status = ?, container_id = COALESCE(?, container_id), error_message = ?, last_active_at = datetime(\'now\') WHERE id = ?'
    )
    .bind(status, containerId || null, errorMessage || null, id)
    .run();
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

// Session metrics (flushed from DO)
export async function updateSessionMetrics(
  db: D1Database,
  id: string,
  metrics: { messageCount: number; toolCallCount: number }
): Promise<void> {
  await db
    .prepare(
      "UPDATE sessions SET message_count = ?, tool_call_count = ?, last_active_at = datetime('now') WHERE id = ?"
    )
    .bind(metrics.messageCount, metrics.toolCallCount, id)
    .run();
}

export async function addActiveSeconds(
  db: D1Database,
  id: string,
  seconds: number
): Promise<void> {
  if (seconds <= 0) return;
  await db
    .prepare(
      'UPDATE sessions SET active_seconds = active_seconds + ? WHERE id = ?'
    )
    .bind(Math.round(seconds), id)
    .run();
}

// Session title update
export async function updateSessionTitle(db: D1Database, sessionId: string, title: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET title = ?, last_active_at = datetime('now') WHERE id = ?")
    .bind(title, sessionId)
    .run();
}

// ─── Session Git State ──────────────────────────────────────────────────────

export async function createSessionGitState(
  db: D1Database,
  data: {
    sessionId: string;
    sourceType?: SessionSourceType;
    sourcePrNumber?: number;
    sourceIssueNumber?: number;
    sourceRepoFullName?: string;
    sourceRepoUrl?: string;
    branch?: string;
    ref?: string;
    baseBranch?: string;
  }
): Promise<SessionGitState> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO session_git_state (id, session_id, source_type, source_pr_number, source_issue_number, source_repo_full_name, source_repo_url, branch, ref, base_branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      data.sessionId,
      data.sourceType || null,
      data.sourcePrNumber ?? null,
      data.sourceIssueNumber ?? null,
      data.sourceRepoFullName || null,
      data.sourceRepoUrl || null,
      data.branch || null,
      data.ref || null,
      data.baseBranch || null
    )
    .run();

  return mapSessionGitState({
    id,
    session_id: data.sessionId,
    source_type: data.sourceType || null,
    source_pr_number: data.sourcePrNumber ?? null,
    source_issue_number: data.sourceIssueNumber ?? null,
    source_repo_full_name: data.sourceRepoFullName || null,
    source_repo_url: data.sourceRepoUrl || null,
    branch: data.branch || null,
    ref: data.ref || null,
    base_branch: data.baseBranch || null,
    commit_count: 0,
    pr_number: null,
    pr_title: null,
    pr_state: null,
    pr_url: null,
    pr_created_at: null,
    pr_merged_at: null,
    agent_authored: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function updateSessionGitState(
  db: D1Database,
  sessionId: string,
  updates: Partial<{
    branch: string;
    ref: string;
    baseBranch: string;
    commitCount: number;
    prNumber: number;
    prTitle: string;
    prState: PRState;
    prUrl: string;
    prCreatedAt: string;
    prMergedAt: string;
  }>
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.branch !== undefined) { sets.push('branch = ?'); params.push(updates.branch); }
  if (updates.ref !== undefined) { sets.push('ref = ?'); params.push(updates.ref); }
  if (updates.baseBranch !== undefined) { sets.push('base_branch = ?'); params.push(updates.baseBranch); }
  if (updates.commitCount !== undefined) { sets.push('commit_count = ?'); params.push(updates.commitCount); }
  if (updates.prNumber !== undefined) { sets.push('pr_number = ?'); params.push(updates.prNumber); }
  if (updates.prTitle !== undefined) { sets.push('pr_title = ?'); params.push(updates.prTitle); }
  if (updates.prState !== undefined) { sets.push('pr_state = ?'); params.push(updates.prState); }
  if (updates.prUrl !== undefined) { sets.push('pr_url = ?'); params.push(updates.prUrl); }
  if (updates.prCreatedAt !== undefined) { sets.push('pr_created_at = ?'); params.push(updates.prCreatedAt); }
  if (updates.prMergedAt !== undefined) { sets.push('pr_merged_at = ?'); params.push(updates.prMergedAt); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db
    .prepare(`UPDATE session_git_state SET ${sets.join(', ')} WHERE session_id = ?`)
    .bind(...params, sessionId)
    .run();
}

export async function getSessionGitState(db: D1Database, sessionId: string): Promise<SessionGitState | null> {
  const row = await db
    .prepare('SELECT * FROM session_git_state WHERE session_id = ?')
    .bind(sessionId)
    .first();
  return row ? mapSessionGitState(row) : null;
}

export async function getAdoptionMetrics(db: D1Database, periodDays: number): Promise<AdoptionMetrics> {
  const result = await db
    .prepare(
      `SELECT
        COUNT(CASE WHEN pr_number IS NOT NULL AND agent_authored = 1 THEN 1 END) as total_prs_created,
        COUNT(CASE WHEN pr_state = 'merged' AND agent_authored = 1 THEN 1 END) as total_prs_merged,
        COALESCE(SUM(commit_count), 0) as total_commits
      FROM session_git_state
      WHERE created_at >= datetime('now', '-' || ? || ' days')`
    )
    .bind(periodDays)
    .first<{ total_prs_created: number; total_prs_merged: number; total_commits: number }>();

  const totalCreated = result?.total_prs_created ?? 0;
  const totalMerged = result?.total_prs_merged ?? 0;

  return {
    totalPRsCreated: totalCreated,
    totalPRsMerged: totalMerged,
    mergeRate: totalCreated > 0 ? Math.round((totalMerged / totalCreated) * 100) : 0,
    totalCommits: result?.total_commits ?? 0,
  };
}

// ─── Child Sessions ─────────────────────────────────────────────────────────

export async function getChildSessions(
  db: D1Database,
  parentSessionId: string,
  options: GetChildSessionsOptions = {}
): Promise<PaginatedChildSessions> {
  const { limit = 20, cursor, status, excludeStatuses } = options;

  // Build WHERE clauses
  const whereClauses = ['s.parent_session_id = ?'];
  const binds: (string | number)[] = [parentSessionId];

  if (status) {
    whereClauses.push('s.status = ?');
    binds.push(status);
  }

  if (excludeStatuses && excludeStatuses.length > 0) {
    const placeholders = excludeStatuses.map(() => '?').join(',');
    whereClauses.push(`s.status NOT IN (${placeholders})`);
    binds.push(...excludeStatuses);
  }

  if (cursor) {
    whereClauses.push('s.created_at < ?');
    binds.push(cursor);
  }

  const whereStr = whereClauses.join(' AND ');

  // Count query (without cursor/limit for total)
  const countClauses = whereClauses.filter((c) => !c.startsWith('s.created_at <'));
  const countBinds = binds.filter((_, i) => !whereClauses[i]?.startsWith('s.created_at <'));
  const countResult = await db
    .prepare(`SELECT COUNT(*) as count FROM sessions s WHERE ${countClauses.join(' AND ')}`)
    .bind(...countBinds)
    .first<{ count: number }>();
  const totalCount = countResult?.count ?? 0;

  // Fetch limit + 1 to detect hasMore
  const fetchLimit = limit + 1;
  const result = await db
    .prepare(
      `SELECT s.id, s.title, s.status, s.workspace, s.created_at,
              g.pr_number, g.pr_state, g.pr_url, g.pr_title
       FROM sessions s
       LEFT JOIN session_git_state g ON g.session_id = s.id
       WHERE ${whereStr}
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .bind(...binds, fetchLimit)
    .all();

  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const children = pageRows.map((row: any) => ({
    id: row.id,
    title: row.title || undefined,
    status: row.status,
    workspace: row.workspace,
    prNumber: row.pr_number ?? undefined,
    prState: row.pr_state || undefined,
    prUrl: row.pr_url || undefined,
    prTitle: row.pr_title || undefined,
    createdAt: row.created_at,
  }));

  return {
    children,
    cursor: hasMore ? (pageRows[pageRows.length - 1]?.created_at as string | undefined) : undefined,
    hasMore,
    totalCount,
  };
}

// ─── Session Concurrency ────────────────────────────────────────────────────

export async function checkSessionConcurrency(
  db: D1Database,
  userId: string
): Promise<ConcurrencyCheckResult> {
  // Get user's custom limit (NULL = default)
  const user = await db
    .prepare('SELECT max_active_sessions FROM users WHERE id = ?')
    .bind(userId)
    .first<{ max_active_sessions: number | null }>();

  const limit = user?.max_active_sessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;

  // Count active sessions (exclude orchestrator and workflow sessions)
  const placeholders = ACTIVE_SESSION_STATUSES.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM sessions
       WHERE user_id = ?
         AND status IN (${placeholders})
         AND (parent_session_id IS NULL OR parent_session_id NOT LIKE 'orchestrator:%')
         AND id NOT LIKE 'orchestrator:%'`
    )
    .bind(userId, ...ACTIVE_SESSION_STATUSES)
    .first<{ count: number }>();

  const activeCount = result?.count ?? 0;

  if (activeCount >= limit) {
    return {
      allowed: false,
      reason: `You have ${activeCount} active sessions (limit: ${limit}). Terminate some sessions before creating new ones.`,
      activeCount,
      limit,
    };
  }

  return { allowed: true, activeCount, limit };
}

// ─── Session Files Changed ──────────────────────────────────────────────────

export async function upsertSessionFileChanged(
  db: D1Database,
  sessionId: string,
  file: { filePath: string; status: string; additions?: number; deletions?: number }
): Promise<void> {
  const id = `${sessionId}:${file.filePath}`;
  await db
    .prepare(
      `INSERT INTO session_files_changed (id, session_id, file_path, status, additions, deletions)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, file_path) DO UPDATE SET
         status = excluded.status,
         additions = excluded.additions,
         deletions = excluded.deletions,
         updated_at = datetime('now')`
    )
    .bind(id, sessionId, file.filePath, file.status, file.additions ?? 0, file.deletions ?? 0)
    .run();
}

export async function getSessionFilesChanged(db: D1Database, sessionId: string): Promise<SessionFileChanged[]> {
  const result = await db
    .prepare('SELECT * FROM session_files_changed WHERE session_id = ? ORDER BY file_path ASC')
    .bind(sessionId)
    .all();

  return (result.results || []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    filePath: row.file_path,
    status: row.status,
    additions: row.additions ?? 0,
    deletions: row.deletions ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ─── Session Participants ───────────────────────────────────────────────────

export async function getSessionParticipants(db: D1Database, sessionId: string): Promise<SessionParticipant[]> {
  const result = await db
    .prepare(
      `SELECT sp.*, u.name as user_name, u.email as user_email, u.avatar_url as user_avatar_url
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.session_id = ?
       ORDER BY sp.created_at ASC`
    )
    .bind(sessionId)
    .all();

  return (result.results || []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role as SessionParticipantRole,
    addedBy: row.added_by || undefined,
    createdAt: new Date(row.created_at),
    userName: row.user_name || undefined,
    userEmail: row.user_email || undefined,
    userAvatarUrl: row.user_avatar_url || undefined,
  }));
}

export async function addSessionParticipant(
  db: D1Database,
  sessionId: string,
  userId: string,
  role: SessionParticipantRole = 'collaborator',
  addedBy?: string
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO session_participants (id, session_id, user_id, role, added_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO NOTHING`
    )
    .bind(id, sessionId, userId, role, addedBy || null)
    .run();
}

export async function removeSessionParticipant(db: D1Database, sessionId: string, userId: string): Promise<void> {
  await db
    .prepare('DELETE FROM session_participants WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .run();
}

export async function getSessionParticipant(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<SessionParticipant | null> {
  const row = await db
    .prepare(
      `SELECT sp.*, u.name as user_name, u.email as user_email, u.avatar_url as user_avatar_url
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.session_id = ? AND sp.user_id = ?`
    )
    .bind(sessionId, userId)
    .first();

  if (!row) return null;
  return {
    id: (row as any).id,
    sessionId: (row as any).session_id,
    userId: (row as any).user_id,
    role: (row as any).role as SessionParticipantRole,
    addedBy: (row as any).added_by || undefined,
    createdAt: new Date((row as any).created_at),
    userName: (row as any).user_name || undefined,
    userEmail: (row as any).user_email || undefined,
    userAvatarUrl: (row as any).user_avatar_url || undefined,
  };
}

export async function isSessionParticipant(db: D1Database, sessionId: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first();
  return !!result;
}

// ─── Session Share Links ────────────────────────────────────────────────────

export async function createShareLink(
  db: D1Database,
  sessionId: string,
  role: SessionParticipantRole,
  createdBy: string,
  expiresAt?: string,
  maxUses?: number
): Promise<SessionShareLink> {
  const id = crypto.randomUUID();
  const token = generateShareToken();

  await db
    .prepare(
      `INSERT INTO session_share_links (id, session_id, token, role, created_by, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, sessionId, token, role, createdBy, expiresAt || null, maxUses ?? null)
    .run();

  return {
    id,
    sessionId,
    token,
    role,
    createdBy,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    maxUses,
    useCount: 0,
    active: true,
    createdAt: new Date(),
  };
}

export async function getShareLink(db: D1Database, token: string): Promise<SessionShareLink | null> {
  const row = await db
    .prepare("SELECT * FROM session_share_links WHERE token = ? AND active = 1")
    .bind(token)
    .first();

  if (!row) return null;
  return mapShareLink(row);
}

export async function getShareLinkById(db: D1Database, id: string): Promise<SessionShareLink | null> {
  const row = await db
    .prepare("SELECT * FROM session_share_links WHERE id = ?")
    .bind(id)
    .first();

  if (!row) return null;
  return mapShareLink(row);
}

export async function getSessionShareLinks(db: D1Database, sessionId: string): Promise<SessionShareLink[]> {
  const result = await db
    .prepare("SELECT * FROM session_share_links WHERE session_id = ? ORDER BY created_at DESC")
    .bind(sessionId)
    .all();

  return (result.results || []).map(mapShareLink);
}

export async function redeemShareLink(
  db: D1Database,
  token: string,
  userId: string
): Promise<{ sessionId: string; role: SessionParticipantRole } | null> {
  const link = await getShareLink(db, token);
  if (!link) return null;

  // Check expiry
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;

  // Check max uses
  if (link.maxUses !== undefined && link.maxUses !== null && link.useCount >= link.maxUses) return null;

  // Increment use count
  await db
    .prepare('UPDATE session_share_links SET use_count = use_count + 1 WHERE token = ?')
    .bind(token)
    .run();

  // Add user as participant
  await addSessionParticipant(db, link.sessionId, userId, link.role, link.createdBy);

  return { sessionId: link.sessionId, role: link.role };
}

export async function deactivateShareLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE session_share_links SET active = 0 WHERE id = ?')
    .bind(id)
    .run();
}

// ─── Session Access Helpers ─────────────────────────────────────────────────

export function roleAtLeast(role: SessionParticipantRole, required: SessionParticipantRole): boolean {
  return (ROLE_HIERARCHY[role] ?? -1) >= (ROLE_HIERARCHY[required] ?? 999);
}

/**
 * Check if a user has access to a session with at least the given role.
 * Returns the session if accessible, throws NotFoundError otherwise.
 */
export async function assertSessionAccess(
  database: D1Database,
  sessionId: string,
  userId: string,
  requiredRole: SessionParticipantRole = 'viewer'
): Promise<AgentSession> {
  const session = await getSession(database, sessionId);
  if (!session) {
    const { NotFoundError } = await import('@agent-ops/shared');
    throw new NotFoundError('Session', sessionId);
  }

  // Owner always has access
  if (session.userId === userId) return session;

  // Orchestrator sessions are never accessible to non-owners.
  if (session.isOrchestrator || session.purpose === 'workflow') {
    const { NotFoundError } = await import('@agent-ops/shared');
    throw new NotFoundError('Session', sessionId);
  }

  // Check participant table
  const participant = await getSessionParticipant(database, sessionId, userId);
  if (participant && roleAtLeast(participant.role, requiredRole)) return session;

  // Check org-wide visibility
  try {
    const orgSettings = await getOrgSettings(database);
    const visibility = (orgSettings as any).defaultSessionVisibility || 'private';
    if (visibility === 'org_joinable') return session;
    if (visibility === 'org_visible' && requiredRole === 'viewer') return session;
  } catch {
    // org_settings column may not exist yet
  }

  const { NotFoundError } = await import('@agent-ops/shared');
  throw new NotFoundError('Session', sessionId);
}

// ─── Session Audit Log ──────────────────────────────────────────────────────

export async function getSessionAuditLog(
  db: D1Database,
  sessionId: string,
  options: { limit?: number; after?: string; eventType?: string } = {}
): Promise<AuditLogEntry[]> {
  const limit = options.limit || 200;
  let query = 'SELECT * FROM session_audit_log WHERE session_id = ?';
  const params: (string | number)[] = [sessionId];

  if (options.after) {
    query += ' AND created_at > ?';
    params.push(options.after);
  }

  if (options.eventType) {
    query += ' AND event_type = ?';
    params.push(options.eventType);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    summary: row.summary,
    actorId: row.actor_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  }));
}
