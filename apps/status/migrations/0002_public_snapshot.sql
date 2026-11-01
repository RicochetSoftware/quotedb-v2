-- Public reads touch one precomputed row regardless of history or incident volume.
CREATE TABLE public_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE INDEX events_kind_time ON incident_events(kind,at DESC);
CREATE INDEX incidents_resolved_time ON incidents(resolved_at,confirmed_at DESC);
