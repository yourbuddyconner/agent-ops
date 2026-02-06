-- V2 Phase A: Org repositories and agent personas

-- Admin-managed known repositories for the org
CREATE TABLE IF NOT EXISTS org_repositories (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'github',
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT,
  default_branch TEXT DEFAULT 'main',
  language TEXT,
  topics TEXT, -- JSON array
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_repos_full_name ON org_repositories(org_id, full_name);

-- Persona definitions
CREATE TABLE IF NOT EXISTS agent_personas (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT, -- emoji
  visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('private', 'shared')),
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_slug ON agent_personas(org_id, slug);

-- Persona markdown files (the actual instructions content)
CREATE TABLE IF NOT EXISTS agent_persona_files (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_files_name ON agent_persona_files(persona_id, filename);

-- Repo-to-persona default mapping
CREATE TABLE IF NOT EXISTS org_repo_persona_defaults (
  id TEXT PRIMARY KEY,
  org_repo_id TEXT NOT NULL REFERENCES org_repositories(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_persona_default ON org_repo_persona_defaults(org_repo_id);

-- Track which persona was used for a session
ALTER TABLE sessions ADD COLUMN persona_id TEXT;
