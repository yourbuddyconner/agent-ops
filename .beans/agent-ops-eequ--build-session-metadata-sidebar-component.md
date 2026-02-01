---
# agent-ops-eequ
title: Build session metadata sidebar component
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:48:40Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
blocking:
    - agent-ops-telc
---

Create packages/client/src/components/session/session-metadata-sidebar.tsx

Always-visible panel on the right side of the chat column (~260px wide). Sections:

1. Session info: User avatar + name, live duration timer, model name
2. Repository: Repo name with GitHub link icon
3. Git branch: Branch name with copy button, base branch smaller underneath
4. PR status: If PR exists — '#123 Title' with state badge (Draft/Open/Merged), link to GitHub
5. Source context: If from issue — 'Issue #45: Title' with link. If from PR — 'From PR #123' with link
6. Stats: Commit count, message count, tool call count

Use existing Radix UI primitives and Tailwind. Consume useSessionGitState() hook for data.
Gracefully handle null/missing git state (show only session info section).

Done when: component renders correctly with mock data, all sections display appropriately, copy button works.