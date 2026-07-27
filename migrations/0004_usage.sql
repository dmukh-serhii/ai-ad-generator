-- Migration number: 0004 	 2026-07-08
CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_action ON usage_events(action);
