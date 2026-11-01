-- Avoid scanning all 400 days during each bounded retention pass.
CREATE INDEX rollups_day ON daily_rollups(day);
CREATE INDEX events_incident ON incident_events(incident_id);
