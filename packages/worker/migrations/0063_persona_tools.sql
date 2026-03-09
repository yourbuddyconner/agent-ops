CREATE TABLE persona_tools (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  service TEXT NOT NULL,
  action_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_persona_tools_unique ON persona_tools(persona_id, service, action_id);
CREATE INDEX idx_persona_tools_persona ON persona_tools(persona_id);
