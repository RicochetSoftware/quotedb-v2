#!/usr/bin/env bash
# Usage: deploy.sh <ssh-target> <api-image> <static-image> <domain> <api.env> <postgres.env> <known_hosts>
# REGISTRY_USER / REGISTRY_TOKEN are optional for public images. Private images must use GHCR.
set -euo pipefail
[[ $# == 7 ]] || { echo "Usage: $0 SSH_TARGET API_IMAGE STATIC_IMAGE DOMAIN API_ENV POSTGRES_ENV KNOWN_HOSTS" >&2; exit 2; }
admin_host=${ADMIN_HOST:?set ADMIN_HOST}
admin_cert=${ADMIN_ORIGIN_CERT_FILE:?set ADMIN_ORIGIN_CERT_FILE}
admin_key=${ADMIN_ORIGIN_KEY_FILE:?set ADMIN_ORIGIN_KEY_FILE}
[[ -f $admin_cert && -f $admin_key ]] || { echo "Missing admin origin TLS files" >&2; exit 2; }
[[ $admin_host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]] || { echo "Invalid ADMIN_HOST" >&2; exit 2; }
target=$1 api_image=$2 static_image=$3 domain=$4 api_env=$5 postgres_env=$6 known_hosts=$7
# These values enter a Compose env file and the target enters SSH commands.
[[ $target =~ ^[a-z_][a-z0-9_-]*@[0-9.]+$ ]] || { echo "Invalid SSH target" >&2; exit 2; }
[[ $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]] || { echo "Invalid domain" >&2; exit 2; }
for image in "$api_image" "$static_image"; do
  [[ $image =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ ]] || { echo "Expected a tagged GHCR image or digest" >&2; exit 2; }
done
[[ -z ${REGISTRY_TOKEN:-} || ${REGISTRY_USER:-} =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid registry user" >&2; exit 2; }
# Optional bot image and private environment file must be supplied together.
if [[ -n ${BOT_IMAGE:-} || -n ${BOT_ENV_FILE:-} ]]; then
  [[ ${BOT_IMAGE:-} =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ && -f ${BOT_ENV_FILE:-} ]] || { echo "Supply BOT_IMAGE and BOT_ENV_FILE together" >&2; exit 2; }
fi
here=$(cd "$(dirname "$0")" && pwd)
control_dir=$(mktemp -d)
stage=""
# Reuse one TCP connection: UFW limits bursts of new SSH connections, including SCP.
ssh_opts=(-o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -o ConnectTimeout=20
  -o ControlMaster=auto -o ControlPersist=60 -o ControlPath="$control_dir/%C"
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
# Arguments intentionally form the remote command; variable inputs are validated above.
# shellcheck disable=SC2029
remote() { ssh "${ssh_opts[@]}" "$target" "$@"; }
cleanup() {
  if [[ -n $stage ]]; then remote "find '$stage' -depth -delete" || true; fi
  ssh "${ssh_opts[@]}" -O exit "$target" 2>/dev/null || true
  rmdir "$control_dir" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for $target"
for attempt in $(seq 1 30); do
  remote true 2>/dev/null && break
  ((attempt == 30)) && { echo "No SSH to $target" >&2; exit 1; }
  sleep 10
done
remote 'sudo cloud-init status --wait >/dev/null'
# Upload into a private staging directory. release.sh copies files and migrates under
# one remote lock, so simultaneous manual/CI releases cannot mix their environments.
stage=$(remote 'umask 077; mktemp -d /opt/quotedb/.release.XXXXXXXX')
[[ $stage =~ ^/opt/quotedb/\.release\.[a-zA-Z0-9]+$ ]] || { echo "Invalid staging path" >&2; exit 1; }
scp "${ssh_opts[@]}" -q "$here/compose.yaml" "$here/backup.sh" "$here/release.sh" "$here/compose.bot.yaml" "$target:$stage/"
scp "${ssh_opts[@]}" -q "$here/compose.observability.yaml" "$here/../observability/config.alloy" "$here/../observability/container-metrics.sh" "$here/../observability/quotedb-container-metrics.service" "$here/../observability/quotedb-container-metrics.timer" "$target:$stage/"
scp "${ssh_opts[@]}" -q "$here/status-maintenance.py" "$here/maintenance-reboot.sh" "$here/quotedb-reboot.service" "$here/quotedb-reboot.timer" "$target:$stage/"
if [[ -n ${STATUS_MAINTENANCE_FILE:-} ]]; then
  remote "umask 077; cat > '$stage/status-maintenance.json'" < "$STATUS_MAINTENANCE_FILE"
fi
if [[ -n ${OBSERVABILITY_ENV_FILE:-} ]]; then
  remote "umask 077; cat > '$stage/observability.env'" < "$OBSERVABILITY_ENV_FILE"
fi
remote "umask 077; cat > '$stage/admin-origin.crt'" < "$admin_cert"
remote "umask 077; cat > '$stage/admin-origin.key'" < "$admin_key"
remote "umask 077; cat > '$stage/api.env'" < "$api_env"
remote "umask 077; cat > '$stage/postgres.env'" < "$postgres_env"
printf "API_IMAGE='%s'\nSTATIC_IMAGE='%s'\nDOMAIN='%s'\nADMIN_HOST='%s'\n" "$api_image" "$static_image" "$domain" "$admin_host" | remote "umask 077; cat > '$stage/.env'"
if [[ -n ${BOT_IMAGE:-} ]]; then
  remote "umask 077; cat > '$stage/bot.env'" < "$BOT_ENV_FILE"
  printf "BOT_IMAGE='%s'\nCOMPOSE_FILE='compose.yaml:compose.bot.yaml'\nCOMPOSE_PROFILES='discord'\n" "$BOT_IMAGE" | remote "cat >> '$stage/.env'"
fi
if [[ -n ${REGISTRY_TOKEN:-} ]]; then
  remote "umask 077; cat > '$stage/registry-token'" <<<"$REGISTRY_TOKEN"
  remote "umask 077; cat > '$stage/registry-user'" <<<"$REGISTRY_USER"
fi
remote "cd '$stage' && bash release.sh"

for hostname in "api.$domain" "$domain" "app.$domain" "admin.$domain"; do
  path=/
  [[ $hostname != "api.$domain" ]] || path=/healthz
  healthy=false
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 10 "https://$hostname$path" >/dev/null; then
      healthy=true
      break
    fi
    sleep 5
  done
  [[ $healthy == true ]] || { echo "Health check failed: https://$hostname$path" >&2; exit 1; }
done
echo "Deployed configured QuoteDB services"

# Access must challenge anonymous users; do not follow the login redirect.
status=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$admin_host/")
[[ $status == 302 || $status == 303 || $status == 403 ]] || { echo "Admin Access guard failed: HTTP $status" >&2; exit 1; }
