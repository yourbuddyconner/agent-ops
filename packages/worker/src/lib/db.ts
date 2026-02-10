import type { D1Database } from '@cloudflare/workers-types';
import type { AgentSession, Integration, Message, User, UserRole, OrgSettings, OrgApiKey, Invite, SyncStatusResponse, SessionGitState, AdoptionMetrics, SessionSourceType, PRState, SessionFileChanged, ChildSessionSummary, SessionParticipant, SessionParticipantRole, SessionParticipantSummary, SessionShareLink, AuditLogEntry, OrgRepository, AgentPersona, AgentPersonaFile, PersonaVisibility, OrchestratorIdentity, OrchestratorMemory, OrchestratorMemoryCategory, SessionPurpose, MailboxMessage, SessionTask, UserNotificationPreference, UserIdentityLink, ChannelBinding, ChannelType, QueueMode, UserTelegramConfig } from '@agent-ops/shared';
import { encryptString, decryptString } from './crypto.js';

/**
 * Database helper functions for D1
 */

// User operations
export async function getOrCreateUser(
  db: D1Database,
  data: { id: string; email: string; name?: string; avatarUrl?: string }
): Promise<User> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(data.id)
    .first<User>();

  if (existing) {
    return existing;
  }

  await db
    .prepare('INSERT INTO users (id, email, name, avatar_url) VALUES (?, ?, ?, ?)')
    .bind(data.id, data.email, data.name || null, data.avatarUrl || null)
    .run();

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatarUrl,
    role: 'member' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Session operations
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

export type SessionOwnershipFilter = 'all' | 'mine' | 'shared';

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

