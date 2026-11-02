#!/usr/bin/env bash
# Runs ON the server (ops-check.yml pipes it over SSH: ssh <target> bash -s < ops-check.sh).
# Fails loudly when the unattended upkeep has quietly stopped: the failure mode of the v1 droplet.
set -uo pipefail

failed=0
fail() {
  echo "::error::$*"
  failed=1
}
now=$(date +%s)
age_hours() { echo $(((now - $(stat -c %Y "$1")) / 3600)); }

# unattended-upgrades runs daily; a stale stamp means updates have stopped.
stamp=/var/lib/apt/periodic/unattended-upgrades-stamp
if [[ ! -f $stamp ]]; then
  fail "unattended-upgrades has never run"
elif (($(age_hours "$stamp") > 50)); then
  fail "unattended-upgrades last ran $(age_hours "$stamp") hours ago"
fi

# Automatic reboots happen at 04:00 UTC; a reboot pending for over a day means they aren't.
if [[ -f /var/run/reboot-required ]] && (($(age_hours /var/run/reboot-required) > 30)); then
  fail "reboot pending for $(age_hours /var/run/reboot-required) hours: $(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null)"
fi

pending=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst .*-security' || true)
((pending == 0)) || echo "::warning::$pending security updates waiting for tonight's run"

disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
((disk < 85)) || fail "root disk ${disk}% full"

cd /opt/quotedb || {
  fail "/opt/quotedb missing: never deployed?"
  exit 1
}
running=$(docker compose ps --status running --services 2>/dev/null)
for service in api caddy postgres; do
  grep -qx "$service" <<<"$running" || fail "$service container is not running"
done
health=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo unknown)
[[ $health == healthy ]] || fail "api container is $health"

pg_health=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q postgres)" 2>/dev/null || echo unknown)
[[ $pg_health == healthy ]] || fail "postgres container is $pg_health"
if docker compose config --services 2>/dev/null | grep -qx discord-bot; then
  grep -qx discord-bot <<<"$running" || fail "discord-bot container is not running"
  bot_health=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q discord-bot)" 2>/dev/null || echo unknown)
  [[ $bot_health == healthy ]] || fail "discord-bot container is $bot_health"
fi
if [[ -f status-maintenance.json ]]; then
  systemctl is-active --quiet quotedb-reboot.timer || fail "maintenance reboot timer is inactive"
  systemctl is-enabled --quiet quotedb-recovery.service || fail "maintenance recovery service is disabled"
  systemctl is-failed --quiet quotedb-recovery.service && fail "maintenance recovery service failed"
  systemctl is-failed --quiet quotedb-reboot.service && fail "maintenance reboot service failed"
fi
systemctl is-active --quiet quotedb-backup.timer || fail "database backup timer is inactive"
latest_backup=$(find backups -maxdepth 1 -type f -name 'quotedb-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d ' ' -f2-)
if [[ -z $latest_backup ]]; then
  fail "no database backups found"
elif (($(age_hours "$latest_backup") > 30)); then
  fail "database backup is older than 30 hours"
fi

# shellcheck disable=SC1091
. /etc/os-release
echo "$PRETTY_NAME, kernel $(uname -r), up $(uptime -p | sed 's/^up //'), disk ${disk}%, api $health"
# Origin CA certificate rotation is managed by OpenTofu; warn a month ahead.
openssl x509 -checkend 2592000 -noout -in /opt/quotedb/admin-origin.crt || fail "Admin origin certificate missing or expiring within 30 days"
exit "$failed"
