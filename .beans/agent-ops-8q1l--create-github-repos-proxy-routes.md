---
# agent-ops-8q1l
title: Create GitHub repos proxy routes
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:47:51Z
updated_at: 2026-02-01T21:31:08Z
parent: agent-ops-1mec
blocking:
    - agent-ops-8na7
---

Create packages/worker/src/routes/repos.ts with:

GET /api/repos/:owner/:repo/pulls
- Auth required
- Fetch user's GitHub OAuth token from oauth_tokens table
- Proxy to GitHub API: GET /repos/{owner}/{repo}/pulls?state=open&sort=updated&per_page=30
- Return array of PRs with: number, title, state, draft, user.login, head.ref, base.ref, body, updated_at, html_url

GET /api/repos/:owner/:repo/issues
- Same auth + token lookup
- Proxy to GitHub API: GET /repos/{owner}/{repo}/issues?state=open&sort=updated&per_page=30&filter=all
- Filter out PRs (GitHub returns PRs in issues endpoint)
- Return array of issues with: number, title, labels, assignees, body, updated_at, html_url

Mount in packages/worker/src/index.ts as app.route('/api/repos', reposRouter)

Done when: both endpoints return data when called with a valid GitHub token. pnpm typecheck passes.