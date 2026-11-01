#!/usr/bin/env python3
"""Estimate retained SQLite size with representative bounded rows (not a D1 quota claim)."""
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[2]
db = sqlite3.connect(':memory:')
for migration in sorted((root / 'apps/status/migrations').glob('*.sql')):
    db.executescript(migration.read_text())
components = ['web', 'admin', 'bot', 'api', 'site']
db.executemany('INSERT INTO check_results VALUES(?,?,?,?,?,?)',
    ((component, bucket, 1793500000000 + bucket * 60000, 345.12, 'healthy', None)
     for bucket in range(14 * 1440) for component in components))
db.executemany('INSERT INTO evaluations VALUES(?,?,?)',
    ((bucket, f'00000000-0000-0000-0000-{bucket:012d}', 1793500000000 + bucket * 60000)
     for bucket in range(14 * 1440)))
db.executemany('INSERT INTO daily_rollups VALUES(?,?,?,?,?,?)',
    ((component, day * 86400000, 86000.1, 100.2, 100.3, 200.4)
     for day in range(400) for component in components))
db.commit()
size = db.execute('PRAGMA page_count').fetchone()[0] * db.execute('PRAGMA page_size').fetchone()[0]
print(f'14-day checks + evaluations + 400-day rollups and indexes: {size:,} bytes ({size / 1024 / 1024:.2f} MiB)')
for query in [
    'SELECT rowid FROM daily_rollups WHERE day<1 LIMIT 10',
    'SELECT id FROM notification_outbox WHERE delivered_at<1 LIMIT 20',
    'SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND next_retry<1 AND attempts>=6 LIMIT 20',
]:
    print(db.execute('EXPLAIN QUERY PLAN '+query).fetchall())
