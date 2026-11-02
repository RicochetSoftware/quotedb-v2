CREATE TABLE maintenance_recovery (
 window_id TEXT PRIMARY KEY REFERENCES maintenance_windows(id) ON DELETE CASCADE,
 requested_at INTEGER NOT NULL
);
