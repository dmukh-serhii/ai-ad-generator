-- Migration number: 0001 	 2026-07-07
CREATE TABLE IF NOT EXISTS health_check (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO health_check (note) VALUES ('hello from d1');
