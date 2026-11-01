#!/usr/bin/env bash
# Logical dumps on the Droplet; copy them off-server to survive disk/server loss.
set -euo pipefail
cd /opt/quotedb
umask 077
mkdir -p backups
backup_file="backups/quotedb-$(date -u +%Y%m%dT%H%M%S%N).dump"
trap 'if [[ -f "$backup_file.partial" ]]; then unlink "$backup_file.partial"; fi' EXIT
docker compose exec -T postgres pg_dump -U quotedb -d quotedb -Fc > "$backup_file.partial"
# Verify the dump's archive directory before making it eligible for retention.
docker compose exec -T postgres pg_restore --list < "$backup_file.partial" > /dev/null
mv "$backup_file.partial" "$backup_file"
# Retain seven days, but only prune after a successful dump.
find backups -maxdepth 1 -type f -name 'quotedb-*.dump' -mtime +7 -delete
echo "Saved $backup_file"
