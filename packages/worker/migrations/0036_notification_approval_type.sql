-- Add explicit 'approval' notification type support.
-- SQLite requires table rebuild to update CHECK constraints.

PRAGMA foreign_keys = OFF;

-- ─── mailbox_messages: widen message_type CHECK ───────────────────────────
ALTER TABLE mailbox_messages RENAME TO mailbox_messages_old;

CREATE TABLE mailbox_messages (
  id TEXT PRIMARY KEY,
  from_session_id TEXT,
  from_user_id TEXT,
  to_session_id TEXT,
  to_user_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'notification', 'question', 'escalation', 'approval')),
  content TEXT NOT NULL,
  context_session_id TEXT,
  context_task_id TEXT,
  reply_to_id TEXT REFERENCES mailbox_messages(id),
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO mailbox_messages (
  id, from_session_id, from_user_id, to_session_id, to_user_id, message_type, content,
  context_session_id, context_task_id, reply_to_id, read, created_at, updated_at
)
SELECT
  id, from_session_id, from_user_id, to_session_id, to_user_id, message_type, content,
  context_session_id, context_task_id, reply_to_id, read, created_at, updated_at
FROM mailbox_messages_old;

DROP TABLE mailbox_messages_old;

CREATE INDEX IF NOT EXISTS idx_mailbox_to_session ON mailbox_messages(to_session_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_to_user ON mailbox_messages(to_user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_from_session ON mailbox_messages(from_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_reply_to ON mailbox_messages(reply_to_id);

-- ─── user_notification_preferences: widen message_type CHECK ──────────────
ALTER TABLE user_notification_preferences RENAME TO user_notification_preferences_old;

CREATE TABLE user_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('message', 'notification', 'question', 'escalation', 'approval')),
  web_enabled INTEGER NOT NULL DEFAULT 1,
  slack_enabled INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, message_type)
);

INSERT INTO user_notification_preferences (
  id, user_id, message_type, web_enabled, slack_enabled, email_enabled, created_at, updated_at
)
SELECT
  id, user_id, message_type, web_enabled, slack_enabled, email_enabled, created_at, updated_at
FROM user_notification_preferences_old;

DROP TABLE user_notification_preferences_old;

CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON user_notification_preferences(user_id);

PRAGMA foreign_keys = ON;
