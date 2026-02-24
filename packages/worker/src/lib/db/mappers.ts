/**
 * Internal mapper helpers, constants, and utilities shared across db service files.
 * NOT re-exported from the public db barrel — only consumed by sibling service modules.
 */

import type {
  AgentSession,
  Integration,
  Message,
  User,
  SyncStatusResponse,
  SessionGitState,
  OrgSettings,
  Invite,
  SessionShareLink,
  SessionParticipantRole,
  SessionParticipantSummary,
  OrgRepository,
  AgentPersona,
  AgentPersonaFile,
  PersonaVisibility,
  OrchestratorIdentity,
  OrchestratorMemory,
  OrchestratorMemoryCategory,
  MailboxMessage,
  SessionTask,
  UserNotificationPreference,
  UserIdentityLink,
  ChannelBinding,
  ChannelType,
  QueueMode,
  UserTelegramConfig,
} from '@agent-ops/shared';

// ─── Constants ──────────────────────────────────────────────────────────────

export const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  collaborator: 1,
  owner: 2,
};

export const ACTIVE_SESSION_STATUSES = ['initializing', 'running', 'idle', 'restoring'];
export const DEFAULT_MAX_ACTIVE_SESSIONS = 10;
export const MEMORY_CAP = 200;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeNotificationEventType(eventType?: string | null): string {
  const trimmed = eventType?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : '*';
}

// ─── Mapper Functions ───────────────────────────────────────────────────────

export function mapSession(row: any): AgentSession {
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

export function mapSessionWithOwner(
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

export function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name || undefined,
    avatarUrl: row.avatar_url || undefined,
    githubId: row.github_id || undefined,
    githubUsername: row.github_username || undefined,
    gitName: row.git_name || undefined,
    gitEmail: row.git_email || undefined,
    onboardingCompleted: !!row.onboarding_completed,
    idleTimeoutSeconds: row.idle_timeout_seconds ?? 900,
    modelPreferences: row.model_preferences ? JSON.parse(row.model_preferences) : undefined,
    uiQueueMode: row.ui_queue_mode || 'followup',
    role: row.role || 'member',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function mapIntegration(row: any): Integration {
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

export function mapMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    parts: row.parts ? JSON.parse(row.parts) : undefined,
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

export function mapSyncLog(row: any): SyncStatusResponse {
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

export function mapSessionGitState(row: any): SessionGitState {
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

export function mapOrgSettings(row: any): OrgSettings {
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

export function mapInvite(row: any): Invite {
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

export function mapShareLink(row: any): SessionShareLink {
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

export function mapOrgRepository(row: any): OrgRepository {
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

export function mapPersona(row: any): AgentPersona {
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

export function mapPersonaFile(row: any): AgentPersonaFile {
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

export function mapOrchestratorIdentity(row: any): OrchestratorIdentity {
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

export function mapOrchestratorMemory(row: any): OrchestratorMemory {
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

export function mapMailboxMessage(row: any): MailboxMessage {
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

export function mapSessionTask(row: any): SessionTask {
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

export function mapNotificationPreference(row: any): UserNotificationPreference {
  return {
    id: row.id,
    userId: row.user_id,
    messageType: row.message_type,
    eventType: row.event_type || '*',
    webEnabled: !!row.web_enabled,
    slackEnabled: !!row.slack_enabled,
    emailEnabled: !!row.email_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapIdentityLink(row: any): UserIdentityLink {
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

export function mapChannelBinding(row: any): ChannelBinding {
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

export function mapTelegramConfig(row: any): UserTelegramConfig {
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
