# Google Calendar Port Design

**Status:** Draft
**Author:** Conner Swann
**Date:** 2026-04-23
**Reference:** github.com/a-bonus/google-docs-mcp

## Summary

Replace the 11 current `calendar.*` actions in `packages/plugin-google-calendar/` with 5 actions ported from the google-docs-mcp reference implementation. The reference repo takes a minimalist approach: list, create, update, delete, and quick-add. Six current actions are dropped: `list_calendars`, `get_calendar`, `get_event`, `respond_to_event`, `query_freebusy`, and `find_available_slots`. The Calendar plugin is a standalone package (not part of google-workspace) and has no labels guard.

## Tools Being Adopted

| Action ID | Params (summary) | Description | Risk |
|-----------|------------------|-------------|------|
| `calendar.list_events` | `calendarId?`, `timeMin?`, `timeMax?`, `maxResults?`, `query?`, `singleEvents?` | List events from a calendar with optional time range and search | low |
| `calendar.create_event` | `calendarId?`, `title`, `start`, `end`, `description?`, `location?`, `attendees?`, `timeZone?`, `isAllDay?`, `recurrence?`, `sendUpdates?`, `conferenceData?` | Create a new calendar event | medium |
| `calendar.update_event` | `eventId`, `calendarId?`, `title?`, `start?`, `end?`, `description?`, `location?`, `attendees?`, `timeZone?`, `sendUpdates?` | Update an existing event (merge semantics: fetches existing, patches changed fields) | medium |
| `calendar.delete_event` | `eventId`, `calendarId?`, `sendUpdates?` | Delete a calendar event | high |
| `calendar.quick_add` | `text`, `calendarId?` | Create an event from natural language text (uses Google's quickAdd API) | medium |

## Tools Being Dropped

| Current Action ID | Reason | Regression? |
|-------------------|--------|-------------|
| `calendar.list_calendars` | Not in reference repo | **Yes** -- agents lose the ability to discover which calendars exist |
| `calendar.get_calendar` | Not in reference repo | **Yes** -- agents lose calendar metadata inspection |
| `calendar.get_event` | Not in reference repo; agents can use `list_events` with a narrow time range or known event ID | Mild -- `list_events` with query can find specific events |
| `calendar.respond_to_event` | Not in reference repo | **Yes** -- agents lose RSVP capability |
| `calendar.query_freebusy` | Not in reference repo | **Yes** -- agents lose free/busy queries |
| `calendar.find_available_slots` | Not in reference repo | **Yes** -- agents lose availability slot computation |

**Note:** The dropped tools represent real capability loss. The free/busy and available-slots tools are useful for scheduling workflows. Consider re-adding `list_calendars`, `respond_to_event`, and `query_freebusy` as a fast-follow if scheduling use cases suffer.

## Porting Translation

Same pattern as the Docs port (see `2026-04-23-google-workspace-docs-port-design.md`). Key differences specific to Calendar:

- **Calendar API base URL:** `https://www.googleapis.com/calendar/v3`
- **`update_event` uses merge semantics:** fetches the existing event first, merges provided fields over existing values, then PUTs the merged result. This matches our current implementation.
- **`create_event` builds the event body** from params with date/dateTime handling based on `isAllDay`. Same pattern as our current `buildEventBody` helper.
- **`conferenceData` support** in `create_event`: the reference repo supports `conferenceData.createRequest.requestId` for auto-creating Google Meet links. Our current implementation does not expose this; it is a new capability.
- **No `parseEvent` response transformation:** The reference repo returns raw Google API responses. Our current code transforms events into a `CalendarEvent` type. The port should keep returning raw API responses for simplicity, consistent with how other ported plugins work.

## Files Changed

### Create
- `packages/plugin-google-calendar/src/actions/actions.ts` (rewrite with 5 new actions)

### Modify
- `packages/plugin-google-calendar/src/actions/api.ts` (may simplify or keep as-is; just the `calendarFetch` wrapper)
- `packages/plugin-google-calendar/skills/google-calendar.md` (full rewrite)

### Delete
None -- the Calendar plugin is small. The actions file is rewritten in place.

## Skill Updates

`packages/plugin-google-calendar/skills/google-calendar.md` needs a full rewrite:

- Drop references to `list_calendars`, `get_calendar`, `get_event`, `respond_to_event`, `query_freebusy`, `find_available_slots`
- Document the 5 available tools with param guidance
- Document `quick_add` with natural language examples
- Document `create_event` with `conferenceData` for auto-creating Meet links
- Guidance for time zone handling (ISO 8601 date-time strings)

## Migration / Breaking Changes

6 of 11 current action IDs are removed. The remaining 5 keep the same IDs:
- `calendar.list_events` (same)
- `calendar.create_event` (same)
- `calendar.update_event` (same)
- `calendar.delete_event` (same)
- `calendar.quick_add` (same)

Removed IDs:
- `calendar.list_calendars`
- `calendar.get_calendar`
- `calendar.get_event`
- `calendar.respond_to_event`
- `calendar.query_freebusy`
- `calendar.find_available_slots`

No labels guard changes needed -- Calendar is a separate plugin outside google-workspace.

No D1 migration needed. Action IDs are synced at worker startup via content registry.
