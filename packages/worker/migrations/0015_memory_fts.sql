-- FTS5 full-text search index for orchestrator memories
-- Note: must use lowercase 'fts5' on Cloudflare D1
CREATE VIRTUAL TABLE orchestrator_memories_fts USING fts5(
  content,
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Populate FTS index from existing memories
INSERT INTO orchestrator_memories_fts(rowid, content)
  SELECT rowid, content FROM orchestrator_memories;
