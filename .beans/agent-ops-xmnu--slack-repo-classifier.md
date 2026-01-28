---
# agent-ops-xmnu
title: Slack repo classifier
status: todo
type: task
priority: high
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:15Z
updated_at: 2026-01-28T04:12:15Z
parent: agent-ops-0k97
---

Fast model classifies which repo a Slack prompt belongs to:
- When /inspect is used without explicit repo, run classifier
- Use fast LLM (e.g. Haiku) with list of user's repos + prompt
- If confident (>0.8), auto-select repo
- If ambiguous, post disambiguation buttons via Block Kit (interactive component)
- User clicks repo button → session continues with selected repo

Acceptance criteria:
- Classifier function using fast model
- Auto-select when confidence high
- Block Kit buttons for disambiguation
- Interactive component handler picks up selection
- Falls back to asking user if classifier fails