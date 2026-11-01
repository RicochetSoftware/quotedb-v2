PRAGMA foreign_keys = ON;
CREATE TABLE evaluations (bucket INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, observed_at INTEGER NOT NULL);
CREATE TABLE component_state (component TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE check_results (
 component TEXT NOT NULL, bucket INTEGER NOT NULL, observed_at INTEGER NOT NULL,
 duration_ms REAL, outcome TEXT NOT NULL, reason TEXT, PRIMARY KEY(component,bucket)
);
CREATE INDEX checks_time ON check_results(observed_at);
CREATE TABLE bot_boots (boot TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
CREATE TABLE bot_heartbeats (id INTEGER PRIMARY KEY CHECK(id=1), boot TEXT NOT NULL, sequence INTEGER NOT NULL,
 heartbeat_id TEXT NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE incidents (id TEXT PRIMARY KEY, component TEXT NOT NULL, first_failure_at INTEGER NOT NULL,
 confirmed_at INTEGER NOT NULL, severity TEXT NOT NULL, resolved_at INTEGER);
CREATE UNIQUE INDEX active_incident ON incidents(component) WHERE resolved_at IS NULL;
CREATE INDEX incident_history ON incidents(confirmed_at);
CREATE TABLE incident_events (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id),
 at INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT);
CREATE TABLE maintenance_windows (id TEXT PRIMARY KEY, component TEXT NOT NULL, starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL, note TEXT NOT NULL, CHECK(ends_at > starts_at));
CREATE INDEX maintenance_time ON maintenance_windows(ends_at,starts_at);
CREATE TABLE daily_rollups (component TEXT NOT NULL, day INTEGER NOT NULL, available REAL NOT NULL DEFAULT 0,
 unavailable REAL NOT NULL DEFAULT 0, degraded REAL NOT NULL DEFAULT 0, maintenance REAL NOT NULL DEFAULT 0,
 PRIMARY KEY(component,day));
CREATE TABLE summary (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE notification_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_retry INTEGER NOT NULL, delivered_at INTEGER);
CREATE INDEX outbox_due ON notification_outbox(delivered_at,next_retry);
