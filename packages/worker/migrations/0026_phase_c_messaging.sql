-- Phase C: Messaging + Coordination
-- Adds mailbox messages, session tasks, task dependencies, and notification preferences

-- ─── Mailbox Messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailbox_messages (
  id TEXT PRIMARY KEY,
  from_session_id TEXT,
  from_user_id TEXT,
  to_session_id TEXT,
  to_user_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'notification', 'question', 'escalation')),
  content TEXT NOT NULL,
  context_session_id TEXT,
  context_task_id TEXT,
  reply_to_id TEXT REFERENCES mailbox_messages(id),
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mailbox_to_session ON mailbox_messages(to_session_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_to_user ON mailbox_messages(to_user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_from_session ON mailbox_messages(from_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_reply_to ON mailbox_messages(reply_to_id);

-- ─── Session Tasks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_tasks (
  id TEXT PRIMARY KEY,
  orchestrator_session_id TEXT NOT NULL,
  session_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'blocked')),
  result TEXT,
  parent_task_id TEXT REFERENCES session_tasks(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_tasks_orchestrator ON session_tasks(orchestrator_session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_tasks_session ON session_tasks(session_id, status);
CREATE INDEX IF NOT EXISTS idx_session_tasks_parent ON session_tasks(parent_task_id);

-- ─── Session Task Dependencies ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_task_dependencies (
  task_id TEXT NOT NULL REFERENCES session_tasks(id) ON DELETE CASCADE,
  blocked_by_task_id TEXT NOT NULL REFERENCES session_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_by_task_id)
);

-- ─── User Notification Preferences ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('message', 'notification', 'question', 'escalation')),
  web_enabled INTEGER NOT NULL DEFAULT 1,
  slack_enabled INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, message_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON user_notification_preferences(user_id);
