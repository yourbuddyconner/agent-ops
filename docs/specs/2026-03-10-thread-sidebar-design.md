# Thread Sidebar for Orchestrator UI

**Date:** 2026-03-10
**Status:** Approved

## Summary

Replace the channel selector dropdown in the orchestrator chat UI with a persistent, collapsible thread sidebar panel. Threads are grouped by their originating channel. Each thread can be dismissed (archived) via a hover-reveal X button. Dismissed threads auto-reactivate when new messages arrive from that channel.

## Motivation

The channel selector dropdown was a workaround — channels route *to* threads, making threads the primary organizational unit. The sidebar makes threads first-class navigation, visually groups them by channel origin, and adds the ability to dismiss threads the user is done with.

## Design

### Thread Sidebar Panel

- ~210px wide, left side of the orchestrator chat area
- **Collapsible** via a toggle button on the sidebar edge. Open by default. Collapse state persisted in localStorage.
- **Header:** "Threads" label + "+" new thread button
- **Body:** Active threads grouped under channel section headers (Web, Slack DM, Slack #engineering). Channel names resolved via the existing `GET /api/channels/label` endpoint. Sections are static visual grouping (not collapsible).
- **Thread items:** Thread title (or first message preview if untitled). Hover-reveal X button to dismiss. Unread badge (count) for threads with activity since last viewed.
- **Footer:** "Dismissed" row with count, expandable to show archived threads. Clicking a dismissed thread reactivates it and switches to it.

### Interactions

- **Select thread:** Click sets `activeThreadId`, messages filter to that thread.
- **Dismiss thread:** Hover X → PATCH thread status to `archived` → thread moves to dismissed section → if dismissed thread was active, select the next active thread.
- **Reactivate dismissed thread:** Click in dismissed section → PATCH status to `active` → moves back to active list → becomes selected thread.
- **Auto-reactivate:** When a channel message arrives for an archived thread, the backend flips status to `active`. Sidebar re-fetches and shows it in the active list.
- **New thread:** "+" button creates a new thread (existing `useCreateThread`), selects it.
- **Unread tracking:** Track "last viewed" per thread in localStorage (threadId → timestamp). Threads with messages newer than last-viewed show a badge.

### Component Structure

```
ChatContainer (orchestrator)
├── ThreadSidebar (new, ~210px left panel)
│   ├── ThreadSidebarHeader ("Threads" + "+" button)
│   ├── ThreadGroupList
│   │   ├── ThreadGroup (per channel)
│   │   │   ├── ThreadGroupHeader (channel icon + resolved label)
│   │   │   └── ThreadItem[] (title, unread badge, hover X)
│   │   └── ...more groups
│   └── DismissedSection (expandable, count badge)
│       └── ThreadItem[] (click to reactivate)
├── MessageArea (existing, flex:1)
│   ├── Header (session title, active thread title, toolbar)
│   ├── MessageList (filtered by activeThreadId only)
│   └── ChatInput
└── OrchestratorMetadataSidebar (existing right panel)
```

### API Changes

**New endpoint:** `PATCH /api/sessions/:sessionId/threads/:threadId`
- Body: `{ status: 'active' | 'archived' }`
- Updates thread status in DB
- Returns updated thread

**Modified:** `GET /api/sessions/:sessionId/threads`
- Add optional query param `?status=active` to filter by status
- Default (no param) returns all threads (backwards compatible)

**Auto-reactivate:** In channel inbound paths (slack-events.ts, etc.), after resolving the orchestrator thread, check if archived and flip to active. Single UPDATE query.

### What Gets Removed

- `ChannelSwitcher` component and `deriveChannels` function
- `selectedChannel` state in chat-container
- Channel-based message filtering (threads are the only filter)

## Files Changed

| File | Change |
|------|--------|
| `packages/client/src/components/chat/thread-sidebar.tsx` | **New** — sidebar component |
| `packages/client/src/components/chat/chat-container.tsx` | Replace channel switcher with thread sidebar, remove channel state |
| `packages/client/src/components/chat/channel-switcher.tsx` | **Delete** |
| `packages/client/src/api/threads.ts` | Add `useDismissThread` mutation, status filter to `useThreads` |
| `packages/worker/src/routes/threads.ts` | Add PATCH endpoint, status filter to GET |
| `packages/worker/src/lib/db/threads.ts` | Add `updateThreadStatus` helper |
| `packages/worker/src/routes/slack-events.ts` | Auto-reactivate archived threads on new message |

## Out of Scope

- Thread reordering / pinning
- Thread renaming from sidebar (exists in thread detail page)
- Notification sounds or desktop notifications for new thread activity
- Mobile/touch interactions (long-press to dismiss)
