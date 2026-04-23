---
name: google-calendar
description: How to use Google Calendar tools effectively — listing events, creating, updating, deleting, and quick-adding events.
---

# Google Calendar

You have access to Google Calendar through the `google-calendar` plugin.

## Available Tools

- **`calendar.list_events`** — List or search events on a calendar. Supports free-text search (`q`), time bounds (`timeMin`/`timeMax`), and expanding recurring events (`singleEvents`). Returns event IDs needed for `update_event` and `delete_event`.

- **`calendar.create_event`** — Create a new timed or all-day event. Supports attendees, location, description, and automatic Google Meet links (`conferenceData: true`).

- **`calendar.update_event`** — Patch an existing event. Only the fields you provide are changed; everything else stays the same. Attendees array fully replaces the existing list.

- **`calendar.delete_event`** — Permanently delete an event. Optionally email cancellation notices to attendees via `sendUpdates`.

- **`calendar.quick_add`** — Create an event from a natural-language string. Google's parser extracts the title and time automatically.

## Common Patterns

### Checking Today's Schedule

```
calendar.list_events({
  timeMin: "2026-04-21T00:00:00-07:00",
  timeMax: "2026-04-22T00:00:00-07:00"
})
```

`singleEvents` defaults to `true` and `orderBy` is set to `startTime` automatically when `singleEvents` is true — recurring events are expanded and sorted chronologically.

### Creating a Timed Event

```
calendar.create_event({
  summary: "Architecture Review",
  start: { dateTime: "2026-04-22T14:00:00-07:00" },
  end: { dateTime: "2026-04-22T15:00:00-07:00" },
  attendees: [{ email: "alice@example.com" }, { email: "bob@example.com" }],
  description: "Review the new API design",
  location: "Conference Room B",
  sendUpdates: "all"
})
```

### Creating an All-Day Event

```
calendar.create_event({
  summary: "Company Holiday",
  start: { date: "2026-04-25" },
  end: { date: "2026-04-26" }
})
```

The end date is exclusive — a single all-day event on April 25 uses `end.date: "2026-04-26"`.

### Adding a Google Meet Link

```
calendar.create_event({
  summary: "Remote Standup",
  start: { dateTime: "2026-04-22T09:00:00-07:00" },
  end: { dateTime: "2026-04-22T09:30:00-07:00" },
  conferenceData: true
})
```

### Rescheduling an Event

First get the event ID with `list_events`, then:

```
calendar.update_event({
  eventId: "abc123",
  start: { dateTime: "2026-04-23T15:00:00-07:00" },
  end: { dateTime: "2026-04-23T16:00:00-07:00" },
  sendUpdates: "all"
})
```

### Quick Event Creation

For simple events, `quick_add` parses natural language:

```
calendar.quick_add({ text: "Team standup every weekday at 9:30am" })
calendar.quick_add({ text: "Lunch with Alice tomorrow at noon" })
calendar.quick_add({ text: "Dentist appointment next Tuesday 3-4pm" })
```

### Deleting an Event

```
calendar.delete_event({
  eventId: "abc123",
  sendUpdates: "all"
})
```

## Tips

- **Calendar ID**: All actions default `calendarId` to `"primary"` (the user's main calendar). Pass a specific calendar ID if needed.
- **Timezones**: Include timezone offsets in `dateTime` strings (e.g., `-07:00`). Alternatively, pass a `timeZone` field with an IANA name like `"America/Los_Angeles"`.
- **Finding event IDs**: Use `list_events` first — each event in the response has an `id` field used by `update_event` and `delete_event`.
- **PATCH semantics**: `update_event` only sends the fields you provide. Omitting a field leaves it unchanged. Exception: `attendees` fully replaces the existing list.
- **sendUpdates**: Defaults to `"none"` for all mutation actions. Set to `"all"` to email attendees about changes or cancellations.
