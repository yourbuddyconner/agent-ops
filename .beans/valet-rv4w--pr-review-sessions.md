---
# valet-rv4w
title: PR Review Sessions
status: todo
type: epic
priority: high
tags:
    - sessions
    - code-review
    - github
    - guidance
    - orchestrator
created_at: 2026-03-04T00:00:00Z
updated_at: 2026-03-04T00:00:00Z
---

Introduce a new `'review'` session purpose that provides a first-class, bounded-lifecycle session type for pull request reviews. Review sessions spin up a full sandbox, analyze a PR using team-specific guidance, and post structured findings as a GitHub PR review. A two-tier guidance store (org baseline + repo overrides) captures the organization's review standards, and a curation mechanism learns from past reviews and codebase structure to keep guidance improving over time.

## Problem

The existing code review feature is an in-session utility — it reviews the working tree diff inside a running session using a generic prompt. This has several limitations:

- **No PR awareness** — it only sees uncommitted local changes, not a PR's full changeset
- **No team context** — the review prompt is completely generic, no project conventions or reviewer patterns
- **No GitHub integration** — findings stay in the Valet UI, never posted as PR review comments
- **No trigger mechanism** — reviews are manual-only, initiated by clicking a button in an active session
- **Wrong abstraction** — a PR review is a bounded task (analyze → produce findings → post → done), fundamentally different from an open-ended interactive session that happens to have a review button

## Design

### Session Identity & Lifecycle

A `'review'` session is a fourth `SessionPurpose` alongside `interactive`, `orchestrator`, `workflow`.

**Session ID format:** `review:{owner}:{repo}:{prNumber}`

Deterministic IDs provide:
- **Idempotency** — duplicate webhook fires for the same PR hit the same session, no parallel duplicates
- **Direct lookup** — given a PR, construct the session ID without a database query
- **Re-review as update** — when new commits are pushed, the existing session is rehydrated with updated state for incremental review rather than creating a disconnected new session
- **Clean cleanup** — PR merged/closed → terminate the known session ID

**Session metadata:**
```typescript
{
  prNumber: number;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  triggerType: 'manual' | 'webhook';
  autonomousMode: boolean;
}
```

**Lifecycle state machine:**
```
initializing → running → review_complete → [posting | pending_approval] → posted → terminated
```

- `review_complete` — agent has finished analysis, findings are ready
- `pending_approval` — human-gated repos: findings visible in Valet UI, awaiting approval to post
- `posting` — autonomous repos: immediately transitions to posting to GitHub
- `posted` — GitHub review submitted, session can be terminated
- `terminated` — sandbox torn down, session archived

