---
# agent-ops-fz5k
title: Build admin API hooks and query key factory
status: todo
type: task
priority: high
tags:
    - frontend
created_at: 2026-01-31T07:49:04Z
updated_at: 2026-01-31T07:49:57Z
parent: agent-ops-csfb
blocking:
    - agent-ops-b8xw
---

Create packages/client/src/api/admin.ts with TanStack Query hooks for all admin endpoints.

## Query key factory
```ts
export const adminKeys = {
  all: ['admin'] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  llmKeys: () => [...adminKeys.all, 'llm-keys'] as const,
  invites: () => [...adminKeys.all, 'invites'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
}
```

## Hooks
### Org Settings
- `useOrgSettings()` — GET /api/admin/settings → returns OrgSettings
- `useUpdateOrgSettings()` — PUT /api/admin/settings → mutation, invalidates settings key

### LLM Keys
- `useOrgLLMKeys()` — GET /api/admin/llm-keys → returns OrgApiKey[]
- `useSetLLMKey()` — PUT /api/admin/llm-keys/:provider → mutation { provider, key }
- `useDeleteLLMKey()` — DELETE /api/admin/llm-keys/:provider → mutation

### Invites
- `useInvites()` — GET /api/admin/invites → returns Invite[]
- `useCreateInvite()` — POST /api/admin/invites → mutation { email, role? }
- `useDeleteInvite()` — DELETE /api/admin/invites/:id → mutation

### Users
- `useOrgUsers()` — GET /api/admin/users → returns User[]
- `useUpdateUserRole()` — PATCH /api/admin/users/:id → mutation { role }
- `useRemoveUser()` — DELETE /api/admin/users/:id → mutation

## Patterns
- Follow existing patterns from other api/ files (e.g. sessions.ts, integrations.ts)
- Use the centralized apiClient from client.ts
- Mutations should invalidate relevant query keys on success
- Include proper error handling with toast notifications

## Acceptance Criteria
- All hooks typed with shared interfaces
- Mutations invalidate correct cache keys
- pnpm typecheck passes in client package