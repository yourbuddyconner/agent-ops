---
# agent-ops-9tjx
title: Build adoption metrics card for dashboard
status: completed
type: task
priority: normal
tags:
    - frontend
created_at: 2026-02-01T18:52:05Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

Create packages/client/src/components/dashboard/adoption-card.tsx:

Stats card showing:
- PRs created by agent (count)
- PRs merged (count + merge rate percentage)
- Total commits pushed

Use existing card/UI patterns from the dashboard. Show a period selector (7d, 30d, 90d).
Handle loading state with skeleton. Handle zero-state gracefully ('No PRs tracked yet').

Create packages/client/src/api/dashboard.ts:
- useAdoptionMetrics(period?) — GET /api/dashboard/adoption?period=30

Mount the card in the dashboard route (packages/client/src/routes/dashboard.tsx or equivalent).

Done when: dashboard shows adoption stats card with real data from the API.