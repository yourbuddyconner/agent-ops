---
# agent-ops-ak0c
title: Define runner git-state event types and detection logic
status: completed
type: task
priority: normal
tags:
    - runner
created_at: 2026-02-01T18:48:29Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

In packages/runner/src/ (for when runner is built/extended):

- Define message types for git-state and pr-created in runner event types
- On startup: detect current branch via 'git branch --show-current', send git-state message to DO
- After agent completes a turn: re-check branch and commit count (git rev-list --count), send git-state if changed
- When agent creates a PR (detect from tool call output containing PR URL patterns): send pr-created message

This is a design/scaffolding task — the runner may not be fully built yet. Define the types and logic stubs.

Done when: runner event types are defined and detection logic is documented/stubbed. pnpm typecheck passes.