function mapSessionWithOwner(
  row: any,
  currentUserId: string,
  participants: SessionParticipantSummary[]
): AgentSession {
  const base = mapSession(row);
  return {
    ...base,
    ownerName: row.owner_name || undefined,
    ownerEmail: row.owner_email || undefined,
    ownerAvatarUrl: row.owner_avatar_url || undefined,
    participantCount: row.participant_count ?? 0,
    participants,
    isOwner: row.user_id === currentUserId,
  };
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

// Integration operations
export async function createIntegration(
  db: D1Database,
  data: { id: string; userId: string; service: string; config: Record<string, unknown> }
): Promise<Integration> {
  await db
    .prepare('INSERT INTO integrations (id, user_id, service, config, status) VALUES (?, ?, ?, ?, ?)')
    .bind(data.id, data.userId, data.service, JSON.stringify(data.config), 'pending')
    .run();

  return {
    id: data.id,
    userId: data.userId,
    service: data.service as Integration['service'],
    config: data.config as unknown as Integration['config'],
    status: 'pending',
    scope: 'user' as const,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getIntegration(db: D1Database, id: string): Promise<Integration | null> {
  const row = await db.prepare('SELECT * FROM integrations WHERE id = ?').bind(id).first();
  return row ? mapIntegration(row) : null;
}

export async function getUserIntegrations(db: D1Database, userId: string): Promise<Integration[]> {
  const result = await db
    .prepare('SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (result.results || []).map(mapIntegration);
}

export async function updateIntegrationStatus(
  db: D1Database,
  id: string,
  status: Integration['status'],
  errorMessage?: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE integrations SET status = ?, error_message = ?, updated_at = datetime(\'now\') WHERE id = ?'
    )
    .bind(status, errorMessage || null, id)
    .run();
}

export async function updateIntegrationSyncTime(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE integrations SET last_synced_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .bind(id)
    .run();
}

export async function deleteIntegration(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM integrations WHERE id = ?').bind(id).run();
}

// Sync log operations
export async function createSyncLog(
  db: D1Database,
  data: { id: string; integrationId: string }
): Promise<SyncStatusResponse> {
  await db
    .prepare('INSERT INTO sync_logs (id, integration_id, status) VALUES (?, ?, ?)')
    .bind(data.id, data.integrationId, 'pending')
    .run();

  return {
    id: data.id,
    integrationId: data.integrationId,
    status: 'pending',
    startedAt: new Date(),
  };
}

export async function updateSyncLog(
  db: D1Database,
  id: string,
  data: { status: string; recordsSynced?: number; errors?: unknown[] }
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_logs SET
        status = ?,
        records_synced = COALESCE(?, records_synced),
        errors = ?,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN datetime('now') ELSE completed_at END
      WHERE id = ?`
    )
    .bind(
      data.status,
      data.recordsSynced ?? null,
      data.errors ? JSON.stringify(data.errors) : null,
      data.status,
      id
    )
    .run();
}

export async function getSyncLog(db: D1Database, id: string): Promise<SyncStatusResponse | null> {
  const row = await db.prepare('SELECT * FROM sync_logs WHERE id = ?').bind(id).first();
  return row ? mapSyncLog(row) : null;
}

// Message operations
export async function saveMessage(
  db: D1Database,
  data: { id: string; sessionId: string; role: string; content: string; toolCalls?: unknown[]; parts?: unknown; authorId?: string; authorEmail?: string; authorName?: string; authorAvatarUrl?: string; channelType?: string; channelId?: string; opencodeSessionId?: string }
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO messages (id, session_id, role, content, tool_calls, parts, author_id, author_email, author_name, author_avatar_url, channel_type, channel_id, opencode_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(data.id, data.sessionId, data.role, data.content, data.toolCalls ? JSON.stringify(data.toolCalls) : null, data.parts ? JSON.stringify(data.parts) : null, data.authorId || null, data.authorEmail || null, data.authorName || null, data.authorAvatarUrl || null, data.channelType || null, data.channelId || null, data.opencodeSessionId || null)
    .run();
}

export async function getSessionMessages(
  db: D1Database,
  sessionId: string,
  options: { limit?: number; after?: string } = {}
): Promise<Message[]> {
  const limit = options.limit || 100;
  let query = 'SELECT * FROM messages WHERE session_id = ?';
  const params: (string | number)[] = [sessionId];

  if (options.after) {
    query += ' AND created_at > ?';
    params.push(options.after);
  }

  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return (result.results || []).map(mapMessage);
}

// Synced entity operations
export async function upsertSyncedEntity(
  db: D1Database,
  data: { integrationId: string; entityType: string; externalId: string; data: unknown }
): Promise<void> {
  const id = `${data.integrationId}:${data.entityType}:${data.externalId}`;
  await db
    .prepare(
      `INSERT INTO synced_entities (id, integration_id, entity_type, external_id, data, synced_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(integration_id, entity_type, external_id)
       DO UPDATE SET data = excluded.data, synced_at = datetime('now')`
    )
    .bind(id, data.integrationId, data.entityType, data.externalId, JSON.stringify(data.data))
    .run();
}

export async function getSyncedEntities(
  db: D1Database,
  integrationId: string,
  entityType: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ entities: unknown[]; cursor?: string; hasMore: boolean }> {
  const limit = options.limit || 100;
  let query = 'SELECT * FROM synced_entities WHERE integration_id = ? AND entity_type = ?';
  const params: (string | number)[] = [integrationId, entityType];

  if (options.cursor) {
    query += ' AND external_id > ?';
    params.push(options.cursor);
  }

  query += ' ORDER BY external_id ASC LIMIT ?';
  params.push(limit + 1);

  const result = await db.prepare(query).bind(...params).all();
  const rows = result.results || [];

  const hasMore = rows.length > limit;
  const entities = rows.slice(0, limit).map((row: any) => ({
    id: row.external_id,
    ...JSON.parse(row.data as string),
  }));

  return {
    entities,
    cursor: hasMore ? (rows[limit - 1] as any).external_id : undefined,
    hasMore,
  };
}

// Auth session operations
export async function createAuthSession(
  db: D1Database,
  data: { id: string; userId: string; tokenHash: string; provider: string; expiresAt: string }
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO auth_sessions (id, user_id, token_hash, provider, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, data.tokenHash, data.provider, data.expiresAt)
    .run();
}

export async function getAuthSessionByTokenHash(
  db: D1Database,
  tokenHash: string
): Promise<{ id: string; email: string } | null> {
  const result = await db
    .prepare(
      `SELECT u.id, u.email
       FROM auth_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ?
         AND s.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<{ id: string; email: string }>();

  if (result) {
    // Update last_used_at
    await db
      .prepare("UPDATE auth_sessions SET last_used_at = datetime('now') WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  return result || null;
}

export async function deleteAuthSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteUserAuthSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}

// OAuth token operations
export async function upsertOAuthToken(
  db: D1Database,
  data: {
    id: string;
    userId: string;
    provider: string;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string;
    scopes?: string;
    expiresAt?: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_tokens (id, user_id, provider, encrypted_access_token, encrypted_refresh_token, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider)
       DO UPDATE SET
         encrypted_access_token = excluded.encrypted_access_token,
         encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, encrypted_refresh_token),
         scopes = COALESCE(excluded.scopes, scopes),
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`
    )
    .bind(
      data.id,
      data.userId,
      data.provider,
      data.encryptedAccessToken,
      data.encryptedRefreshToken || null,
      data.scopes || null,
      data.expiresAt || null
    )
    .run();
}

export async function getOAuthToken(
  db: D1Database,
  userId: string,
  provider: string
): Promise<{ encryptedAccessToken: string; encryptedRefreshToken: string | null; scopes: string | null } | null> {
  const result = await db
    .prepare('SELECT encrypted_access_token, encrypted_refresh_token, scopes FROM oauth_tokens WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first<{ encrypted_access_token: string; encrypted_refresh_token: string | null; scopes: string | null }>();

  if (!result) return null;
  return {
    encryptedAccessToken: result.encrypted_access_token,
    encryptedRefreshToken: result.encrypted_refresh_token,
    scopes: result.scopes,
  };
}

// User lookup operations
export async function findUserByGitHubId(db: D1Database, githubId: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return row ? mapUser(row) : null;
}

export async function updateUserGitHub(
  db: D1Database,
  userId: string,
  data: { githubId: string; githubUsername: string; name?: string; avatarUrl?: string }
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET github_id = ?, github_username = ?, name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(data.githubId, data.githubUsername, data.name || null, data.avatarUrl || null, userId)
    .run();
}

export async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return row ? mapUser(row) : null;
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  data: { name?: string; gitName?: string; gitEmail?: string; onboardingCompleted?: boolean; idleTimeoutSeconds?: number; modelPreferences?: string[] }
): Promise<User | null> {
  await db
    .prepare(
      "UPDATE users SET name = COALESCE(?, name), git_name = ?, git_email = ?, onboarding_completed = COALESCE(?, onboarding_completed), idle_timeout_seconds = COALESCE(?, idle_timeout_seconds), model_preferences = COALESCE(?, model_preferences), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(data.name ?? null, data.gitName ?? null, data.gitEmail ?? null, data.onboardingCompleted !== undefined ? (data.onboardingCompleted ? 1 : 0) : null, data.idleTimeoutSeconds ?? null, data.modelPreferences !== undefined ? JSON.stringify(data.modelPreferences) : null, userId)
    .run();

  return getUserById(db, userId);
}

export async function hasOAuthProvider(db: D1Database, userId: string, provider: string): Promise<boolean> {
  const result = await db
    .prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first();
  return !!result;
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

// Org settings operations
export async function getOrgSettings(db: D1Database): Promise<OrgSettings> {
  const row = await db.prepare("SELECT * FROM org_settings WHERE id = 'default'").first();
  if (!row) {
    return {
      id: 'default',
      name: 'My Organization',
      domainGatingEnabled: false,
      emailAllowlistEnabled: false,
      defaultSessionVisibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  return mapOrgSettings(row);
}

export async function updateOrgSettings(
  db: D1Database,
  updates: Partial<Pick<OrgSettings, 'name' | 'allowedEmailDomain' | 'allowedEmails' | 'domainGatingEnabled' | 'emailAllowlistEnabled' | 'modelPreferences'>>
): Promise<OrgSettings> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.allowedEmailDomain !== undefined) { sets.push('allowed_email_domain = ?'); params.push(updates.allowedEmailDomain || null); }
  if (updates.allowedEmails !== undefined) { sets.push('allowed_emails = ?'); params.push(updates.allowedEmails || null); }
  if (updates.domainGatingEnabled !== undefined) { sets.push('domain_gating_enabled = ?'); params.push(updates.domainGatingEnabled ? 1 : 0); }
  if (updates.emailAllowlistEnabled !== undefined) { sets.push('email_allowlist_enabled = ?'); params.push(updates.emailAllowlistEnabled ? 1 : 0); }
  if (updates.modelPreferences !== undefined) { sets.push('model_preferences = ?'); params.push(updates.modelPreferences ? JSON.stringify(updates.modelPreferences) : null); }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await db.prepare(`UPDATE org_settings SET ${sets.join(', ')} WHERE id = 'default'`).bind(...params).run();
  }

  return getOrgSettings(db);
}

// Org API key operations
export async function listOrgApiKeys(db: D1Database): Promise<OrgApiKey[]> {
  const result = await db.prepare('SELECT id, provider, set_by, created_at, updated_at FROM org_api_keys ORDER BY provider').all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    setBy: row.set_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function getOrgApiKey(db: D1Database, provider: string): Promise<{ encryptedKey: string } | null> {
  const row = await db.prepare('SELECT encrypted_key FROM org_api_keys WHERE provider = ?').bind(provider).first<{ encrypted_key: string }>();
  return row ? { encryptedKey: row.encrypted_key } : null;
}

export async function setOrgApiKey(
  db: D1Database,
  params: { id: string; provider: string; encryptedKey: string; setBy: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO org_api_keys (id, provider, encrypted_key, set_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         encrypted_key = excluded.encrypted_key,
         set_by = excluded.set_by,
         updated_at = datetime('now')`
    )
    .bind(params.id, params.provider, params.encryptedKey, params.setBy)
    .run();
}

export async function deleteOrgApiKey(db: D1Database, provider: string): Promise<void> {
  await db.prepare('DELETE FROM org_api_keys WHERE provider = ?').bind(provider).run();
}

// User credential operations
export async function listUserCredentials(db: D1Database, userId: string): Promise<import('@agent-ops/shared').UserCredential[]> {
  const result = await db.prepare(
    'SELECT id, provider, created_at, updated_at FROM user_credentials WHERE user_id = ? ORDER BY provider'
  ).bind(userId).all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    provider: row.provider,
    isSet: true,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function getUserCredential(db: D1Database, userId: string, provider: string): Promise<{ encryptedKey: string } | null> {
  const row = await db.prepare(
    'SELECT encrypted_key FROM user_credentials WHERE user_id = ? AND provider = ?'
  ).bind(userId, provider).first<{ encrypted_key: string }>();
  return row ? { encryptedKey: row.encrypted_key } : null;
}

export async function setUserCredential(
  db: D1Database,
  params: { id: string; userId: string; provider: string; encryptedKey: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO user_credentials (id, user_id, provider, encrypted_key)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       updated_at = datetime('now')`
  ).bind(params.id, params.userId, params.provider, params.encryptedKey).run();
}

export async function deleteUserCredential(db: D1Database, userId: string, provider: string): Promise<void> {
  await db.prepare('DELETE FROM user_credentials WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
}

// Invite operations
export async function createInvite(
  db: D1Database,
  params: { id: string; code: string; email?: string; role: UserRole; invitedBy: string; expiresAt: string }
): Promise<Invite> {
  await db
    .prepare('INSERT INTO invites (id, code, email, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(params.id, params.code, params.email || null, params.role, params.invitedBy, params.expiresAt)
    .run();

  return {
    id: params.id,
    code: params.code,
    email: params.email,
    role: params.role,
    invitedBy: params.invitedBy,
    expiresAt: new Date(params.expiresAt),
    createdAt: new Date(),
  };
}

export async function getInviteByEmail(db: D1Database, email: string): Promise<Invite | null> {
  const row = await db
    .prepare("SELECT * FROM invites WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime('now')")
    .bind(email)
    .first();
  return row ? mapInvite(row) : null;
}

export async function getInviteByCode(db: D1Database, code: string): Promise<Invite | null> {
  const row = await db
    .prepare("SELECT * FROM invites WHERE code = ? AND accepted_at IS NULL AND expires_at > datetime('now')")
    .bind(code)
    .first();
  return row ? mapInvite(row) : null;
}

export async function getInviteByCodeAny(db: D1Database, code: string): Promise<Invite | null> {
  const row = await db
    .prepare("SELECT * FROM invites WHERE code = ?")
    .bind(code)
    .first();
  return row ? mapInvite(row) : null;
}

export async function listInvites(db: D1Database): Promise<Invite[]> {
  const result = await db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all();
  return (result.results || []).map(mapInvite);
}

export async function deleteInvite(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM invites WHERE id = ?').bind(id).run();
}

export async function markInviteAccepted(db: D1Database, id: string, acceptedBy?: string): Promise<void> {
  await db.prepare("UPDATE invites SET accepted_at = datetime('now'), accepted_by = ? WHERE id = ?").bind(acceptedBy || null, id).run();
}

// User management operations (org)
export async function updateUserRole(db: D1Database, userId: string, role: UserRole): Promise<void> {
  await db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").bind(role, userId).run();
}

export async function getUserCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare('SELECT * FROM users ORDER BY created_at').all();
  return (result.results || []).map(mapUser);
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

// Session git state operations
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

// Session title update
export async function updateSessionTitle(db: D1Database, sessionId: string, title: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET title = ?, last_active_at = datetime('now') WHERE id = ?")
    .bind(title, sessionId)
    .run();
}

// Child sessions
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

// Session concurrency check
const ACTIVE_SESSION_STATUSES = ['initializing', 'running', 'idle', 'restoring'];
const DEFAULT_MAX_ACTIVE_SESSIONS = 10;

export interface ConcurrencyCheckResult {
  allowed: boolean;
  reason?: string;
  activeCount: number;
  limit: number;
}

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

// Session files changed
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

// ─── Session Participant Operations ──────────────────────────────────────────

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

// ─── Session Share Link Operations ──────────────────────────────────────────

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

function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

function mapShareLink(row: any): SessionShareLink {
  return {
    id: row.id,
    sessionId: row.session_id,
    token: row.token,
    role: row.role as SessionParticipantRole,
    createdBy: row.created_by,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    maxUses: row.max_uses ?? undefined,
    useCount: row.use_count ?? 0,
    active: !!row.active,
    createdAt: new Date(row.created_at),
  };
}

// ─── Session Access Helpers ─────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  collaborator: 1,
  owner: 2,
};

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

// Session audit log queries
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

// ─── Org Repository Operations ──────────────────────────────────────────

export async function createOrgRepository(
  db: D1Database,
  data: { id: string; fullName: string; description?: string; defaultBranch?: string; language?: string }
): Promise<OrgRepository> {
  const parts = data.fullName.split('/');
  const owner = parts[0];
  const name = parts[1];

  await db
    .prepare(
      `INSERT INTO org_repositories (id, owner, name, full_name, description, default_branch, language)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(data.id, owner, name, data.fullName, data.description || null, data.defaultBranch || 'main', data.language || null)
    .run();

  return mapOrgRepository({
    id: data.id,
    org_id: 'default',
    provider: 'github',
    owner,
    name,
    full_name: data.fullName,
    description: data.description || null,
    default_branch: data.defaultBranch || 'main',
    language: data.language || null,
    topics: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function listOrgRepositories(db: D1Database, orgId: string = 'default'): Promise<OrgRepository[]> {
  const result = await db
    .prepare(
      `SELECT r.*, d.persona_id, ap.name as persona_name
       FROM org_repositories r
       LEFT JOIN org_repo_persona_defaults d ON d.org_repo_id = r.id
       LEFT JOIN agent_personas ap ON ap.id = d.persona_id
       WHERE r.org_id = ? AND r.enabled = 1
       ORDER BY r.full_name ASC`
    )
    .bind(orgId)
    .all();

  return (result.results || []).map(mapOrgRepository);
}

export async function getOrgRepository(db: D1Database, id: string): Promise<OrgRepository | null> {
  const row = await db.prepare('SELECT * FROM org_repositories WHERE id = ?').bind(id).first();
  return row ? mapOrgRepository(row) : null;
}

export async function updateOrgRepository(
  db: D1Database,
  id: string,
  updates: Partial<Pick<OrgRepository, 'description' | 'defaultBranch' | 'language' | 'enabled'>>
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description || null); }
  if (updates.defaultBranch !== undefined) { sets.push('default_branch = ?'); params.push(updates.defaultBranch); }
  if (updates.language !== undefined) { sets.push('language = ?'); params.push(updates.language || null); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE org_repositories SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

export async function deleteOrgRepository(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM org_repositories WHERE id = ?').bind(id).run();
}

function mapOrgRepository(row: any): OrgRepository {
  return {
    id: row.id,
    orgId: row.org_id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description || undefined,
    defaultBranch: row.default_branch || 'main',
    language: row.language || undefined,
    topics: row.topics ? JSON.parse(row.topics) : undefined,
    enabled: !!row.enabled,
    personaId: row.persona_id || undefined,
    personaName: row.persona_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Persona Operations ─────────────────────────────────────────────────

export async function createPersona(
  db: D1Database,
  data: { id: string; name: string; slug: string; description?: string; icon?: string; defaultModel?: string; visibility?: PersonaVisibility; isDefault?: boolean; createdBy: string }
): Promise<AgentPersona> {
  // If setting as default, clear existing defaults first
  if (data.isDefault) {
    await db.prepare("UPDATE agent_personas SET is_default = 0 WHERE org_id = 'default' AND is_default = 1").run();
  }

  await db
    .prepare(
      `INSERT INTO agent_personas (id, name, slug, description, icon, default_model, visibility, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.name,
      data.slug,
      data.description || null,
      data.icon || null,
      data.defaultModel || null,
      data.visibility || 'shared',
      data.isDefault ? 1 : 0,
      data.createdBy
    )
    .run();

  return {
    id: data.id,
    orgId: 'default',
    name: data.name,
    slug: data.slug,
    description: data.description,
    icon: data.icon,
    defaultModel: data.defaultModel,
    visibility: data.visibility || 'shared',
    isDefault: !!data.isDefault,
    createdBy: data.createdBy,
    fileCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listPersonas(db: D1Database, userId: string, orgId: string = 'default'): Promise<AgentPersona[]> {
  const result = await db
    .prepare(
      `SELECT p.*, u.name as creator_name,
              (SELECT COUNT(*) FROM agent_persona_files f WHERE f.persona_id = p.id) as file_count
       FROM agent_personas p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.org_id = ?
         AND (p.visibility = 'shared' OR p.created_by = ?)
       ORDER BY p.is_default DESC, p.name ASC`
    )
    .bind(orgId, userId)
    .all();

  return (result.results || []).map(mapPersona);
}

export async function getPersonaWithFiles(db: D1Database, id: string): Promise<AgentPersona | null> {
  const row = await db
    .prepare(
      `SELECT p.*, u.name as creator_name
       FROM agent_personas p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ?`
    )
    .bind(id)
    .first();

  if (!row) return null;

  const filesResult = await db
    .prepare('SELECT * FROM agent_persona_files WHERE persona_id = ? ORDER BY sort_order ASC, filename ASC')
    .bind(id)
    .all();

  const persona = mapPersona(row);
  persona.files = (filesResult.results || []).map(mapPersonaFile);
  return persona;
}

export async function updatePersona(
  db: D1Database,
  id: string,
  updates: Partial<Pick<AgentPersona, 'name' | 'slug' | 'description' | 'icon' | 'defaultModel' | 'visibility' | 'isDefault'>>
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.slug !== undefined) { sets.push('slug = ?'); params.push(updates.slug); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description || null); }
  if (updates.icon !== undefined) { sets.push('icon = ?'); params.push(updates.icon || null); }
  if (updates.defaultModel !== undefined) { sets.push('default_model = ?'); params.push(updates.defaultModel || null); }
  if (updates.visibility !== undefined) { sets.push('visibility = ?'); params.push(updates.visibility); }
  if (updates.isDefault !== undefined) {
    if (updates.isDefault) {
      await db.prepare("UPDATE agent_personas SET is_default = 0 WHERE org_id = 'default' AND is_default = 1").run();
    }
    sets.push('is_default = ?');
    params.push(updates.isDefault ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE agent_personas SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

export async function deletePersona(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM agent_personas WHERE id = ?').bind(id).run();
}

function mapPersona(row: any): AgentPersona {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    icon: row.icon || undefined,
    defaultModel: row.default_model || undefined,
    visibility: row.visibility as PersonaVisibility,
    isDefault: !!row.is_default,
    createdBy: row.created_by,
    creatorName: row.creator_name || undefined,
    fileCount: row.file_count ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPersonaFile(row: any): AgentPersonaFile {
  return {
    id: row.id,
    personaId: row.persona_id,
    filename: row.filename,
    content: row.content,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Persona File Operations ────────────────────────────────────────────

export async function upsertPersonaFile(
  db: D1Database,
  data: { id: string; personaId: string; filename: string; content: string; sortOrder?: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_persona_files (id, persona_id, filename, content, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(persona_id, filename) DO UPDATE SET
         content = excluded.content,
         sort_order = excluded.sort_order,
         updated_at = datetime('now')`
    )
    .bind(data.id, data.personaId, data.filename, data.content, data.sortOrder ?? 0)
    .run();
}

export async function deletePersonaFile(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM agent_persona_files WHERE id = ?').bind(id).run();
}

// ─── Repo-Persona Default Operations ────────────────────────────────────

export async function setRepoPersonaDefault(db: D1Database, orgRepoId: string, personaId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO org_repo_persona_defaults (id, org_repo_id, persona_id)
       VALUES (?, ?, ?)
       ON CONFLICT(org_repo_id) DO UPDATE SET persona_id = excluded.persona_id`
    )
    .bind(id, orgRepoId, personaId)
    .run();
}

export async function getRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT persona_id FROM org_repo_persona_defaults WHERE org_repo_id = ?')
    .bind(orgRepoId)
    .first<{ persona_id: string }>();
  return row?.persona_id || null;
}

export async function deleteRepoPersonaDefault(db: D1Database, orgRepoId: string): Promise<void> {
  await db.prepare('DELETE FROM org_repo_persona_defaults WHERE org_repo_id = ?').bind(orgRepoId).run();
}

// ─── Orchestrator Identity Operations ────────────────────────────────────

export async function getOrchestratorIdentity(db: D1Database, userId: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const row = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE user_id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first();
  return row ? mapOrchestratorIdentity(row) : null;
}

export async function getOrchestratorIdentityByHandle(db: D1Database, handle: string, orgId: string = 'default'): Promise<OrchestratorIdentity | null> {
  const row = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE handle = ? AND org_id = ?')
    .bind(handle, orgId)
    .first();
  return row ? mapOrchestratorIdentity(row) : null;
}

export async function createOrchestratorIdentity(
  db: D1Database,
  data: { id: string; userId: string; name: string; handle: string; avatar?: string; customInstructions?: string; orgId?: string }
): Promise<OrchestratorIdentity> {
  const orgId = data.orgId || 'default';
  await db
    .prepare(
      'INSERT INTO orchestrator_identities (id, user_id, org_id, type, name, handle, avatar, custom_instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, orgId, 'personal', data.name, data.handle, data.avatar || null, data.customInstructions || null)
    .run();

  return {
    id: data.id,
    userId: data.userId,
    orgId,
    type: 'personal',
    name: data.name,
    handle: data.handle,
    avatar: data.avatar,
    customInstructions: data.customInstructions,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateOrchestratorIdentity(
  db: D1Database,
  id: string,
  updates: Partial<Pick<OrchestratorIdentity, 'name' | 'handle' | 'avatar' | 'customInstructions'>>
): Promise<void> {
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.handle !== undefined) { sets.push('handle = ?'); params.push(updates.handle); }
  if (updates.avatar !== undefined) { sets.push('avatar = ?'); params.push(updates.avatar || null); }
  if (updates.customInstructions !== undefined) { sets.push('custom_instructions = ?'); params.push(updates.customInstructions || null); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE orchestrator_identities SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
}

function mapOrchestratorIdentity(row: any): OrchestratorIdentity {
  return {
    id: row.id,
    userId: row.user_id || undefined,
    orgId: row.org_id,
    type: row.type as OrchestratorIdentity['type'],
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.custom_instructions || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Orchestrator Memory Operations ─────────────────────────────────────

const MEMORY_CAP = 200;

export async function listOrchestratorMemories(
  db: D1Database,
  userId: string,
  options: { category?: string; query?: string; limit?: number } = {}
): Promise<OrchestratorMemory[]> {
  const limit = options.limit || 50;

  if (options.query) {
    // Use FTS5 full-text search with BM25 ranking
    // Tokenize query words and join with OR for broad matching
    const ftsQuery = options.query
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w}"`)
      .join(' OR ');

    if (!ftsQuery) {
      // Query was all punctuation — fall through to non-FTS path
      return listOrchestratorMemoriesPlain(db, userId, options.category, limit);
    }

    let query = `
      SELECT m.* FROM orchestrator_memories m
      JOIN orchestrator_memories_fts fts ON fts.rowid = m.rowid
      WHERE orchestrator_memories_fts MATCH ? AND m.user_id = ?`;
    const params: (string | number)[] = [ftsQuery, userId];

    if (options.category) {
      query += ' AND m.category = ?';
      params.push(options.category);
    }

    query += ' ORDER BY bm25(orchestrator_memories_fts) LIMIT ?';
    params.push(limit);

    const result = await db.prepare(query).bind(...params).all();
    return (result.results || []).map(mapOrchestratorMemory);
  }

  return listOrchestratorMemoriesPlain(db, userId, options.category, limit);
}

function listOrchestratorMemoriesPlain(
  db: D1Database,
  userId: string,
  category?: string,
  limit: number = 50,
): Promise<OrchestratorMemory[]> {
  let query = 'SELECT * FROM orchestrator_memories WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY relevance DESC, last_accessed_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).bind(...params).all().then((r) => (r.results || []).map(mapOrchestratorMemory));
}

export async function createOrchestratorMemory(
  db: D1Database,
  data: { id: string; userId: string; category: OrchestratorMemoryCategory; content: string; relevance?: number }
): Promise<OrchestratorMemory> {
  await db
    .prepare(
      'INSERT INTO orchestrator_memories (id, user_id, category, content, relevance) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(data.id, data.userId, data.category, data.content, data.relevance ?? 1.0)
    .run();

  // Sync FTS index — get the rowid of the just-inserted row
  const inserted = await db
    .prepare('SELECT rowid FROM orchestrator_memories WHERE id = ?')
    .bind(data.id)
    .first<{ rowid: number }>();
  if (inserted) {
    await db
      .prepare('INSERT INTO orchestrator_memories_fts(rowid, category, content) VALUES (?, ?, ?)')
      .bind(inserted.rowid, data.category, data.content)
      .run();
  }

  // Prune if over cap: delete lowest-relevance entries
  const countResult = await db
    .prepare('SELECT COUNT(*) as cnt FROM orchestrator_memories WHERE user_id = ?')
    .bind(data.userId)
    .first<{ cnt: number }>();

  if (countResult && countResult.cnt > MEMORY_CAP) {
    const excess = countResult.cnt - MEMORY_CAP;
    // Get rowids before deleting so we can clean up FTS
    const toDelete = await db
      .prepare(
        `SELECT rowid FROM orchestrator_memories WHERE id IN (
          SELECT id FROM orchestrator_memories WHERE user_id = ?
          ORDER BY relevance ASC, last_accessed_at ASC LIMIT ?
        )`
      )
      .bind(data.userId, excess)
      .all<{ rowid: number }>();

    await db
      .prepare(
        `DELETE FROM orchestrator_memories WHERE id IN (
          SELECT id FROM orchestrator_memories WHERE user_id = ?
          ORDER BY relevance ASC, last_accessed_at ASC LIMIT ?
        )`
      )
      .bind(data.userId, excess)
      .run();

    // Clean up FTS rows
    for (const row of toDelete.results || []) {
      await db
        .prepare('DELETE FROM orchestrator_memories_fts WHERE rowid = ?')
        .bind(row.rowid)
        .run();
    }
  }

  return {
    id: data.id,
    userId: data.userId,
    orgId: 'default',
    category: data.category,
    content: data.content,
    relevance: data.relevance ?? 1.0,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };
}

export async function deleteOrchestratorMemory(db: D1Database, id: string, userId: string): Promise<boolean> {
  // Get rowid before deleting so we can clean up FTS
  const row = await db
    .prepare('SELECT rowid FROM orchestrator_memories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ rowid: number }>();

  const result = await db
    .prepare('DELETE FROM orchestrator_memories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();

  // Clean up FTS index
  if (row && (result.meta?.changes ?? 0) > 0) {
    await db
      .prepare('DELETE FROM orchestrator_memories_fts WHERE rowid = ?')
      .bind(row.rowid)
      .run();
  }

  return (result.meta?.changes ?? 0) > 0;
}

export async function boostMemoryRelevance(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE orchestrator_memories SET relevance = MIN(relevance + 0.1, 2.0), last_accessed_at = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .run();
}

function mapOrchestratorMemory(row: any): OrchestratorMemory {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    category: row.category as OrchestratorMemoryCategory,
    content: row.content,
    relevance: row.relevance ?? 1.0,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
  };
}

// ─── Orchestrator Session Helpers ───────────────────────────────────────

export async function getOrchestratorSession(db: D1Database, userId: string): Promise<AgentSession | null> {
  const sessionId = `orchestrator:${userId}`;
  return getSession(db, sessionId);
}

// Mapping helpers
function mapSessionGitState(row: any): SessionGitState {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type || null,
    sourcePrNumber: row.source_pr_number ?? null,
    sourceIssueNumber: row.source_issue_number ?? null,
    sourceRepoFullName: row.source_repo_full_name || null,
    sourceRepoUrl: row.source_repo_url || null,
    branch: row.branch || null,
    ref: row.ref || null,
    baseBranch: row.base_branch || null,
    commitCount: row.commit_count ?? 0,
    prNumber: row.pr_number ?? null,
    prTitle: row.pr_title || null,
    prState: row.pr_state || null,
    prUrl: row.pr_url || null,
    prCreatedAt: row.pr_created_at || null,
    prMergedAt: row.pr_merged_at || null,
    agentAuthored: !!row.agent_authored,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrgSettings(row: any): OrgSettings {
  return {
    id: row.id,
    name: row.name,
    allowedEmailDomain: row.allowed_email_domain || undefined,
    allowedEmails: row.allowed_emails || undefined,
    domainGatingEnabled: !!row.domain_gating_enabled,
    emailAllowlistEnabled: !!row.email_allowlist_enabled,
    defaultSessionVisibility: row.default_session_visibility || 'private',
    modelPreferences: row.model_preferences ? JSON.parse(row.model_preferences) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapInvite(row: any): Invite {
  return {
    id: row.id,
    code: row.code,
    email: row.email || undefined,
    role: row.role,
    invitedBy: row.invited_by,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : undefined,
    acceptedBy: row.accepted_by || undefined,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

function mapSession(row: any): AgentSession {
  return {
    id: row.id,
    userId: row.user_id,
    workspace: row.workspace,
    status: row.status,
    title: row.title || undefined,
    parentSessionId: row.parent_session_id || undefined,
    containerId: row.container_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    errorMessage: row.error_message || undefined,
    personaId: row.persona_id || undefined,
    personaName: row.persona_name || undefined,
    isOrchestrator: !!row.is_orchestrator || undefined,
    purpose: row.purpose || 'interactive',
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  };
}

function mapIntegration(row: any): Integration {
  return {
    id: row.id,
    userId: row.user_id,
    service: row.service,
    config: JSON.parse(row.config),
    status: row.status,
    scope: row.scope || 'user',
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    parts: row.parts ? JSON.parse(row.parts) : undefined,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    authorId: row.author_id || undefined,
    authorEmail: row.author_email || undefined,
    authorName: row.author_name || undefined,
    authorAvatarUrl: row.author_avatar_url || undefined,
    channelType: row.channel_type || undefined,
    channelId: row.channel_id || undefined,
    opencodeSessionId: row.opencode_session_id || undefined,
    createdAt: new Date(row.created_at),
  };
}

function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name || undefined,
    avatarUrl: row.avatar_url || undefined,
    githubUsername: row.github_username || undefined,
    gitName: row.git_name || undefined,
    gitEmail: row.git_email || undefined,
    onboardingCompleted: !!row.onboarding_completed,
    idleTimeoutSeconds: row.idle_timeout_seconds ?? 900,
    modelPreferences: row.model_preferences ? JSON.parse(row.model_preferences) : undefined,
    role: row.role || 'member',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapSyncLog(row: any): SyncStatusResponse {
  return {
    id: row.id,
    integrationId: row.integration_id,
    status: row.status,
    progress: row.records_synced,
    result: row.completed_at
      ? {
          success: row.status === 'completed',
          recordsSynced: row.records_synced || 0,
          errors: row.errors ? JSON.parse(row.errors) : [],
          completedAt: new Date(row.completed_at),
        }
      : undefined,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

// ─── Phase C: Mailbox Helpers ────────────────────────────────────────────────

function mapMailboxMessage(row: any): MailboxMessage {
  return {
    id: row.id,
    fromSessionId: row.from_session_id || undefined,
    fromUserId: row.from_user_id || undefined,
    toSessionId: row.to_session_id || undefined,
    toUserId: row.to_user_id || undefined,
    messageType: row.message_type,
    content: row.content,
    contextSessionId: row.context_session_id || undefined,
    contextTaskId: row.context_task_id || undefined,
    replyToId: row.reply_to_id || undefined,
    read: !!row.read,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fromSessionTitle: row.from_session_title || undefined,
    fromUserName: row.from_user_name || undefined,
    fromUserEmail: row.from_user_email || undefined,
    toSessionTitle: row.to_session_title || undefined,
    toUserName: row.to_user_name || undefined,
    replyCount: row.reply_count !== undefined ? Number(row.reply_count) : undefined,
    lastActivityAt: row.last_activity_at || undefined,
  };
}

export async function createMailboxMessage(
  db: D1Database,
  data: {
    fromSessionId?: string;
    fromUserId?: string;
    toSessionId?: string;
    toUserId?: string;
    messageType?: string;
    content: string;
    contextSessionId?: string;
    contextTaskId?: string;
    replyToId?: string;
  },
): Promise<MailboxMessage> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mailbox_messages (id, from_session_id, from_user_id, to_session_id, to_user_id, message_type, content, context_session_id, context_task_id, reply_to_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.fromSessionId || null,
      data.fromUserId || null,
      data.toSessionId || null,
      data.toUserId || null,
      data.messageType || 'message',
      data.content,
      data.contextSessionId || null,
      data.contextTaskId || null,
      data.replyToId || null,
      now,
      now,
    )
    .run();
  return {
    id,
    fromSessionId: data.fromSessionId,
    fromUserId: data.fromUserId,
    toSessionId: data.toSessionId,
    toUserId: data.toUserId,
    messageType: (data.messageType as MailboxMessage['messageType']) || 'message',
    content: data.content,
    contextSessionId: data.contextSessionId,
    contextTaskId: data.contextTaskId,
    replyToId: data.replyToId,
    read: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSessionMailbox(
  db: D1Database,
  sessionId: string,
  opts?: { unreadOnly?: boolean; limit?: number; after?: string },
): Promise<MailboxMessage[]> {
  const conditions = ['m.to_session_id = ?'];
  const params: (string | number)[] = [sessionId];

  if (opts?.unreadOnly) {
    conditions.push('m.read = 0');
  }
  if (opts?.after) {
    conditions.push('m.created_at > ?');
    params.push(opts.after);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT m.*,
              fs.title AS from_session_title,
              fu.name AS from_user_name,
              fu.email AS from_user_email
       FROM mailbox_messages m
       LEFT JOIN sessions fs ON m.from_session_id = fs.id
       LEFT JOIN users fu ON m.from_user_id = fu.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();

  return (result.results || []).map(mapMailboxMessage);
}

export async function getUserInbox(
  db: D1Database,
  userId: string,
  opts?: { unreadOnly?: boolean; messageType?: string; limit?: number; cursor?: string },
): Promise<{ messages: MailboxMessage[]; cursor?: string; hasMore: boolean }> {
  // Subquery param comes first in bind order (it's in the FROM clause)
  const subqueryParams: (string | number)[] = [userId];
  const conditions = ['m.to_user_id = ?', 'm.reply_to_id IS NULL'];
  const whereParams: (string | number)[] = [userId];

  if (opts?.unreadOnly) {
    // Thread has any unread message to user (root or replies)
    conditions.push(
      `(m.read = 0 OR EXISTS (SELECT 1 FROM mailbox_messages r WHERE r.reply_to_id = m.id AND r.to_user_id = ? AND r.read = 0))`,
    );
    whereParams.push(userId);
  }
  if (opts?.messageType) {
    conditions.push('m.message_type = ?');
    whereParams.push(opts.messageType);
  }
  if (opts?.cursor) {
    conditions.push('COALESCE(ts.last_activity_at, m.created_at) < ?');
    whereParams.push(opts.cursor);
  }

  const limit = (opts?.limit ?? 50) + 1;
  whereParams.push(limit);

  const result = await db
    .prepare(
      `SELECT m.*,
              fs.title AS from_session_title,
              fu.name AS from_user_name,
              fu.email AS from_user_email,
              COALESCE(ts.reply_count, 0) AS reply_count,
              COALESCE(ts.last_activity_at, m.created_at) AS last_activity_at
       FROM mailbox_messages m
       LEFT JOIN sessions fs ON m.from_session_id = fs.id
       LEFT JOIN users fu ON m.from_user_id = fu.id
       LEFT JOIN (
         SELECT reply_to_id,
                COUNT(*) AS reply_count,
                MAX(created_at) AS last_activity_at
         FROM mailbox_messages
         WHERE reply_to_id IS NOT NULL AND to_user_id = ?
         GROUP BY reply_to_id
       ) ts ON ts.reply_to_id = m.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(ts.last_activity_at, m.created_at) DESC
       LIMIT ?`,
    )
    .bind(...subqueryParams, ...whereParams)
    .all();

  const rows = result.results || [];
  const hasMore = rows.length === limit;
  const items = hasMore ? rows.slice(0, -1) : rows;
  const messages = items.map(mapMailboxMessage);
  const cursor =
    hasMore && messages.length > 0 ? messages[messages.length - 1].lastActivityAt || messages[messages.length - 1].createdAt : undefined;

  return { messages, cursor, hasMore };
}

export async function getUserInboxCount(db: D1Database, userId: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM mailbox_messages WHERE to_user_id = ? AND read = 0')
    .bind(userId)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function markSessionMailboxRead(db: D1Database, sessionId: string): Promise<number> {
  const result = await db
    .prepare("UPDATE mailbox_messages SET read = 1, updated_at = datetime('now') WHERE to_session_id = ? AND read = 0")
    .bind(sessionId)
    .run();
  return result.meta.changes ?? 0;
}

export async function markInboxMessageRead(db: D1Database, messageId: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE mailbox_messages SET read = 1, updated_at = datetime('now') WHERE id = ? AND to_user_id = ?")
    .bind(messageId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getMailboxMessage(db: D1Database, messageId: string): Promise<MailboxMessage | null> {
  const row = await db
    .prepare(
      `SELECT m.*,
              fs.title AS from_session_title,
              fu.name AS from_user_name,
              fu.email AS from_user_email,
              ts.title AS to_session_title,
              tu.name AS to_user_name
       FROM mailbox_messages m
       LEFT JOIN sessions fs ON m.from_session_id = fs.id
       LEFT JOIN users fu ON m.from_user_id = fu.id
       LEFT JOIN sessions ts ON m.to_session_id = ts.id
       LEFT JOIN users tu ON m.to_user_id = tu.id
       WHERE m.id = ?`,
    )
    .bind(messageId)
    .first();
  return row ? mapMailboxMessage(row) : null;
}

export async function getInboxThread(
  db: D1Database,
  threadId: string,
  userId: string,
): Promise<{ rootMessage: MailboxMessage | null; replies: MailboxMessage[] }> {
  const result = await db
    .prepare(
      `SELECT m.*,
              fs.title AS from_session_title,
              fu.name AS from_user_name,
              fu.email AS from_user_email,
              ts.title AS to_session_title,
              tu.name AS to_user_name
       FROM mailbox_messages m
       LEFT JOIN sessions fs ON m.from_session_id = fs.id
       LEFT JOIN users fu ON m.from_user_id = fu.id
       LEFT JOIN sessions ts ON m.to_session_id = ts.id
       LEFT JOIN users tu ON m.to_user_id = tu.id
       WHERE m.id = ? OR m.reply_to_id = ?
       ORDER BY m.created_at ASC`,
    )
    .bind(threadId, threadId)
    .all();

  const messages = (result.results || []).map(mapMailboxMessage);
  const rootMessage = messages.find((m) => m.id === threadId && !m.replyToId) || null;

  // Security: user must be participant
  if (rootMessage && rootMessage.toUserId !== userId && rootMessage.fromUserId !== userId) {
    return { rootMessage: null, replies: [] };
  }

  const replies = messages.filter((m) => m.id !== threadId);
  return { rootMessage, replies };
}

export async function markInboxThreadRead(
  db: D1Database,
  threadId: string,
  userId: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE mailbox_messages SET read = 1, updated_at = datetime('now')
       WHERE to_user_id = ? AND read = 0 AND (id = ? OR reply_to_id = ?)`,
    )
    .bind(userId, threadId, threadId)
    .run();
  return result.meta.changes ?? 0;
}

// ─── Phase C: Session Task Helpers ───────────────────────────────────────────

function mapSessionTask(row: any): SessionTask {
  return {
    id: row.id,
    orchestratorSessionId: row.orchestrator_session_id,
    sessionId: row.session_id || undefined,
    title: row.title,
    description: row.description || undefined,
    status: row.status,
    result: row.result || undefined,
    parentTaskId: row.parent_task_id || undefined,
    blockedBy: row.blocked_by_ids ? row.blocked_by_ids.split(',').filter(Boolean) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionTitle: row.session_title || undefined,
  };
}

export async function createSessionTask(
  db: D1Database,
  data: {
    orchestratorSessionId: string;
    sessionId?: string;
    title: string;
    description?: string;
    status?: string;
    parentTaskId?: string;
    blockedBy?: string[];
  },
): Promise<SessionTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = data.blockedBy?.length ? 'blocked' : (data.status || 'pending');

  await db
    .prepare(
      `INSERT INTO session_tasks (id, orchestrator_session_id, session_id, title, description, status, parent_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, data.orchestratorSessionId, data.sessionId || null, data.title, data.description || null, status, data.parentTaskId || null, now, now)
    .run();

  if (data.blockedBy?.length) {
    for (const blockedById of data.blockedBy) {
      await db
        .prepare('INSERT INTO session_task_dependencies (task_id, blocked_by_task_id) VALUES (?, ?)')
        .bind(id, blockedById)
        .run();
    }
  }

  return {
    id,
    orchestratorSessionId: data.orchestratorSessionId,
    sessionId: data.sessionId,
    title: data.title,
    description: data.description,
    status: status as SessionTask['status'],
    parentTaskId: data.parentTaskId,
    blockedBy: data.blockedBy,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSessionTasks(
  db: D1Database,
  orchestratorSessionId: string,
  opts?: { status?: string; limit?: number },
): Promise<SessionTask[]> {
  const conditions = ['t.orchestrator_session_id = ?'];
  const params: (string | number)[] = [orchestratorSessionId];

  if (opts?.status) {
    conditions.push('t.status = ?');
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 100;
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT t.*,
              s.title AS session_title,
              GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN sessions s ON t.session_id = s.id
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();

  return (result.results || []).map(mapSessionTask);
}

export async function getMyTasks(
  db: D1Database,
  sessionId: string,
  opts?: { status?: string; limit?: number },
): Promise<SessionTask[]> {
  const conditions = ['t.session_id = ?'];
  const params: (string | number)[] = [sessionId];

  if (opts?.status) {
    conditions.push('t.status = ?');
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 100;
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT t.*,
              GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();

  return (result.results || []).map(mapSessionTask);
}

export async function updateSessionTask(
  db: D1Database,
  taskId: string,
  updates: { status?: string; result?: string; description?: string; sessionId?: string; title?: string },
): Promise<SessionTask | null> {
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: (string | null)[] = [];

  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.result !== undefined) {
    setClauses.push('result = ?');
    params.push(updates.result);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }
  if (updates.sessionId !== undefined) {
    setClauses.push('session_id = ?');
    params.push(updates.sessionId);
  }
  if (updates.title !== undefined) {
    setClauses.push('title = ?');
    params.push(updates.title);
  }

  params.push(taskId);

  await db
    .prepare(`UPDATE session_tasks SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  const row = await db
    .prepare(
      `SELECT t.*, GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE t.id = ?
       GROUP BY t.id`,
    )
    .bind(taskId)
    .first();

  return row ? mapSessionTask(row) : null;
}

export async function addTaskDependency(db: D1Database, taskId: string, blockedByTaskId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO session_task_dependencies (task_id, blocked_by_task_id) VALUES (?, ?)')
    .bind(taskId, blockedByTaskId)
    .run();
  // Auto-set status to blocked
  await db
    .prepare("UPDATE session_tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(taskId)
    .run();
}

export async function getTaskDependencies(db: D1Database, taskId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT blocked_by_task_id FROM session_task_dependencies WHERE task_id = ?')
    .bind(taskId)
    .all<{ blocked_by_task_id: string }>();
  return (result.results || []).map((r) => r.blocked_by_task_id);
}

// ─── Phase C: Notification Preferences Helpers ───────────────────────────────

function mapNotificationPreference(row: any): UserNotificationPreference {
  return {
    id: row.id,
    userId: row.user_id,
    messageType: row.message_type,
    webEnabled: !!row.web_enabled,
    slackEnabled: !!row.slack_enabled,
    emailEnabled: !!row.email_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getNotificationPreferences(
  db: D1Database,
  userId: string,
): Promise<UserNotificationPreference[]> {
  const result = await db
    .prepare('SELECT * FROM user_notification_preferences WHERE user_id = ? ORDER BY message_type')
    .bind(userId)
    .all();
  return (result.results || []).map(mapNotificationPreference);
}

export async function upsertNotificationPreference(
  db: D1Database,
  userId: string,
  messageType: string,
  prefs: { webEnabled?: boolean; slackEnabled?: boolean; emailEnabled?: boolean },
): Promise<UserNotificationPreference> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO user_notification_preferences (id, user_id, message_type, web_enabled, slack_enabled, email_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, message_type) DO UPDATE SET
         web_enabled = COALESCE(excluded.web_enabled, user_notification_preferences.web_enabled),
         slack_enabled = COALESCE(excluded.slack_enabled, user_notification_preferences.slack_enabled),
         email_enabled = COALESCE(excluded.email_enabled, user_notification_preferences.email_enabled),
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      userId,
      messageType,
      prefs.webEnabled !== undefined ? (prefs.webEnabled ? 1 : 0) : 1,
      prefs.slackEnabled !== undefined ? (prefs.slackEnabled ? 1 : 0) : 0,
      prefs.emailEnabled !== undefined ? (prefs.emailEnabled ? 1 : 0) : 0,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM user_notification_preferences WHERE user_id = ? AND message_type = ?')
    .bind(userId, messageType)
    .first();

  return mapNotificationPreference(row);
}

// ─── Phase C: Org Directory Helper ───────────────────────────────────────────

export async function getOrgAgents(db: D1Database, orgId: string): Promise<OrchestratorIdentity[]> {
  const result = await db
    .prepare('SELECT * FROM orchestrator_identities WHERE org_id = ? ORDER BY name')
    .bind(orgId)
    .all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id || undefined,
    orgId: row.org_id,
    type: row.type,
    name: row.name,
    handle: row.handle,
    avatar: row.avatar || undefined,
    customInstructions: row.custom_instructions || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ─── Phase D: Channel System Helpers ─────────────────────────────────────────

// Identity Links

function mapIdentityLink(row: any): UserIdentityLink {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalId: row.external_id,
    externalName: row.external_name || undefined,
    teamId: row.team_id || undefined,
    createdAt: row.created_at,
  };
}

export async function createIdentityLink(
  db: D1Database,
  data: { id: string; userId: string; provider: string; externalId: string; externalName?: string; teamId?: string },
): Promise<UserIdentityLink> {
  await db
    .prepare(
      'INSERT INTO user_identity_links (id, user_id, provider, external_id, external_name, team_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(data.id, data.userId, data.provider, data.externalId, data.externalName || null, data.teamId || null)
    .run();

  return {
    id: data.id,
    userId: data.userId,
    provider: data.provider,
    externalId: data.externalId,
    externalName: data.externalName,
    teamId: data.teamId,
    createdAt: new Date().toISOString(),
  };
}

export async function getUserIdentityLinks(db: D1Database, userId: string): Promise<UserIdentityLink[]> {
  const result = await db
    .prepare('SELECT * FROM user_identity_links WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (result.results || []).map(mapIdentityLink);
}

export async function deleteIdentityLink(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM user_identity_links WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function resolveUserByExternalId(
  db: D1Database,
  provider: string,
  externalId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT user_id FROM user_identity_links WHERE provider = ? AND external_id = ?')
    .bind(provider, externalId)
    .first<{ user_id: string }>();
  return row?.user_id || null;
}

// Channel Bindings

function mapChannelBinding(row: any): ChannelBinding {
  return {
    id: row.id,
    sessionId: row.session_id,
    channelType: row.channel_type as ChannelType,
    channelId: row.channel_id,
    scopeKey: row.scope_key,
    userId: row.user_id || undefined,
    orgId: row.org_id,
    queueMode: row.queue_mode as QueueMode,
    collectDebounceMs: row.collect_debounce_ms ?? 3000,
    slackChannelId: row.slack_channel_id || undefined,
    slackThreadTs: row.slack_thread_ts || undefined,
    githubRepoFullName: row.github_repo_full_name || undefined,
    githubPrNumber: row.github_pr_number ?? undefined,
    createdAt: row.created_at,
  };
}

export async function createChannelBinding(
  db: D1Database,
  data: {
    id: string;
    sessionId: string;
    channelType: ChannelType;
    channelId: string;
    scopeKey: string;
    userId?: string;
    orgId: string;
    queueMode?: QueueMode;
    collectDebounceMs?: number;
    slackChannelId?: string;
    slackThreadTs?: string;
    githubRepoFullName?: string;
    githubPrNumber?: number;
  },
): Promise<ChannelBinding> {
  const queueMode = data.queueMode || 'followup';
  const collectDebounceMs = data.collectDebounceMs ?? 3000;

  await db
    .prepare(
      `INSERT INTO channel_bindings (id, session_id, channel_type, channel_id, scope_key, user_id, org_id, queue_mode, collect_debounce_ms, slack_channel_id, slack_thread_ts, github_repo_full_name, github_pr_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.sessionId,
      data.channelType,
      data.channelId,
      data.scopeKey,
      data.userId || null,
      data.orgId,
      queueMode,
      collectDebounceMs,
      data.slackChannelId || null,
      data.slackThreadTs || null,
      data.githubRepoFullName || null,
      data.githubPrNumber ?? null,
    )
    .run();

  return {
    id: data.id,
    sessionId: data.sessionId,
    channelType: data.channelType,
    channelId: data.channelId,
    scopeKey: data.scopeKey,
    userId: data.userId,
    orgId: data.orgId,
    queueMode,
    collectDebounceMs,
    slackChannelId: data.slackChannelId,
    slackThreadTs: data.slackThreadTs,
    githubRepoFullName: data.githubRepoFullName,
    githubPrNumber: data.githubPrNumber,
    createdAt: new Date().toISOString(),
  };
}

export async function getChannelBindingByScopeKey(db: D1Database, scopeKey: string): Promise<ChannelBinding | null> {
  const row = await db
    .prepare('SELECT * FROM channel_bindings WHERE scope_key = ?')
    .bind(scopeKey)
    .first();
  return row ? mapChannelBinding(row) : null;
}

export async function getSessionChannelBindings(db: D1Database, sessionId: string): Promise<ChannelBinding[]> {
  const result = await db
    .prepare('SELECT * FROM channel_bindings WHERE session_id = ? ORDER BY created_at DESC')
    .bind(sessionId)
    .all();
  return (result.results || []).map(mapChannelBinding);
}

export async function deleteChannelBinding(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM channel_bindings WHERE id = ?').bind(id).run();
}

export async function updateChannelBindingQueueMode(
  db: D1Database,
  id: string,
  queueMode: QueueMode,
  collectDebounceMs?: number,
): Promise<void> {
  if (collectDebounceMs !== undefined) {
    await db
      .prepare('UPDATE channel_bindings SET queue_mode = ?, collect_debounce_ms = ? WHERE id = ?')
      .bind(queueMode, collectDebounceMs, id)
      .run();
  } else {
    await db
      .prepare('UPDATE channel_bindings SET queue_mode = ? WHERE id = ?')
      .bind(queueMode, id)
      .run();
  }
}

// ─── Telegram Config Helpers ─────────────────────────────────────────────────

function mapTelegramConfig(row: any): UserTelegramConfig {
  return {
    id: row.id,
    userId: row.user_id,
    botUsername: row.bot_username,
    botInfo: row.bot_info,
    webhookActive: !!row.webhook_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserTelegramConfig(
  db: D1Database,
  userId: string,
): Promise<UserTelegramConfig | null> {
  const row = await db
    .prepare('SELECT * FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .first();
  return row ? mapTelegramConfig(row) : null;
}

export async function getUserTelegramToken(
  db: D1Database,
  userId: string,
  encryptionKey: string,
): Promise<{ config: UserTelegramConfig; botToken: string } | null> {
  const row = await db
    .prepare('SELECT * FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .first<any>();
  if (!row) return null;
  const botToken = await decryptString(row.bot_token_encrypted, encryptionKey);
  return { config: mapTelegramConfig(row), botToken };
}

export async function saveUserTelegramConfig(
  db: D1Database,
  data: {
    id: string;
    userId: string;
    botToken: string;
    botUsername: string;
    botInfo: string;
    encryptionKey: string;
  },
): Promise<UserTelegramConfig> {
  const encrypted = await encryptString(data.botToken, data.encryptionKey);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO user_telegram_config (id, user_id, bot_token_encrypted, bot_username, bot_info, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         bot_token_encrypted = excluded.bot_token_encrypted,
         bot_username = excluded.bot_username,
         bot_info = excluded.bot_info,
         updated_at = excluded.updated_at`,
    )
    .bind(data.id, data.userId, encrypted, data.botUsername, data.botInfo, now, now)
    .run();

  return {
    id: data.id,
    userId: data.userId,
    botUsername: data.botUsername,
    botInfo: data.botInfo,
    webhookActive: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTelegramWebhookStatus(
  db: D1Database,
  userId: string,
  webhookUrl: string,
  active: boolean,
): Promise<void> {
  await db
    .prepare(
      'UPDATE user_telegram_config SET webhook_url = ?, webhook_active = ?, updated_at = datetime(\'now\') WHERE user_id = ?',
    )
    .bind(webhookUrl, active ? 1 : 0, userId)
    .run();
}

export async function deleteUserTelegramConfig(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM user_telegram_config WHERE user_id = ?')
    .bind(userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
