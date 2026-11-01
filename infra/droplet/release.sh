#!/usr/bin/env bash
# Runs from a private staging directory on the Droplet. No build work happens here.
set -euo pipefail
stage=$PWD
cd /opt/quotedb
exec 9>.deploy.lock
flock -w 600 9
install -m 600 "$stage/api.env" api.env
install -m 600 "$stage/postgres.env" postgres.env
install -m 600 "$stage/.env" .env
install -m 640 "$stage/compose.yaml" compose.yaml
install -m 750 "$stage/backup.sh" backup.sh
# Registry credentials are private to this release and removed with staging.
export DOCKER_CONFIG="$stage/docker-auth"
if [[ -f "$stage/registry-token" ]]; then
  docker login ghcr.io -u "$(cat "$stage/registry-user")" --password-stdin < "$stage/registry-token" >/dev/null
fi
# Sequential pulls reduce memory spikes on the 1 GB host.
COMPOSE_PARALLEL_LIMIT=1 docker compose pull --quiet
docker compose up -d --wait --wait-timeout 180 postgres
./backup.sh
# Do not replace the serving API/frontend if migrations fail.
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --remove-orphans --wait --wait-timeout 180
# Keep recent images for rollback, and never prune volumes.
docker image prune -af --filter 'until=168h' >/dev/null
