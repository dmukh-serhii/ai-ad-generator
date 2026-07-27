-- Migration number: 0002 	 2026-07-07
CREATE TABLE IF NOT EXISTS ads (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    concept TEXT NOT NULL,
    primary_text TEXT NOT NULL,
    headline TEXT NOT NULL,
    description TEXT NOT NULL,
    cta TEXT NOT NULL,
    image_url TEXT,
    brand_profile_json TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ads_source_url ON ads(source_url);
