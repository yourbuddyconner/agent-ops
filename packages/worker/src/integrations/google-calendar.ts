import type { SyncResult } from '@agent-ops/shared';
import { BaseIntegration, type SyncOptions, type IntegrationCredentials, integrationRegistry } from './base.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

// Calendar API types
interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  primary?: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  backgroundColor?: string;
  foregroundColor?: string;
}

interface GoogleEvent {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string;
  summary?: string;
  description?: string;
  location?: string;
  creator?: { email: string; displayName?: string };
  organizer?: { email: string; displayName?: string };
  start: EventDateTime;
  end: EventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  attendees?: EventAttendee[];
  conferenceData?: ConferenceData;
  reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
  created: string;
  updated: string;
}

interface EventDateTime {
  date?: string; // For all-day events (YYYY-MM-DD)
  dateTime?: string; // For timed events (RFC3339)
  timeZone?: string;
}

interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
}

interface ConferenceData {
  conferenceId?: string;
  conferenceSolution?: { name: string; iconUri: string };
  entryPoints?: Array<{
    entryPointType: 'video' | 'phone' | 'sip' | 'more';
    uri: string;
    label?: string;
  }>;
}

// Simplified event types for easier use
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  timeZone?: string;
  attendees: Array<{
    email: string;
    name?: string;
    status: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    isOrganizer: boolean;
  }>;
  organizer?: { email: string; name?: string };
  meetingLink?: string;
  recurrence?: string[];
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEventOptions {
  calendarId?: string; // defaults to 'primary'
  title: string;
  description?: string;
  location?: string;
  start: Date | string;
  end: Date | string;
  isAllDay?: boolean;
  timeZone?: string;
  attendees?: Array<{ email: string; optional?: boolean }>;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  conferenceData?: {
    createRequest?: { requestId: string };
  };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
  recurrence?: string[]; // RRULE format
}

export interface UpdateEventOptions extends Partial<CreateEventOptions> {
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

export interface FreeBusyQuery {
  timeMin: Date;
  timeMax: Date;
  calendars?: string[];
}

export interface FreeBusyResult {
  calendar: string;
  busy: Array<{ start: Date; end: Date }>;
}

/**
 * Google Calendar integration for managing events and calendars.
 *
 * Supports:
 * - OAuth 2.0 authentication
 * - Listing calendars
 * - Creating, updating, deleting events
 * - Managing attendees and RSVPs
 * - Google Meet integration
 * - Free/busy queries
 * - Recurring events
 */
export class GoogleCalendarIntegration extends BaseIntegration {
  readonly service = 'google_calendar' as const;
  readonly supportedEntities = ['calendars', 'events'];

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
      const res = await this.calendarFetch('/users/me/calendarList?maxResults=1');
      return res.ok;
    } catch {
      return false;
    }
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    if (!this.validateCredentials()) {
      return this.failedResult([this.syncError('auth', 'Invalid credentials', 'INVALID_CREDENTIALS')]);
    }

    const entities = options.entities || ['calendars', 'events'];
    let totalSynced = 0;
    const errors: SyncResult['errors'] = [];

