import type { SyncResult } from '@agent-ops/shared';
import { BaseIntegration, type SyncOptions, type IntegrationCredentials, integrationRegistry } from './base.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

// Gmail API response types
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload?: GmailMessagePayload;
  sizeEstimate: number;
  raw?: string;
}

interface GmailMessagePayload {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers: Array<{ name: string; value: string }>;
  body: { attachmentId?: string; size: number; data?: string };
  parts?: GmailMessagePayload[];
}

interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
}

interface GmailDraft {
  id: string;
  message: GmailMessage;
}

// Parsed email type for easier consumption
export interface ParsedEmail {
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
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
  isUnread: boolean;
  isStarred: boolean;
}

export interface SendEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  replyTo?: string;
  threadId?: string; // For replies
  attachments?: Array<{
    filename: string;
    mimeType: string;
    data: string; // base64 encoded
  }>;
}

/**
 * Gmail integration for sending and receiving emails.
 *
 * Supports:
 * - OAuth 2.0 authentication with Google
 * - Reading emails and threads
 * - Sending emails (including replies)
 * - Managing labels
 * - Drafts
 * - Attachments
 */
export class GmailIntegration extends BaseIntegration {
  readonly service = 'gmail' as const;
  readonly supportedEntities = ['messages', 'threads', 'labels', 'drafts'];

  private get accessToken(): string {
    return this.credentials.access_token || '';
  }

  private get refreshToken(): string {
    return this.credentials.refresh_token || '';
  }

  validateCredentials(): boolean {
    return !!(this.accessToken || this.refreshToken);
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.gmailFetch('/users/me/profile');
      return res.ok;
    } catch {
      return false;
    }
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    if (!this.validateCredentials()) {
      return this.failedResult([this.syncError('auth', 'Invalid credentials', 'INVALID_CREDENTIALS')]);
    }

    const entities = options.entities || ['messages'];
    let totalSynced = 0;
    const errors: SyncResult['errors'] = [];

