# Google Calendar Plugin Port -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 11 calendar actions with 5 high-quality actions ported from the google-docs-mcp reference repo, dropping unused complexity while gaining Google Meet link creation.

**Architecture:** The existing `packages/plugin-google-calendar/` package is rewritten in place. The `api.ts` helper (`calendarFetch`) and `provider.ts` (OAuth config) are kept unchanged. Only `actions.ts` and the skill file are replaced. No new files, no new packages, no shared state with google-workspace.

**Tech Stack:** TypeScript, Cloudflare Workers, Google Calendar REST API v3, Zod, Vitest

**Spec:** `docs/specs/2026-04-23-google-calendar-port-design.md`

---

## Task 1: Rewrite Calendar Actions

**Files:**
- Rewrite: `packages/plugin-google-calendar/src/actions/actions.ts`
- Reference: `/tmp/google-docs-mcp/src/tools/calendar/` (all 5 tool files + `helpers.ts`)
- Keep unchanged: `packages/plugin-google-calendar/src/actions/api.ts`
- Keep unchanged: `packages/plugin-google-calendar/src/actions/provider.ts`
- Keep unchanged: `packages/plugin-google-calendar/src/actions/index.ts`

### Translation pattern

Each reference tool follows `server.addTool({ name, parameters, execute })`. The port translates to:
1. An `ActionDefinition` object with `id`, `name`, `description`, `riskLevel`, `params` (Zod schema)
2. A `case` in the `executeAction` switch statement
3. `getCalendarClient()` calls become `calendarFetch(path, token)` using the existing `api.ts` helper
4. `UserError` throws become `{ success: false, error: message }` returns
5. `response.data` from `googleapis` becomes `await res.json()` from raw fetch
6. Calendar API base URL: `https://www.googleapis.com/calendar/v3` (already configured in `api.ts`)

### Step-by-step

- [ ] **Step 1: Read reference files for full context**

Read all 5 reference tool files to understand exact param schemas and response shapes:
- `/tmp/google-docs-mcp/src/tools/calendar/listEvents.ts`
- `/tmp/google-docs-mcp/src/tools/calendar/createEvent.ts`
- `/tmp/google-docs-mcp/src/tools/calendar/updateEvent.ts`
- `/tmp/google-docs-mcp/src/tools/calendar/deleteEvent.ts`
- `/tmp/google-docs-mcp/src/tools/calendar/quickAddEvent.ts`
- `/tmp/google-docs-mcp/src/tools/calendar/helpers.ts` (defines `eventDateTimeSchema`)

Also read:
- `packages/plugin-google-calendar/src/actions/actions.ts` (current, to be replaced)
- `packages/plugin-google-calendar/src/actions/api.ts` (kept, understand the `calendarFetch` signature)

- [ ] **Step 2: Write new `actions.ts` with 5 action definitions**

Replace the entire contents of `packages/plugin-google-calendar/src/actions/actions.ts`. The new file has:

**Imports:**
```typescript
import { z } from 'zod';
import type { ActionDefinition, ActionSource, ActionContext, ActionResult } from '@valet/sdk';
import { calendarFetch } from './api.js';
```

**Helper -- `eventDateTimeSchema`** (ported from reference `helpers.ts`):
```typescript
const eventDateTimeSchema = z.object({
  dateTime: z.string().optional()
    .describe('RFC3339 timestamp with timezone offset, e.g. "2026-04-15T14:00:00-08:00". Use for timed events.'),
  date: z.string().optional()
    .describe('ISO date "YYYY-MM-DD" for all-day events. Use instead of dateTime.'),
  timeZone: z.string().optional()
    .describe('IANA timezone like "America/Los_Angeles". Optional when dateTime has an offset.'),
}).refine((v) => v.dateTime || v.date, {
  message: 'Provide either dateTime (timed event) or date (all-day event).',
});
```

Note: Zod `.refine()` works fine in `ActionDefinition.params` -- the SDK calls `.parse()` which runs refinements.

**5 Action Definitions:**

1. `calendar.list_events` -- risk: `low`

