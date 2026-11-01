-- Keep the original table intact for rollback; future pruning honors its retention.
-- A WITHOUT ROWID primary key avoids a second B-tree write for every sample/delete.
CREATE TABLE check_samples (
 component TEXT NOT NULL, bucket INTEGER NOT NULL, observed_at INTEGER NOT NULL,
 duration_ms REAL, outcome TEXT NOT NULL, reason TEXT, PRIMARY KEY(component,bucket)
) WITHOUT ROWID;
CREATE INDEX samples_time ON check_samples(observed_at);
INSERT INTO check_samples SELECT * FROM check_results;
