// Integration types
export type IntegrationService =
  | 'github'
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'notion'
  | 'hubspot'
  | 'ashby'
  | 'discord'
  | 'xero';

export interface Integration {
  id: string;
  userId: string;
  service: IntegrationService;
  config: IntegrationConfig;
  status: 'active' | 'error' | 'pending' | 'disconnected';
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationConfig {
  syncFrequency: 'realtime' | 'hourly' | 'daily' | 'manual';
  entities: string[];
  filters?: Record<string, unknown>;
}

export interface SyncResult {
  success: boolean;
  recordsSynced: number;
  errors: SyncError[];
  nextCursor?: string;
  completedAt: Date;
}

export interface SyncError {
  entity: string;
  entityId?: string;
  message: string;
  code: string;
}

// Session types
export type SessionStatus = 'initializing' | 'running' | 'idle' | 'terminated' | 'error';

export interface AgentSession {
  id: string;
  userId: string;
  workspace: string;
  status: SessionStatus;
  containerId?: string;
  gatewayUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

// User types
export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

// API Request/Response types
export interface CreateSessionRequest {
  workspace: string;
  config?: {
    memory?: string;
    timeout?: number;
  };
}

export interface CreateSessionResponse {
  session: AgentSession;
  websocketUrl: string;
}

export interface SendMessageRequest {
  content: string;
  attachments?: Attachment[];
}

export interface Attachment {
  type: 'file' | 'url';
  name: string;
  data: string;
  mimeType?: string;
}

export interface ListSessionsResponse {
  sessions: AgentSession[];
  cursor?: string;
  hasMore: boolean;
}

export interface ConfigureIntegrationRequest {
  service: IntegrationService;
  credentials: Record<string, string>;
  config: IntegrationConfig;
}

export interface TriggerSyncRequest {
  entities?: string[];
  fullSync?: boolean;
}

export interface SyncStatusResponse {
  id: string;
  integrationId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  result?: SyncResult;
  startedAt: Date;
  completedAt?: Date;
}

// Container types
export type ContainerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type ContainerInstanceSize = 'dev' | 'basic' | 'standard';

export interface Container {
  id: string;
  userId: string;
  name: string;
  status: ContainerStatus;
  instanceSize: ContainerInstanceSize;
  region?: string;
  containerId?: string;
  ipAddress?: string;
  port: number;
  workspacePath?: string;
  autoSleepMinutes: number;
  lastActiveAt?: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContainerRequest {
  name: string;
  instanceSize?: ContainerInstanceSize;
  autoSleepMinutes?: number;
  workspacePath?: string;
}

export interface UpdateContainerRequest {
  name?: string;
  instanceSize?: ContainerInstanceSize;
  autoSleepMinutes?: number;
}

export interface ContainerActionResponse {
  container: Container;
  message: string;
}

export interface ListContainersResponse {
  containers: Container[];
}

export interface GetContainerResponse {
  container: Container;
}

// API key types
export interface StoredAPIKey {
  id: string;
  userId: string;
  service: IntegrationService;
  encryptedCredentials: string;
  scopes: string[];
  createdAt: Date;
  expiresAt?: Date;
}

// Webhook types
export interface WebhookPayload {
  service: IntegrationService;
  event: string;
  data: unknown;
  timestamp: Date;
}

// GitHub-specific types
export namespace GitHub {
  export interface Repository {
    id: number;
    name: string;
    fullName: string;
    private: boolean;
    description: string | null;
    url: string;
    defaultBranch: string;
  }

  export interface Issue {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    labels: string[];
    assignees: string[];
    createdAt: Date;
    updatedAt: Date;
  }

  export interface PullRequest {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed' | 'merged';
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    createdAt: Date;
    updatedAt: Date;
    mergedAt: Date | null;
  }

  export interface SyncConfig {
    repositories?: string[];
    syncIssues: boolean;
    syncPullRequests: boolean;
    syncCommits: boolean;
  }
}

// Gmail-specific types
export namespace Gmail {
  export interface Email {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    bodyHtml?: string;
    snippet: string;
    labels: string[];
    date: Date;
    attachments: Attachment[];
    isUnread: boolean;
    isStarred: boolean;
  }

  export interface Attachment {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }

  export interface SendEmailOptions {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyHtml?: string;
    replyTo?: string;
    threadId?: string;
    attachments?: Array<{
      filename: string;
      mimeType: string;
      data: string;
    }>;
  }

  export interface Label {
    id: string;
    name: string;
    type: 'system' | 'user';
  }

  export interface SyncConfig {
    syncMessages: boolean;
    syncLabels: boolean;
    labelFilter?: string[];
  }
}

// Google Calendar-specific types
export namespace GoogleCalendar {
  export interface Calendar {
    id: string;
    summary: string;
    description?: string;
    timeZone: string;
    primary?: boolean;
    accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  }

  export interface Event {
    id: string;
    calendarId: string;
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    timeZone?: string;
    attendees: Attendee[];
    organizer?: { email: string; name?: string };
    meetingLink?: string;
    recurrence?: string[];
    status: 'confirmed' | 'tentative' | 'cancelled';
    htmlLink: string;
  }

  export interface Attendee {
    email: string;
    name?: string;
    status: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    isOrganizer: boolean;
  }

  export interface CreateEventOptions {
    calendarId?: string;
    title: string;
    description?: string;
    location?: string;
    start: Date | string;
    end: Date | string;
    isAllDay?: boolean;
    timeZone?: string;
    attendees?: Array<{ email: string; optional?: boolean }>;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }

  export interface FreeBusySlot {
    start: Date;
    end: Date;
  }

  export interface SyncConfig {
    syncCalendars: boolean;
    syncEvents: boolean;
    calendarIds?: string[];
  }
}
