-- Migration number: 0003 	 2026-07-08
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    gemini_api_key TEXT,
    blacklisted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Seeded accounts (PBKDF2-SHA256, 100k iterations):
--   admin@admin.com / admin123123  (full access)
--   test@gmail.com  / test         (regular user — safe to share with testers)
INSERT OR IGNORE INTO users (id, username, password_hash, salt, role) VALUES
    ('u-admin-0001', 'admin@admin.com', '1684eaea80b97020c568612cc2471edccf1409c21346e035a19fc3f1b60af844', 'cb4de672867b203d05b89e90a9a43eda', 'admin'),
    ('u-test-0001', 'test@gmail.com', '4d667d4d14cef9267ca0bd7a46fd616042ed81d88929bf31108f775496c9592d', '4bc99fd5c238c19189ccfddfa2f6ce05', 'user');
