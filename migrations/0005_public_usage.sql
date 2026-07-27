-- Migration number: 0005 	 2026-07-19
-- Public (no-login) generator: track visitor IP and request outcome per event.
ALTER TABLE usage_events ADD COLUMN ip TEXT;
ALTER TABLE usage_events ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success';

CREATE INDEX IF NOT EXISTS idx_usage_ip_time ON usage_events(ip, created_at);
