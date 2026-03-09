-- Unified skills table (replaces skill rows in org_plugin_artifacts)
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  owner_id TEXT,
  source TEXT NOT NULL DEFAULT 'managed',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Builtin/plugin skills: unique per org + slug
CREATE UNIQUE INDEX idx_skills_org_slug ON skills(org_id, slug) WHERE source IN ('builtin', 'plugin');

-- Managed skills: unique per org + owner + slug
CREATE UNIQUE INDEX idx_skills_org_owner_slug ON skills(org_id, owner_id, slug) WHERE source = 'managed';

-- Lookup by org + status for delivery
CREATE INDEX idx_skills_org_status ON skills(org_id, status);

-- Lookup by owner
CREATE INDEX idx_skills_owner ON skills(owner_id) WHERE owner_id IS NOT NULL;

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE skills_fts USING fts5(
  name,
  description,
  content,
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Persona-skill attachments
CREATE TABLE persona_skills (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_persona_skills_unique ON persona_skills(persona_id, skill_id);
CREATE INDEX idx_persona_skills_persona ON persona_skills(persona_id);
CREATE INDEX idx_persona_skills_skill ON persona_skills(skill_id);

-- Org default skills (auto-loaded when no persona specified)
CREATE TABLE org_default_skills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_org_default_skills_unique ON org_default_skills(org_id, skill_id);

-- Migrate existing skill artifacts to skills table
INSERT INTO skills (id, org_id, owner_id, source, name, slug, description, content, visibility, status, created_at, updated_at)
  SELECT
    a.id,
    p.org_id,
    NULL,
    CASE WHEN p.source = 'builtin' THEN 'builtin' ELSE 'plugin' END,
    REPLACE(REPLACE(a.filename, '.md', ''), '_', '-'),
    REPLACE(REPLACE(a.filename, '.md', ''), '_', '-'),
    NULL,
    a.content,
    'shared',
    'active',
    datetime('now'),
    datetime('now')
  FROM org_plugin_artifacts a
  JOIN org_plugins p ON a.plugin_id = p.id
  WHERE a.type = 'skill';

-- Populate FTS index
INSERT INTO skills_fts(rowid, name, description, content)
  SELECT rowid, name, COALESCE(description, ''), content FROM skills;

-- Add all existing skills as org defaults (preserves current "load everything" behavior)
INSERT INTO org_default_skills (id, org_id, skill_id)
  SELECT
    lower(hex(randomblob(8))),
    org_id,
    id
  FROM skills WHERE source IN ('builtin', 'plugin');

-- Remove migrated skill rows from org_plugin_artifacts
DELETE FROM org_plugin_artifacts WHERE type = 'skill';