```typescript
const listEvents: ActionDefinition = {
  id: 'calendar.list_events',
  name: 'List Events',
  description: "Lists or searches Google Calendar events. Defaults to the user's primary calendar starting now. Use timeMin/timeMax (RFC3339 timestamps) to bound the window, q for free-text search, and maxResults to cap the count. Returns event IDs needed for update_event and delete_event.",
  riskLevel: 'low',
  params: z.object({
    calendarId: z.string().optional().default('primary')
      .describe('Calendar ID. Defaults to "primary" (the user\'s main calendar).'),
    q: z.string().optional()
      .describe('Free-text search across summary, description, location, and attendees.'),
    timeMin: z.string().optional()
      .describe('Lower bound (inclusive) as RFC3339 timestamp, e.g. "2026-04-10T00:00:00-08:00". Defaults to now.'),
    timeMax: z.string().optional()
      .describe('Upper bound (exclusive) as RFC3339 timestamp.'),
    maxResults: z.number().int().min(1).max(2500).optional().default(25)
      .describe('Maximum number of events to return (1-2500). Defaults to 25.'),
    singleEvents: z.boolean().optional().default(true)
      .describe('If true (default), expands recurring events into individual instances. Set false to receive recurring events as a single record.'),
  }),
};
```

2. `calendar.create_event` -- risk: `medium`

```typescript
const createEvent: ActionDefinition = {
  id: 'calendar.create_event',
  name: 'Create Event',
  description: 'Creates a new event on a Google Calendar. Supports timed events (start/end with dateTime) and all-day events (start/end with date). Set sendUpdates to email invitations to attendees.',
  riskLevel: 'medium',
  params: z.object({
    calendarId: z.string().optional().default('primary')
      .describe('Calendar ID. Defaults to "primary".'),
    summary: z.string().describe('Event title.'),
    description: z.string().optional().describe('Event description / notes.'),
    location: z.string().optional().describe('Physical address or location string.'),
    start: eventDateTimeSchema.describe('Event start. Provide dateTime or date.'),
    end: eventDateTimeSchema.describe('Event end. Provide dateTime or date. For all-day events, end.date is exclusive.'),
    attendees: z.array(z.object({
      email: z.string().describe('Attendee email address.'),
      optional: z.boolean().optional().describe('Mark attendee as optional.'),
    })).optional().describe('List of attendees to invite.'),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none')
      .describe('Whether to send email invitations: "all" sends to everyone, "externalOnly" only to non-domain attendees, "none" sends nothing (default).'),
    conferenceData: z.boolean().optional().default(false)
      .describe('If true, attaches an automatically generated Google Meet link to the event.'),
  }),
};
```

3. `calendar.update_event` -- risk: `medium`

```typescript
const updateEvent: ActionDefinition = {
  id: 'calendar.update_event',
  name: 'Update Event',
  description: 'Updates an existing Google Calendar event with PATCH semantics -- only the fields you provide are changed; everything else stays the same.',
  riskLevel: 'medium',
  params: z.object({
    calendarId: z.string().optional().default('primary')
      .describe('Calendar ID. Defaults to "primary".'),
    eventId: z.string().describe('The event ID to update (from list_events).'),
    summary: z.string().optional().describe('New event title.'),
    description: z.string().optional().describe('New event description.'),
    location: z.string().optional().describe('New location.'),
    start: eventDateTimeSchema.optional().describe('New start time.'),
    end: eventDateTimeSchema.optional().describe('New end time.'),
    attendees: z.array(z.object({
      email: z.string(),
      optional: z.boolean().optional(),
    })).optional().describe('Replaces the entire attendee list. To add one, fetch the event first.'),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none')
      .describe('Whether to email attendees about the change.'),
  }),
};
```

4. `calendar.delete_event` -- risk: `high`

```typescript
const deleteEvent: ActionDefinition = {
  id: 'calendar.delete_event',
  name: 'Delete Event',
  description: 'Deletes an event from a Google Calendar. This is permanent -- the event is removed, not trashed. Use sendUpdates to email cancellations to attendees.',
  riskLevel: 'high',
  params: z.object({
    calendarId: z.string().optional().default('primary')
      .describe('Calendar ID. Defaults to "primary".'),
    eventId: z.string().describe('The event ID to delete (from list_events).'),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none')
      .describe('Whether to email cancellation notices to attendees.'),
  }),
};
```

5. `calendar.quick_add` -- risk: `medium`

```typescript
const quickAdd: ActionDefinition = {
  id: 'calendar.quick_add',
  name: 'Quick Add Event',
  description: 'Creates a calendar event from a natural-language string using Google Calendar\'s quick-add parser. Examples: "Lunch with Sarah tomorrow at 12pm", "Dentist appointment next Tuesday 3-4pm". Faster than create_event when you don\'t need attendees or precise control.',
  riskLevel: 'medium',
  params: z.object({
    calendarId: z.string().optional().default('primary')
      .describe('Calendar ID. Defaults to "primary".'),
    text: z.string()
      .describe('Natural-language description of the event. Google parses the title and time from this string.'),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none')
      .describe('Whether to email invitations (rarely useful for quick add).'),
  }),
};
```

