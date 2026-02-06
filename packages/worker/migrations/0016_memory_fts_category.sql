-- Rebuild FTS index to include category column
-- This allows searching by category name (e.g. "project") to match memories in that category
DROP TABLE IF EXISTS orchestrator_memories_fts;

CREATE VIRTUAL TABLE orchestrator_memories_fts USING fts5(
  category,
  content,
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Repopulate with both category and content
INSERT INTO orchestrator_memories_fts(rowid, category, content)
  SELECT rowid, category, content FROM orchestrator_memories;
