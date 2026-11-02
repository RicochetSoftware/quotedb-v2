ALTER TABLE daily_rollups ADD COLUMN maintenance_available REAL NOT NULL DEFAULT 0;
ALTER TABLE daily_rollups ADD COLUMN maintenance_unavailable REAL NOT NULL DEFAULT 0;
