-- Plugin registry: tracks installed plugins per org
CREATE TABLE org_plugins (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  source TEXT NOT NULL DEFAULT 'builtin',
  capabilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  installed_by TEXT NOT NULL DEFAULT 'system',
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_org_plugins_name ON org_plugins(org_id, name);

-- Content artifacts extracted from plugins (skills, personas, tools)
CREATE TABLE org_plugin_artifacts (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES org_plugins(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_plugin_artifacts_file ON org_plugin_artifacts(plugin_id, type, filename);
CREATE INDEX idx_plugin_artifacts_plugin ON org_plugin_artifacts(plugin_id);

-- Org-level plugin settings
CREATE TABLE org_plugin_settings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  allow_repo_content INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_org_plugin_settings_org ON org_plugin_settings(org_id);