**Action array:**
```typescript
const allActions: ActionDefinition[] = [listEvents, createEvent, updateEvent, deleteEvent, quickAdd];
```

- [ ] **Step 3: Write the `executeAction` switch with 5 cases**

Port each reference tool's `execute` function. Key translation notes per action:

**`calendar.list_events`:**
- Default `timeMin` to `new Date().toISOString()` when not provided
- Build query string: `calendarId`, `q`, `timeMin`, `timeMax`, `maxResults`, `singleEvents`, and conditionally `orderBy: 'startTime'` when `singleEvents` is true
- API: `GET /calendars/{calendarId}/events?{qs}`
- Response: map `data.items` to extract `id`, `status`, `summary`, `description`, `location`, `start`, `end`, `attendees` (mapped to `{email, responseStatus, optional}`), `organizer`, `htmlLink`, `recurringEventId`
- Return: `{ success: true, data: { events, count, nextPageToken } }`
- Error handling: 404 = calendar not found, 403 = scope not granted

**`calendar.create_event`:**
- Build request body: `summary`, `description`, `location`, `start`, `end`, `attendees`
- If `conferenceData` is true, add `conferenceData.createRequest` with `requestId: crypto.randomUUID()` and `conferenceSolutionKey: { type: 'hangoutsMeet' }`
- API: `POST /calendars/{calendarId}/events?sendUpdates={sendUpdates}&conferenceDataVersion={0|1}`
- Note: `conferenceDataVersion=1` query param is required for Meet link creation
- Return: `{ success: true, data: { id, summary, start, end, htmlLink, hangoutLink, attendees: count } }`
- Error handling: 404 = calendar not found, 403 = scope, 400 = bad request (invalid RFC3339)

**`calendar.update_event`:**
- Build a partial request body from only the provided fields (check each `!== undefined`)
- If no fields provided, return `{ success: false, error: 'No fields provided to update.' }`
- API: `PATCH /calendars/{calendarId}/events/{eventId}?sendUpdates={sendUpdates}`
- Return: `{ success: true, data: { id, summary, start, end, htmlLink, updated } }`
- Error handling: 404 = event not found, 403 = scope, 400 = bad request

**`calendar.delete_event`:**
- API: `DELETE /calendars/{calendarId}/events/{eventId}?sendUpdates={sendUpdates}`
- Treat both 200/204 as success; also treat 410 (already deleted) as success
- Return: `{ success: true, data: { eventId, calendarId } }`
- Error handling: 404 = event not found, 403 = scope

**`calendar.quick_add`:**
- API: `POST /calendars/{calendarId}/events/quickAdd?text={text}&sendUpdates={sendUpdates}`
- Return: `{ success: true, data: { id, summary, start, end, htmlLink } }`
- Error handling: 404 = calendar not found, 403 = scope, 400 = unparseable text

**Export:**
```typescript
export const googleCalendarActions: ActionSource = {
  listActions: () => allActions,
  execute: executeAction,
};
```

- [ ] **Step 4: Verify the file compiles**

Run: `cd /Users/conner/code/valet && pnpm typecheck`

Fix any issues. Common problems:
- `eventDateTimeSchema` uses `.refine()` which produces `z.ZodEffects` not `z.ZodObject` -- this is fine for `ActionDefinition.params` since the SDK accepts `z.ZodType`
- `calendarFetch` returns `Response` -- JSON parsing is `await res.json()`
- No `googleapis` types -- all response types are inlined or use `as` casts

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-google-calendar/src/actions/actions.ts
git commit -m "feat(google-calendar): rewrite actions with 5 tools ported from reference repo"
```

---

## Task 2: Rewrite Calendar Skill

**Files:**
- Rewrite: `packages/plugin-google-calendar/skills/google-calendar.md`

- [ ] **Step 1: Read the current skill file**

Read: `packages/plugin-google-calendar/skills/google-calendar.md`

- [ ] **Step 2: Write the new skill file**

Replace the entire contents. The new skill documents exactly 5 tools, drops all references to removed tools (`list_calendars`, `get_calendar`, `get_event`, `respond_to_event`, `query_freebusy`, `find_available_slots`), and adds documentation for the new `conferenceData` param and `singleEvents` behavior.

Structure:
```
---
name: google-calendar
description: How to use Google Calendar tools -- listing events, creating/updating/deleting events, and quick-add from natural language.
---