    if (entities.includes('messages')) {
      const result = await this.syncMessages(options);
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    if (entities.includes('labels')) {
      const result = await this.syncLabels();
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    return {
      success: errors.length === 0,
      recordsSynced: totalSynced,
      errors,
      completedAt: new Date(),
    };
  }

  private async syncMessages(options: SyncOptions): Promise<SyncResult> {
    try {
      const messages: ParsedEmail[] = [];
      let pageToken: string | undefined;
      const maxResults = 50;

      // Fetch message list
      const params = new URLSearchParams({
        maxResults: String(maxResults),
        includeSpamTrash: 'false',
      });

      if (options.cursor) {
        params.set('pageToken', options.cursor);
      }

      const listRes = await this.gmailFetch(`/users/me/messages?${params}`);
      if (!listRes.ok) {
        return this.failedResult([
          this.syncError('messages', `Failed to list messages: ${listRes.status}`, 'FETCH_FAILED'),
        ]);
      }

      const listData = await listRes.json<{
        messages?: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
      }>();

      if (!listData.messages) {
        return this.successResult(0);
      }

      // Fetch full message details (batch for efficiency)
      for (const msg of listData.messages.slice(0, 20)) {
        const fullMsg = await this.getMessage(msg.id);
        if (fullMsg) {
          messages.push(fullMsg);
        }
      }

      return {
        success: true,
        recordsSynced: messages.length,
        errors: [],
        nextCursor: listData.nextPageToken,
        completedAt: new Date(),
      };
    } catch (error) {
      return this.failedResult([
        this.syncError('messages', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  private async syncLabels(): Promise<SyncResult> {
    try {
      const res = await this.gmailFetch('/users/me/labels');
      if (!res.ok) {
        return this.failedResult([
          this.syncError('labels', `Failed to fetch labels: ${res.status}`, 'FETCH_FAILED'),
        ]);
      }

      const data = await res.json<{ labels: GmailLabel[] }>();
      return this.successResult(data.labels?.length || 0);
    } catch (error) {
      return this.failedResult([
        this.syncError('labels', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  // ============ Public Email Methods ============

  /**
   * Get a single email by ID
   */
  async getMessage(id: string): Promise<ParsedEmail | null> {
    const res = await this.gmailFetch(`/users/me/messages/${id}?format=full`);
    if (!res.ok) return null;

    const message = await res.json<GmailMessage>();
    return this.parseMessage(message);
  }

  /**
   * List emails with optional query
   */
  async listMessages(options: {
    query?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  } = {}): Promise<{ messages: ParsedEmail[]; nextPageToken?: string }> {
    const params = new URLSearchParams({
      maxResults: String(options.maxResults || 20),
    });

    if (options.query) params.set('q', options.query);
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.labelIds?.length) {
      options.labelIds.forEach(id => params.append('labelIds', id));
    }

    const res = await this.gmailFetch(`/users/me/messages?${params}`);
    if (!res.ok) {
      throw new Error(`Failed to list messages: ${res.status}`);
    }

    const data = await res.json<{
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    }>();

    const messages: ParsedEmail[] = [];
    for (const msg of data.messages || []) {
      const full = await this.getMessage(msg.id);
      if (full) messages.push(full);
    }

    return { messages, nextPageToken: data.nextPageToken };
  }

  /**
   * Get a thread with all messages
   */
  async getThread(threadId: string): Promise<{ thread: GmailThread; messages: ParsedEmail[] } | null> {
    const res = await this.gmailFetch(`/users/me/threads/${threadId}?format=full`);
    if (!res.ok) return null;

    const thread = await res.json<GmailThread>();
    const messages = thread.messages.map(m => this.parseMessage(m));

    return { thread, messages };
  }

  /**
   * Send an email
   */
  async sendEmail(options: SendEmailOptions): Promise<{ id: string; threadId: string }> {
    const raw = this.buildRawEmail(options);

    const body: Record<string, unknown> = { raw };
    if (options.threadId) {
      body.threadId = options.threadId;
    }

    const res = await this.gmailFetch('/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to send email: ${res.status} - ${error}`);
    }

    const data = await res.json<{ id: string; threadId: string }>();
    return { id: data.id, threadId: data.threadId };
  }

  /**
   * Reply to an email
   */
  async replyToEmail(
    originalMessageId: string,
    options: Omit<SendEmailOptions, 'threadId'>
  ): Promise<{ id: string; threadId: string }> {
    const original = await this.getMessage(originalMessageId);
    if (!original) {
      throw new Error('Original message not found');
    }

    // Build reply with proper headers
    const replyOptions: SendEmailOptions = {
      ...options,
      threadId: original.threadId,
      subject: options.subject.startsWith('Re:') ? options.subject : `Re: ${original.subject}`,
    };

    return this.sendEmail(replyOptions);
  }

  /**
   * Create a draft
   */
  async createDraft(options: SendEmailOptions): Promise<{ id: string; message: ParsedEmail }> {
    const raw = this.buildRawEmail(options);

    const res = await this.gmailFetch('/users/me/drafts', {
      method: 'POST',
      body: JSON.stringify({
        message: { raw, threadId: options.threadId },
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create draft: ${res.status}`);
    }

    const data = await res.json<GmailDraft>();
    return {
      id: data.id,
      message: this.parseMessage(data.message),
    };
  }

  /**
   * Send a draft
   */
  async sendDraft(draftId: string): Promise<{ id: string; threadId: string }> {
    const res = await this.gmailFetch(`/users/me/drafts/send`, {
      method: 'POST',
      body: JSON.stringify({ id: draftId }),
    });

    if (!res.ok) {
      throw new Error(`Failed to send draft: ${res.status}`);
    }

    return res.json();
  }

  /**
   * Modify message labels (archive, star, mark read, etc.)
   */
  async modifyMessage(
    messageId: string,
    options: { addLabelIds?: string[]; removeLabelIds?: string[] }
  ): Promise<void> {
    const res = await this.gmailFetch(`/users/me/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      throw new Error(`Failed to modify message: ${res.status}`);
    }
  }

  /**
   * Mark as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, { removeLabelIds: ['UNREAD'] });
  }

  /**
   * Mark as unread
   */
  async markAsUnread(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, { addLabelIds: ['UNREAD'] });
  }

  /**
   * Archive a message (remove from inbox)
   */
  async archive(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, { removeLabelIds: ['INBOX'] });
  }

  /**
   * Star a message
   */
  async star(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, { addLabelIds: ['STARRED'] });
  }

  /**
   * Trash a message
   */
  async trash(messageId: string): Promise<void> {
    const res = await this.gmailFetch(`/users/me/messages/${messageId}/trash`, {
      method: 'POST',
    });

    if (!res.ok) {
      throw new Error(`Failed to trash message: ${res.status}`);
    }
  }

  /**
   * Get all labels
   */
  async getLabels(): Promise<GmailLabel[]> {
    const res = await this.gmailFetch('/users/me/labels');
    if (!res.ok) {
      throw new Error(`Failed to get labels: ${res.status}`);
    }

    const data = await res.json<{ labels: GmailLabel[] }>();
    return data.labels;
  }

  /**
   * Get attachment data
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    const res = await this.gmailFetch(
      `/users/me/messages/${messageId}/attachments/${attachmentId}`
    );

    if (!res.ok) {
      throw new Error(`Failed to get attachment: ${res.status}`);
    }

    const data = await res.json<{ data: string; size: number }>();
    return data.data; // base64url encoded
  }

  // ============ Entity methods for BaseIntegration ============

  async fetchEntity(entityType: string, id: string): Promise<unknown> {
    switch (entityType) {
      case 'message':
        return this.getMessage(id);
      case 'thread':
        return this.getThread(id);
      case 'label':
        const labels = await this.getLabels();
        return labels.find(l => l.id === id);
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async pushEntity(entityType: string, data: unknown): Promise<string> {
    switch (entityType) {
      case 'message': {
        const result = await this.sendEmail(data as SendEmailOptions);
        return result.id;
      }
      case 'draft': {
        const result = await this.createDraft(data as SendEmailOptions);
        return result.id;
      }
      default:
        throw new Error(`Cannot push entity type: ${entityType}`);
    }
  }

  async handleWebhook(event: string, payload: unknown): Promise<void> {
    // Gmail uses push notifications via Cloud Pub/Sub
    // This would handle the push notification data
    console.log(`Gmail webhook: ${event}`, payload);
  }

  // ============ OAuth Methods ============

  getOAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.credentials.client_id || '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent', // Force refresh token
      state,
    });

    return `${GOOGLE_AUTH}?${params}`;
  }

  async exchangeOAuthCode(code: string, redirectUri: string): Promise<IntegrationCredentials> {
    const res = await fetch(`${GOOGLE_OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.client_id || '',
        client_secret: this.credentials.client_secret || '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to exchange OAuth code: ${error}`);
    }

    const data = await res.json<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    }>();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      token_type: data.token_type,
      scope: data.scope,
    };
  }

  async refreshOAuthTokens(refreshToken: string): Promise<IntegrationCredentials> {
    const res = await fetch(`${GOOGLE_OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.client_id || '',
        client_secret: this.credentials.client_secret || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to refresh OAuth tokens');
    }

    const data = await res.json<{
      access_token: string;
      expires_in: number;
      token_type: string;
    }>();

    return {
      access_token: data.access_token,
      refresh_token: refreshToken, // Refresh token doesn't change
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      token_type: data.token_type,
    };
  }

  // ============ Private Helpers ============

  private async gmailFetch(path: string, options?: RequestInit): Promise<Response> {
    // Check if token needs refresh
    if (this.credentials.expires_at) {
      const expiresAt = new Date(this.credentials.expires_at);
      if (expiresAt < new Date(Date.now() + 60000) && this.refreshToken) {
        // Token expires in less than 1 minute, refresh it
        const newCreds = await this.refreshOAuthTokens(this.refreshToken);
        this.setCredentials({ ...this.credentials, ...newCreds });
      }
    }

    return fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  private parseMessage(message: GmailMessage): ParsedEmail {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    const parseAddresses = (value: string): string[] => {
      if (!value) return [];
      return value.split(',').map(a => a.trim()).filter(Boolean);
    };

    // Extract body from payload
    let body = '';
    let bodyHtml = '';
    const attachments: ParsedEmail['attachments'] = [];

    const extractParts = (payload: GmailMessagePayload | undefined) => {
      if (!payload) return;

      if (payload.mimeType === 'text/plain' && payload.body.data) {
        body = this.decodeBase64Url(payload.body.data);
      } else if (payload.mimeType === 'text/html' && payload.body.data) {
        bodyHtml = this.decodeBase64Url(payload.body.data);
      } else if (payload.filename && payload.body.attachmentId) {
        attachments.push({
          id: payload.body.attachmentId,
          filename: payload.filename,
          mimeType: payload.mimeType,
          size: payload.body.size,
        });
      }

      if (payload.parts) {
        payload.parts.forEach(extractParts);
      }
    };

    extractParts(message.payload);

    // Fallback to snippet if no body found
    if (!body && !bodyHtml) {
      body = message.snippet;
    }

    return {
      id: message.id,
      threadId: message.threadId,
      from: getHeader('from'),
      to: parseAddresses(getHeader('to')),
      cc: parseAddresses(getHeader('cc')),
      bcc: parseAddresses(getHeader('bcc')),
      subject: getHeader('subject'),
      body,
      bodyHtml: bodyHtml || undefined,
      snippet: message.snippet,
      labels: message.labelIds || [],
      date: new Date(parseInt(message.internalDate)),
      attachments,
      isUnread: message.labelIds?.includes('UNREAD') || false,
      isStarred: message.labelIds?.includes('STARRED') || false,
    };
  }

  private buildRawEmail(options: SendEmailOptions): string {
    const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
    const hasAttachments = options.attachments && options.attachments.length > 0;

    const lines: string[] = [
      `To: ${options.to.join(', ')}`,
      `Subject: ${options.subject}`,
      'MIME-Version: 1.0',
    ];

    if (options.cc?.length) {
      lines.push(`Cc: ${options.cc.join(', ')}`);
    }
    if (options.bcc?.length) {
      lines.push(`Bcc: ${options.bcc.join(', ')}`);
    }
    if (options.replyTo) {
      lines.push(`Reply-To: ${options.replyTo}`);
    }

    if (hasAttachments) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      lines.push('');
      lines.push(`--${boundary}`);
    }

    // Body part
    if (options.bodyHtml) {
      if (hasAttachments) {
        lines.push('Content-Type: multipart/alternative; boundary="alt_boundary"');
        lines.push('');
        lines.push('--alt_boundary');
      } else {
        lines.push('Content-Type: multipart/alternative; boundary="alt_boundary"');
        lines.push('');
        lines.push('--alt_boundary');
      }
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(options.body);
      lines.push('');
      lines.push('--alt_boundary');
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('');
      lines.push(options.bodyHtml);
      lines.push('');
      lines.push('--alt_boundary--');
    } else {
      if (hasAttachments) {
        lines.push('Content-Type: text/plain; charset=UTF-8');
      } else {
        lines.push('Content-Type: text/plain; charset=UTF-8');
      }
      lines.push('');
      lines.push(options.body);
    }

    // Attachments
    if (hasAttachments) {
      for (const attachment of options.attachments!) {
        lines.push('');
        lines.push(`--${boundary}`);
        lines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
        lines.push('');
        lines.push(attachment.data);
      }
      lines.push('');
      lines.push(`--${boundary}--`);
    }

    const rawEmail = lines.join('\r\n');
    return this.encodeBase64Url(rawEmail);
  }

  private decodeBase64Url(data: string): string {
    // Convert base64url to base64
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return atob(padded);
  }

  private encodeBase64Url(data: string): string {
    const base64 = btoa(unescape(encodeURIComponent(data)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}

// Register the integration
integrationRegistry.register('gmail', () => new GmailIntegration());
