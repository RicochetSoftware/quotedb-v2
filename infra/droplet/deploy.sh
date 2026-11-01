#!/usr/bin/env bash
# Usage: deploy.sh <ssh-target> <api-image> <static-image> <domain> <api.env> <postgres.env> <known_hosts>
# REGISTRY_USER / REGISTRY_TOKEN are optional for public images. Private images must use GHCR.
set -euo pipefail
[[ $# == 7 ]] || { echo "Usage: $0 SSH_TARGET API_IMAGE STATIC_IMAGE DOMAIN API_ENV POSTGRES_ENV KNOWN_HOSTS" >&2; exit 2; }
target=$1 api_image=$2 static_image=$3 domain=$4 api_env=$5 postgres_env=$6 known_hosts=$7
# These values enter a Compose env file and the target enters SSH commands.
[[ $target =~ ^[a-z_][a-z0-9_-]*@[0-9.]+$ ]] || { echo "Invalid SSH target" >&2; exit 2; }
[[ $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]] || { echo "Invalid domain" >&2; exit 2; }
for image in "$api_image" "$static_image"; do
  [[ $image =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ ]] || { echo "Expected a tagged GHCR image or digest" >&2; exit 2; }
done
[[ -z ${REGISTRY_TOKEN:-} || ${REGISTRY_USER:-} =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid registry user" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
ssh_opts=(-o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -o ConnectTimeout=20)
# Arguments intentionally form the remote command; variable inputs are validated above.
# shellcheck disable=SC2029
remote() { ssh "${ssh_opts[@]}" "$target" "$@"; }

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
cleanup() { remote "find '$stage' -depth -delete" || true; }
trap cleanup EXIT
scp "${ssh_opts[@]}" -q "$here/compose.yaml" "$here/backup.sh" "$here/release.sh" "$target:$stage/"
remote "umask 077; cat > '$stage/api.env'" < "$api_env"
remote "umask 077; cat > '$stage/postgres.env'" < "$postgres_env"
printf "API_IMAGE='%s'\nSTATIC_IMAGE='%s'\nDOMAIN='%s'\n" "$api_image" "$static_image" "$domain" | remote "umask 077; cat > '$stage/.env'"
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
echo "Deployed API and all frontend sites"