# Google Calendar

## Available Tools (5 actions)

### Reading
- calendar.list_events -- params, usage notes, singleEvents behavior

### Creating & Modifying
- calendar.create_event -- params, dateTime vs date for all-day, conferenceData for Meet links
- calendar.update_event -- PATCH semantics, eventId from list_events
- calendar.delete_event -- permanent deletion, sendUpdates for cancellation notices
- calendar.quick_add -- natural language parsing examples

## Common Patterns
- Checking today's schedule (list_events with timeMin/timeMax, singleEvents: true)
- Scheduling a meeting with a Meet link (create_event with conferenceData: true)
- Quick event creation (quick_add examples)
- Rescheduling (update_event with new start/end)
- All-day events (date instead of dateTime, exclusive end date)
- Recurring events (RRULE format in description, or quick_add)

## Tips
- Calendar ID: use "primary" for main calendar
- Timezones: include offset in RFC3339 strings
- singleEvents: true expands recurring events
- Event IDs: get from list_events, use in update/delete
```

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-google-calendar/skills/google-calendar.md
git commit -m "docs(google-calendar): rewrite skill for 5-action tool set"
```

---

## Task 3: Regenerate Registries and Verify

**Files:**
- Modify (auto-generated): `packages/worker/src/integrations/packages.ts`
- Modify (auto-generated): `packages/worker/src/plugins/content-registry.ts`

- [ ] **Step 1: Regenerate registries**

Run: `make generate-registries`

This re-scans `packages/plugin-*/` and regenerates the content registry. The calendar plugin's skill content will be updated in the registry output.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`

This verifies:
- The new `actions.ts` compiles correctly
- The generated registries reference the correct exports
- No stale references to removed action IDs in other packages

- [ ] **Step 3: Verify no stale references to removed actions**

Search for any remaining references to the 6 dropped action IDs:

```
list_calendars, get_calendar, get_event, respond_to_event, query_freebusy, find_available_slots
```

These should only appear in git history, not in the current codebase.

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/integrations/packages.ts packages/worker/src/plugins/content-registry.ts
git commit -m "chore: regenerate registries after calendar port"
```

---

## Summary of Changes

| File | Action | What Changes |
|------|--------|--------------|
| `packages/plugin-google-calendar/src/actions/actions.ts` | Rewrite | 11 actions -> 5 actions, new descriptions, new param schemas, `conferenceData` support |
| `packages/plugin-google-calendar/skills/google-calendar.md` | Rewrite | Document 5 tools, drop 6 removed tools, add Meet link and singleEvents guidance |
| `packages/plugin-google-calendar/src/actions/api.ts` | Unchanged | `calendarFetch` helper stays as-is |
| `packages/plugin-google-calendar/src/actions/provider.ts` | Unchanged | OAuth scopes stay as-is |
| `packages/plugin-google-calendar/src/actions/index.ts` | Unchanged | Package export stays as-is |
| `packages/worker/src/plugins/content-registry.ts` | Regenerated | Updated skill content |
| `packages/worker/src/integrations/packages.ts` | Regenerated | No structural change (same package name) |

## Risk Assessment

| Action | Risk | Why |
|--------|------|-----|
| `list_events` | Low | Read-only, well-tested API |
| `create_event` | Medium | Creates calendar events; `conferenceData` is a new capability not previously tested |
| `update_event` | Medium | PATCH semantics -- reference uses Google API PATCH; current code does GET-merge-PUT. The port switches to native PATCH which is simpler but a behavior change |
| `delete_event` | High | Permanent deletion. Existing behavior preserved. |
| `quick_add` | Medium | Creates events from NL text; Google's parser may misinterpret ambiguous input |

## Key Behavior Changes from Current Implementation

1. **`update_event` no longer does GET-merge-PUT.** The reference uses `PATCH` directly, sending only changed fields. This is simpler and avoids race conditions from the read-modify-write cycle. The old code fetched the existing event, merged fields, then PUT the whole thing.

2. **No more `parseEvent` response transformation.** The current code transforms Google API responses into a custom `CalendarEvent` type. The port returns raw API response shapes for consistency with other ported plugins.

3. **`conferenceData` support is new.** The `create_event` action gains the ability to auto-create Google Meet links by setting `conferenceData: true`.

4. **6 actions are removed.** `list_calendars`, `get_calendar`, `get_event`, `respond_to_event`, `query_freebusy`, `find_available_slots` are dropped per the design spec. If scheduling workflows suffer, `list_calendars` and `query_freebusy` are the top candidates for re-addition.