    if (entities.includes('calendars')) {
      const result = await this.syncCalendars();
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    if (entities.includes('events')) {
      const result = await this.syncEvents(options);
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

  private async syncCalendars(): Promise<SyncResult> {
    try {
      const calendars = await this.listCalendars();
      return this.successResult(calendars.length);
    } catch (error) {
      return this.failedResult([
        this.syncError('calendars', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  private async syncEvents(options: SyncOptions): Promise<SyncResult> {
    try {
      const now = new Date();
      const events = await this.listEvents({
        calendarId: 'primary',
        timeMin: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        timeMax: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90 days ahead
        maxResults: 100,
      });
      return this.successResult(events.length);
    } catch (error) {
      return this.failedResult([
        this.syncError('events', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  // ============ Calendar Methods ============

  /**
   * List all calendars the user has access to
   */
  async listCalendars(): Promise<GoogleCalendar[]> {
    const calendars: GoogleCalendar[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ maxResults: '250' });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await this.calendarFetch(`/users/me/calendarList?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to list calendars: ${res.status}`);
      }

      const data = await res.json<{
        items: GoogleCalendar[];
        nextPageToken?: string;
      }>();

      calendars.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return calendars;
  }

  /**
   * Get a specific calendar
   */
  async getCalendar(calendarId: string = 'primary'): Promise<GoogleCalendar> {
    const res = await this.calendarFetch(`/calendars/${encodeURIComponent(calendarId)}`);
    if (!res.ok) {
      throw new Error(`Failed to get calendar: ${res.status}`);
    }
    return res.json();
  }

  // ============ Event Methods ============

  /**
   * List events from a calendar
   */
  async listEvents(options: {
    calendarId?: string;
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
    pageToken?: string;
    query?: string;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
  } = {}): Promise<CalendarEvent[]> {
    const calendarId = options.calendarId || 'primary';
    const params = new URLSearchParams({
      maxResults: String(options.maxResults || 50),
      singleEvents: String(options.singleEvents !== false),
      orderBy: options.orderBy || 'startTime',
    });

    if (options.timeMin) params.set('timeMin', options.timeMin.toISOString());
    if (options.timeMax) params.set('timeMax', options.timeMax.toISOString());
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.query) params.set('q', options.query);

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );

    if (!res.ok) {
      throw new Error(`Failed to list events: ${res.status}`);
    }

    const data = await res.json<{ items: GoogleEvent[] }>();
    return (data.items || []).map(e => this.parseEvent(e, calendarId));
  }

  /**
   * Get a specific event
   */
  async getEvent(eventId: string, calendarId: string = 'primary'): Promise<CalendarEvent> {
    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );

    if (!res.ok) {
      throw new Error(`Failed to get event: ${res.status}`);
    }

    const event = await res.json<GoogleEvent>();
    return this.parseEvent(event, calendarId);
  }

  /**
   * Create a new event
   */
  async createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
    const calendarId = options.calendarId || 'primary';
    const params = new URLSearchParams();

    if (options.sendUpdates) params.set('sendUpdates', options.sendUpdates);
    if (options.conferenceData) params.set('conferenceDataVersion', '1');

    const body = this.buildEventBody(options);

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create event: ${res.status} - ${error}`);
    }

    const event = await res.json<GoogleEvent>();
    return this.parseEvent(event, calendarId);
  }

  /**
   * Update an existing event
   */
  async updateEvent(
    eventId: string,
    options: UpdateEventOptions,
    calendarId: string = 'primary'
  ): Promise<CalendarEvent> {
    const params = new URLSearchParams();
    if (options.sendUpdates) params.set('sendUpdates', options.sendUpdates);

    // Get existing event first
    const existing = await this.getEvent(eventId, calendarId);
    const body = this.buildEventBody({
      title: options.title ?? existing.title,
      description: options.description ?? existing.description,
      location: options.location ?? existing.location,
      start: options.start ?? existing.start,
      end: options.end ?? existing.end,
      isAllDay: options.isAllDay ?? existing.isAllDay,
      timeZone: options.timeZone ?? existing.timeZone,
      attendees: options.attendees ?? existing.attendees.map(a => ({ email: a.email })),
      recurrence: options.recurrence ?? existing.recurrence,
    });

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to update event: ${res.status}`);
    }

    const event = await res.json<GoogleEvent>();
    return this.parseEvent(event, calendarId);
  }

  /**
   * Delete an event
   */
  async deleteEvent(
    eventId: string,
    calendarId: string = 'primary',
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'all'
  ): Promise<void> {
    const params = new URLSearchParams({ sendUpdates });

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
      { method: 'DELETE' }
    );

    if (!res.ok && res.status !== 410) {
      throw new Error(`Failed to delete event: ${res.status}`);
    }
  }

  /**
   * Quick add event using natural language
   */
  async quickAddEvent(text: string, calendarId: string = 'primary'): Promise<CalendarEvent> {
    const params = new URLSearchParams({ text });

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?${params}`,
      { method: 'POST' }
    );

    if (!res.ok) {
      throw new Error(`Failed to quick add event: ${res.status}`);
    }

    const event = await res.json<GoogleEvent>();
    return this.parseEvent(event, calendarId);
  }

  /**
   * Respond to an event invitation
   */
  async respondToEvent(
    eventId: string,
    response: 'accepted' | 'declined' | 'tentative',
    calendarId: string = 'primary'
  ): Promise<void> {
    // Get event and update own attendance status
    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );

    if (!res.ok) {
      throw new Error(`Failed to get event: ${res.status}`);
    }

    const event = await res.json<GoogleEvent>();
    const attendees = event.attendees?.map(a => {
      if (a.self) {
        return { ...a, responseStatus: response };
      }
      return a;
    });

    await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ attendees }),
      }
    );
  }

  /**
   * Query free/busy information
   */
  async queryFreeBusy(query: FreeBusyQuery): Promise<FreeBusyResult[]> {
    const res = await this.calendarFetch('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: query.timeMin.toISOString(),
        timeMax: query.timeMax.toISOString(),
        items: (query.calendars || ['primary']).map(id => ({ id })),
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to query free/busy: ${res.status}`);
    }

    const data = await res.json<{
      calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
    }>();

    return Object.entries(data.calendars || {}).map(([calendar, info]) => ({
      calendar,
      busy: (info.busy || []).map(b => ({
        start: new Date(b.start),
        end: new Date(b.end),
      })),
    }));
  }

  /**
   * Find available time slots
   */
  async findAvailableSlots(options: {
    duration: number; // minutes
    timeMin: Date;
    timeMax: Date;
    calendars?: string[];
  }): Promise<Array<{ start: Date; end: Date }>> {
    const freeBusy = await this.queryFreeBusy({
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      calendars: options.calendars,
    });

    // Merge all busy periods
    const allBusy = freeBusy.flatMap(fb => fb.busy).sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find gaps
    const slots: Array<{ start: Date; end: Date }> = [];
    let current = options.timeMin;
    const durationMs = options.duration * 60 * 1000;

    for (const busy of allBusy) {
      if (busy.start.getTime() - current.getTime() >= durationMs) {
        slots.push({ start: current, end: busy.start });
      }
      if (busy.end > current) {
        current = busy.end;
      }
    }

    // Check remaining time
    if (options.timeMax.getTime() - current.getTime() >= durationMs) {
      slots.push({ start: current, end: options.timeMax });
    }

    return slots;
  }

  // ============ Entity methods for BaseIntegration ============

  async fetchEntity(entityType: string, id: string): Promise<unknown> {
    switch (entityType) {
      case 'calendar':
        return this.getCalendar(id);
      case 'event':
        return this.getEvent(id);
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async pushEntity(entityType: string, data: unknown): Promise<string> {
    switch (entityType) {
      case 'event': {
        const event = await this.createEvent(data as CreateEventOptions);
        return event.id;
      }
      default:
        throw new Error(`Cannot push entity type: ${entityType}`);
    }
  }

  async handleWebhook(event: string, payload: unknown): Promise<void> {
    // Google Calendar uses push notifications via webhooks
    console.log(`Google Calendar webhook: ${event}`, payload);
  }

  // ============ OAuth Methods ============

  getOAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.credentials.client_id || '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
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
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      token_type: data.token_type,
    };
  }

  // ============ Private Helpers ============

  private async calendarFetch(path: string, options?: RequestInit): Promise<Response> {
    // Check if token needs refresh
    if (this.credentials.expires_at) {
      const expiresAt = new Date(this.credentials.expires_at);
      if (expiresAt < new Date(Date.now() + 60000) && this.refreshToken) {
        const newCreds = await this.refreshOAuthTokens(this.refreshToken);
        this.setCredentials({ ...this.credentials, ...newCreds });
      }
    }

    return fetch(`${CALENDAR_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  private parseEvent(event: GoogleEvent, calendarId: string): CalendarEvent {
    const isAllDay = !!event.start.date;
    let start: Date;
    let end: Date;

    if (isAllDay) {
      start = new Date(event.start.date!);
      end = new Date(event.end.date!);
    } else {
      start = new Date(event.start.dateTime!);
      end = new Date(event.end.dateTime!);
    }

    const meetingLink = event.conferenceData?.entryPoints?.find(
      e => e.entryPointType === 'video'
    )?.uri;

    return {
      id: event.id,
      calendarId,
      title: event.summary || '(No title)',
      description: event.description,
      location: event.location,
      start,
      end,
      isAllDay,
      timeZone: event.start.timeZone || event.end.timeZone,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName,
        status: a.responseStatus,
        isOrganizer: a.organizer || false,
      })),
      organizer: event.organizer ? {
        email: event.organizer.email,
        name: event.organizer.displayName,
      } : undefined,
      meetingLink,
      recurrence: event.recurrence,
      status: event.status,
      htmlLink: event.htmlLink,
      createdAt: new Date(event.created),
      updatedAt: new Date(event.updated),
    };
  }

  private buildEventBody(options: CreateEventOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      summary: options.title,
    };

    if (options.description) body.description = options.description;
    if (options.location) body.location = options.location;

    // Handle start/end times
    const formatDateTime = (dt: Date | string, isAllDay: boolean): EventDateTime => {
      const date = dt instanceof Date ? dt : new Date(dt);
      if (isAllDay) {
        return { date: date.toISOString().split('T')[0] };
      }
      return {
        dateTime: date.toISOString(),
        timeZone: options.timeZone || 'UTC',
      };
    };

    body.start = formatDateTime(options.start, options.isAllDay || false);
    body.end = formatDateTime(options.end, options.isAllDay || false);

    if (options.attendees?.length) {
      body.attendees = options.attendees.map(a => ({
        email: a.email,
        optional: a.optional || false,
      }));
    }

    if (options.conferenceData) {
      body.conferenceData = options.conferenceData;
    }

    if (options.reminders) {
      body.reminders = options.reminders;
    }

    if (options.recurrence) {
      body.recurrence = options.recurrence;
    }

    return body;
  }
}

// Register the integration
integrationRegistry.register('google_calendar', () => new GoogleCalendarIntegration());
