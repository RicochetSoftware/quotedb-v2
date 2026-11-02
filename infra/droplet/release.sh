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
install -m 640 "$stage/compose.observability.yaml" compose.observability.yaml
install -m 644 "$stage/config.alloy" config.alloy
if [[ -f "$stage/observability.env" ]]; then install -m 600 "$stage/observability.env" observability.env; fi
# Preserve an enabled collector across ordinary application releases.
if [[ -f observability.env ]]; then
  sudo install -d -m 755 /var/lib/quotedb-metrics
  sudo install -m 750 "$stage/container-metrics.sh" /opt/quotedb/container-metrics.sh
  sudo install -m 644 "$stage/quotedb-container-metrics.service" "$stage/quotedb-container-metrics.timer" /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now quotedb-container-metrics.timer
  if [[ -f "$stage/bot.env" ]]; then
    printf "COMPOSE_FILE='compose.yaml:compose.bot.yaml:compose.observability.yaml'\n" >> .env
  else
    printf "COMPOSE_FILE='compose.yaml:compose.observability.yaml'\n" >> .env
  fi
fi
if [[ -f "$stage/bot.env" ]]; then install -m 600 "$stage/bot.env" bot.env; fi
install -m 750 "$stage/backup.sh" backup.sh
install -m 750 "$stage/status-maintenance.py" status-maintenance.py
install -m 750 "$stage/maintenance-reboot.sh" maintenance-reboot.sh
if [[ -f "$stage/status-maintenance.json" ]]; then
  install -m 600 "$stage/status-maintenance.json" status-maintenance.json
fi
if [[ -f status-maintenance.json ]]; then
  sudo install -m 644 "$stage/quotedb-reboot.service" "$stage/quotedb-reboot.timer" /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now quotedb-reboot.timer
  # Replace unattended-upgrades' direct reboot only after the replacement is enabled.
  printf 'Unattended-Upgrade::Automatic-Reboot "false";\n' | sudo tee /etc/apt/apt.conf.d/99quotedb-maintenance-reboot >/dev/null
fi
# Registry credentials are private to this release and removed with staging.
export DOCKER_CONFIG="$stage/docker-auth"
if [[ -f "$stage/registry-token" ]]; then
  docker login ghcr.io -u "$(cat "$stage/registry-user")" --password-stdin < "$stage/registry-token" >/dev/null
fi
# Sequential pulls reduce memory spikes on the 1 GB host.
COMPOSE_PARALLEL_LIMIT=1 docker compose pull --quiet
# Register after pulls, before the first operation that can replace a running service.
# Fail closed: a status API failure must not cause an unannounced interruption.
if [[ -f status-maintenance.json ]]; then
  python3 ./status-maintenance.py ./status-maintenance.json deploy
fi
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
