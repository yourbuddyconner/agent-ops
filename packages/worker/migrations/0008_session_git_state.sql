-- Session git state: tracks source context and git state for sessions
CREATE TABLE session_git_state (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Source context (what triggered this session)
  source_type TEXT CHECK(source_type IN ('pr', 'issue', 'branch', 'manual')),
  source_pr_number INTEGER,
  source_issue_number INTEGER,
  source_repo_full_name TEXT,
  source_repo_url TEXT,

  -- Current git state (updated by runner events)
  branch TEXT,
  base_branch TEXT,
  commit_count INTEGER DEFAULT 0,

  -- PR created by this session
  pr_number INTEGER,
  pr_title TEXT,
  pr_state TEXT CHECK(pr_state IN ('draft', 'open', 'closed', 'merged')),
  pr_url TEXT,
  pr_created_at TEXT,
  pr_merged_at TEXT,

  agent_authored INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_sgs_session ON session_git_state(session_id);
CREATE INDEX idx_sgs_repo_pr ON session_git_state(source_repo_full_name, pr_number);
CREATE INDEX idx_sgs_agent_pr ON session_git_state(agent_authored, pr_state);
