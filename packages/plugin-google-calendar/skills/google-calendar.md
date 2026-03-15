---
name: google-calendar
description: How to use Google Calendar tools effectively — managing events, checking availability, scheduling, and working with multiple calendars.
---

# Google Calendar

You have full access to Google Calendar through the `google-calendar` plugin.

## Available Tools

### Reading

- **`calendar.list_calendars`** — List all calendars the user has access to (with IDs, names, and access roles).
- **`calendar.get_calendar`** — Get details for a specific calendar.
- **`calendar.list_events`** — List events in a time range. Supports filtering by calendar, time bounds, search text, and single events expansion.
- **`calendar.get_event`** — Get full details of a specific event.

### Scheduling

- **`calendar.create_event`** — Create an event with title, times, attendees, location, description, and recurrence.
- **`calendar.update_event`** — Update any field of an existing event.
- **`calendar.delete_event`** — Delete an event.
- **`calendar.quick_add`** — Create an event from natural language (e.g., "Lunch with Alice tomorrow at noon").

### Availability

- **`calendar.respond_to_event`** — Accept, decline, or tentatively accept an event invitation.
- **`calendar.query_free_busy`** — Check busy/free status for one or more people over a time range.
- **`calendar.find_available_slots`** — Find open time slots when all specified attendees are available.

## Common Patterns

### Checking Today's Schedule

```
calendar.list_events({
  calendarId: "primary",
  timeMin: "2026-03-15T00:00:00Z",
  timeMax: "2026-03-16T00:00:00Z",
  singleEvents: true,
  orderBy: "startTime"
})
```

Always use `singleEvents: true` and `orderBy: "startTime"` when listing a day's events — this expands recurring events and sorts chronologically.

### Scheduling a Meeting

```
calendar.create_event({
  calendarId: "primary",
  summary: "Architecture Review",
  start: "2026-03-20T14:00:00-07:00",
  end: "2026-03-20T15:00:00-07:00",
  attendees: ["alice@example.com", "bob@example.com"],
  description: "Review the new API design",
  location: "Conference Room B"
})
```

### Finding a Time That Works

Use `find_available_slots` to find open times for a group:

```
calendar.find_available_slots({
  attendees: ["alice@example.com", "bob@example.com"],
  timeMin: "2026-03-17T09:00:00-07:00",
  timeMax: "2026-03-21T17:00:00-07:00",
  durationMinutes: 30,
  maxResults: 5
})
```

### Quick Event Creation

For simple events, `quick_add` parses natural language:

```
calendar.quick_add({
  calendarId: "primary",
  text: "Team standup every weekday at 9:30am"
})
```

### Recurring Events

Use RFC 5545 RRULE format for recurrence:

```
calendar.create_event({
  calendarId: "primary",
  summary: "Weekly Sync",
  start: "2026-03-16T10:00:00-07:00",
  end: "2026-03-16T10:30:00-07:00",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=12"]
})
```

Common RRULE patterns:
- `RRULE:FREQ=DAILY` — every day
- `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR` — Mon/Wed/Fri
- `RRULE:FREQ=MONTHLY;BYMONTHDAY=1` — first of each month
- `RRULE:FREQ=WEEKLY;COUNT=10` — weekly for 10 occurrences
- `RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z` — weekly until end of year

### All-Day Events

Use date strings (no time component) for all-day events:

```
calendar.create_event({
  calendarId: "primary",
  summary: "Company Holiday",
  start: "2026-03-20",
  end: "2026-03-21"
})
```

Note: the end date is exclusive — a single all-day event on March 20 uses `end: "2026-03-21"`.

## Tips

- **Calendar ID**: Use `"primary"` for the user's main calendar. Use `list_calendars` to discover other calendar IDs.
- **Timezones**: Always include timezone offsets in datetime strings (e.g., `-07:00`). The user's local timezone is preferred.
- **Single events**: When listing, set `singleEvents: true` to expand recurring events into individual instances. Without this, you get the recurring event template, not the individual occurrences.
- **Attendees**: Pass email addresses as strings. The API handles sending invitations.
- **Updates**: Only pass the fields you want to change to `update_event`. Omitted fields are preserved.