**Differences from interactive sessions:**
- Not shareable (like orchestrator/workflow)
- Auto-terminates after posting (bounded lifecycle, no idle timeout)
- Bypasses concurrency limits (reviews shouldn't block interactive sessions)
- Separate UI view (not in main session list)

### Review Guidance Store

Two-tier guidance system: org-level baseline + repo-level overrides.

**New table: `review_guidance`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| orgId | text, FK | Owning organization |
| repoFullName | text, nullable | Null = org-level, set = repo-level override |
| category | text | e.g. security, error-handling, architecture, style, testing |
| title | text | Short label, e.g. "Always validate webhook signatures" |
| content | text | Detailed guidance, examples, rationale |
| source | text | `manual`, `curated_review`, `curated_code`, `curated_incident` |
| anchors | JSON | Array of code anchors (see below) |
| status | text | `active`, `proposed`, `archived` |
| createdAt | text | ISO datetime |
| updatedAt | text | ISO datetime |

**Anchor types** — guidance entries can be anchored to specific code:

```typescript
type GuidanceAnchor = {
  type: 'pr_comment' | 'pr_diff' | 'file' | 'symbol';
  url: string;           // GitHub permalink
  repoFullName: string;
  path: string;          // file path
  symbol?: string;       // function/class/interface name
  snippet: string;       // short code excerpt for context
  sha: string;           // commit SHA when captured
};
```

- **`pr_comment`** — sourced from a specific review comment
- **`pr_diff`** — sourced from a specific change in a PR
- **`file`** — anchored to a file/line range in the codebase
- **`symbol`** — anchored to a named symbol (function, class, interface), resilient to line movement

**Symbol anchors enable smart priority elevation:** when a review session starts, it checks if any guidance entries have symbol anchors that appear in the PR diff. If `PaymentProvider` is modified and guidance is anchored to that symbol, the entry gets elevated priority — the reviewer knows this is a sensitive change. Stale anchors (symbol deleted/renamed) get flagged for review.

**Assembly for review sessions:** at session creation, the service fetches org-level + repo-level guidance entries, merges them (repo supplements/overrides org within the same category), and injects the assembled document as a persona file into the sandbox.

### Guidance Curation Mechanism

Curation runs as agent tasks within existing sessions (orchestrator or interactive), not as a separate system. Three operations:

#### `curate:scan-reviews` — Learn from past PR reviews

Input: repo (or set of repos), optional date range, optional reviewer filter.

1. Fetch merged PRs with review comments via GitHub API
2. Read review comments and the diffs they apply to
3. Identify recurring patterns (same reviewer flags repeatedly, or multiple reviewers flag)
4. Draft guidance entries with anchors to original PR comments
5. Deduplicate against existing guidance
6. Create entries as `proposed` or `active` based on repo autonomy setting

#### `curate:scan-codebase` — Learn from code structure

Input: repo, optional focus areas.

1. Clone repo in sandbox
2. Identify critical interfaces, contracts, and boundaries
3. Draft guidance entries anchored to symbols and files
4. Source: `curated_code`

#### `curate:refresh` — Keep guidance current

Input: repo, triggered periodically or on-demand.

1. Load existing guidance entries with anchors for this repo
2. For symbol anchors: check if symbol still exists and has changed since recorded `sha`
3. Update anchors (new sha, updated snippet) or flag stale entries
4. Check if recent PRs contradict existing guidance patterns
5. Propose archival for guidance that no longer applies

**Trigger matrix:**

| Operation | Manual | Automatic |
|-----------|--------|-----------|
| scan-reviews | User asks orchestrator | Scheduled weekly/monthly per org |
| scan-codebase | User asks in session | On repo onboarding (first review session enabled) |
| refresh | User asks in session | After a guidance-anchored symbol appears in a merged PR |

**Autonomy gating:** curation operations respect the same per-repo autonomy setting as reviews. Human-gated repos produce `proposed` entries; autonomous repos produce `active` entries directly.

### Triggering

#### Manual

- **Valet UI:** "Review PR" action — user provides repo + PR number or URL
- **Orchestrator/Slack:** "review PR #42 on repo X" → orchestrator spawns child review session
- **API:** `POST /api/sessions` with `purpose: 'review'` and PR metadata

#### Automatic (GitHub webhook)

1. Listen for `pull_request` events: `opened`, `synchronize`, `ready_for_review`
2. Check if target repo has review sessions enabled (via `review_config`)
3. Construct deterministic session ID: `review:{owner}:{repo}:{prNumber}`
4. If session already exists and is running (re-push):
   - Update metadata with new `headSha`
   - Send prompt to running session: "PR updated. New commits: {shas}. Re-review."
   - Agent performs incremental review
5. If no existing session: create new review session

**New table: `review_config`**

| Column | Type | Description |
|--------|------|-------------|
| orgId | text, FK | Owning organization |
| repoFullName | text | Composite PK with orgId |
| enabled | boolean | Whether review sessions are active for this repo |
| autonomousMode | boolean | Post directly vs. human approval gate |
| autoTriggerOnOpen | boolean | Auto-review when PR is opened |
| autoTriggerOnPush | boolean | Auto-review when commits are pushed |
| ignoreDraftPrs | boolean (default true) | Skip draft PRs |
| ignorePatterns | JSON | File glob patterns to skip, e.g. `["*.lock", "docs/**"]` |
| createdAt | text | ISO datetime |
| updatedAt | text | ISO datetime |

### GitHub Output

When the review agent finishes analysis:

1. Agent produces structured findings (`ReviewResultData`)
2. Runner maps findings → GitHub PR review payload:
   - Each finding with file + line range → inline comment
   - `overallSummary` → review body
   - Severity determines action: any `critical` → `REQUEST_CHANGES`, otherwise `COMMENT`
3. **Autonomous repos:** post immediately via GitHub API
4. **Human-gated repos:** transition to `pending_approval`, notify via Slack/UI. Human can:
   - **Approve** — post as-is
   - **Edit** — modify findings in Valet UI, then post
   - **Reject** — discard review, terminate session

Review is posted as the Valet GitHub App (or user's GitHub identity, configurable).

### Sandbox & Agent Configuration

Review sessions get a full sandbox (same as interactive) with review-specific configuration:

- **Workspace:** PR's target repo, checked out to PR head branch
- **Persona:** Review-focused system prompt + assembled guidance document
- **Initial prompt:** Auto-generated from PR metadata (title, author, branches, description)
- **Tools:** Same as interactive, but agent instructions emphasize read-only analysis. Can run tests and typecheck but shouldn't push commits.
- **Idle timeout:** Shorter than interactive (~10 minutes). Review is bounded work.

**What the agent does:**
1. Read the PR diff (already checked out)
2. Load guidance from persona files, note which guidance entries are anchored to changed symbols
3. Explore surrounding codebase for context (trace call sites, check types, read tests)
4. Run tests/typecheck if relevant
5. Produce structured findings
6. Return results to Runner

## Future Work

- Slack notifications for pending approvals
- Review quality feedback loop ("was this review helpful?" on posted GitHub reviews)
- Multi-reviewer personas (security reviewer, architecture reviewer, style reviewer)
- Cross-PR pattern detection ("third PR this week that misses error handling in this module")
- Guidance conflict resolution (repo entry contradicts org entry in same category)
