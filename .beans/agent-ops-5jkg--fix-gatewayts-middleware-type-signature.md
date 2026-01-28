---
# agent-ops-5jkg
title: Fix gateway.ts middleware type signature
status: completed
type: bug
priority: high
tags:
    - runner
created_at: 2026-01-28T07:32:56Z
updated_at: 2026-01-28T07:36:19Z
---

Auth middleware in packages/runner/src/gateway.ts has a function signature that doesn't match Hono's expected Context/Next types. May cause TypeScript compilation errors or runtime failures. Fix: use proper Hono middleware types.