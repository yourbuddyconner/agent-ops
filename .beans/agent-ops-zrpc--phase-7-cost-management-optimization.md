---
# agent-ops-zrpc
title: 'Phase 7: Cost Management & Optimization'
status: todo
type: milestone
priority: normal
tags:
    - worker
    - backend
    - frontend
created_at: 2026-01-31T08:04:25Z
updated_at: 2026-01-31T08:04:25Z
---

Usage tracking, concurrency limits, budgets, alerts, image build pipeline, warm pools, snapshots, and performance optimization. Corresponds to V1.md Phases 5 and 6.

## Scope (from V1.md)
- Usage tracking per user/org
- Concurrency limits and budgets
- Cost alerts and notifications
- Image build pipeline for repo-specific images
- Warm sandbox pools
- Sandbox snapshots and restore
- Screenshot capture
- Agent memories
- Dashboard and analytics

## Definition of Done
- Per-session cost tracking with org-level rollups
- Configurable concurrency and budget limits
- Warm pool reduces cold start latency
- Repo-specific images build automatically