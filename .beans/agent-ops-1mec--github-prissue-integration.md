---
# agent-ops-1mec
title: GitHub PR/Issue Integration
status: completed
type: epic
priority: high
tags:
    - backend
    - frontend
    - worker
created_at: 2026-02-01T18:44:15Z
updated_at: 2026-02-01T21:42:21Z
---

Add GitHub PR and Issue integration to agent-ops, inspired by Ramp Inspect. Three pillars: (1) Start sessions from PRs/Issues via tabs in the create dialog, (2) Track & display git state in an always-visible metadata sidebar, (3) Adoption metrics showing PRs created/merged on the dashboard. No webhooks or cron polling in V1 — git state comes from runner events only. See plan in session transcript for full details.