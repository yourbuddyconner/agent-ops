-- Add event_type support to user notification preferences.
-- event_type='*' is the wildcard/default for all events within a message_type.

PRAGMA foreign_keys = OFF;

ALTER TABLE user_notification_preferences RENAME TO user_notification_preferences_old;

CREATE TABLE user_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('message', 'notification', 'question', 'escalation', 'approval')),
  event_type TEXT NOT NULL DEFAULT '*',
  web_enabled INTEGER NOT NULL DEFAULT 1,
  slack_enabled INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, message_type, event_type)
);

INSERT INTO user_notification_preferences (
  id, user_id, message_type, event_type, web_enabled, slack_enabled, email_enabled, created_at, updated_at
)
SELECT
  id, user_id, message_type, '*', web_enabled, slack_enabled, email_enabled, created_at, updated_at
FROM user_notification_preferences_old;

DROP TABLE user_notification_preferences_old;

CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON user_notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_prefs_lookup ON user_notification_preferences(user_id, message_type, event_type);

PRAGMA foreign_keys = ON;
