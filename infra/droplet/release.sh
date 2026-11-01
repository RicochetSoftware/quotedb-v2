#!/usr/bin/env bash
# Runs from a private staging directory on the Droplet. No build work happens here.
set -euo pipefail
stage=$PWD
cd /opt/quotedb
exec 9>.deploy.lock
flock -w 600 9
install -m 600 "$stage/admin-origin.crt" admin-origin.crt
install -m 600 "$stage/admin-origin.key" admin-origin.key
install -m 600 "$stage/api.env" api.env
install -m 600 "$stage/postgres.env" postgres.env
install -m 600 "$stage/.env" .env
install -m 640 "$stage/compose.yaml" compose.yaml
install -m 640 "$stage/compose.bot.yaml" compose.bot.yaml
if [[ -f "$stage/bot.env" ]]; then install -m 600 "$stage/bot.env" bot.env; fi
install -m 750 "$stage/backup.sh" backup.sh
# Registry credentials are private to this release and removed with staging.
export DOCKER_CONFIG="$stage/docker-auth"
if [[ -f "$stage/registry-token" ]]; then
  docker login ghcr.io -u "$(cat "$stage/registry-user")" --password-stdin < "$stage/registry-token" >/dev/null
fi
# Sequential pulls reduce memory spikes on the 1 GB host.
COMPOSE_PARALLEL_LIMIT=1 docker compose pull --quiet
docker compose up -d --wait --wait-timeout 180 postgres
# Ownership migrations require a brief write pause: old API/bot binaries cannot
# write safely while the collection schema and saved credentials are upgraded.
docker compose stop api
if [[ -f "$stage/bot.env" ]]; then docker compose stop discord-bot; fi
./backup.sh
# On migration failure leave writers stopped for operator recovery; do not start old binaries.
docker compose run --rm --no-deps api node dist/migrate.js
if [[ -f "$stage/bot.env" ]]; then
  docker compose run --rm --no-deps bot-migrate
fi
docker compose up -d --remove-orphans --wait --wait-timeout 180
# Keep recent images for rollback, and never prune volumes.
docker image prune -af --filter 'until=168h' >/dev/null
