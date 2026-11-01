#!/usr/bin/env bash
# Run once a minute from a root-owned systemd timer. No Docker socket is given to Alloy.
set -euo pipefail
install -d -m 755 /var/lib/quotedb-metrics
metric_file=$(mktemp /var/lib/quotedb-metrics/.containers.XXXXXX)
trap 'rm -f "$metric_file"' EXIT
for service in api discord-bot caddy postgres alloy; do
  container="quotedb-$service-1"
  if docker inspect "$container" >/dev/null 2>&1; then
    restarts=$(docker inspect --format '{{.RestartCount}}' "$container")
    pid=$(docker inspect --format '{{.State.Pid}}' "$container")
    if [[ "$pid" =~ ^[1-9][0-9]*$ && -f /proc/$pid/cgroup ]]; then
      group=$(awk -F: '$1 == "0" { print $3 }' "/proc/$pid/cgroup")
      if [[ -n "$group" && -f "/sys/fs/cgroup$group/memory.current" ]]; then
        printf 'quotedb_container_memory_bytes{service="%s"} %s\n' "$service" "$(cat "/sys/fs/cgroup$group/memory.current")" >> "$metric_file"
      fi
    fi
    printf 'quotedb_container_restarts_total{service="%s"} %s\n' "$service" "$restarts" >> "$metric_file"
  fi
done
printf 'quotedb_container_collection_timestamp_seconds %s\n' "$(date +%s)" >> "$metric_file"
chmod 644 "$metric_file"
mv "$metric_file" /var/lib/quotedb-metrics/containers.prom
