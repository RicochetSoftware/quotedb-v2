#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
gcx config current-context
gcx resources validate -p "$here/grafana" -o json
gcx resources push -p "$here/grafana"
# Stable UIDs make rule provisioning repeatable. Existing routing remains unchanged.
for rule in "$here"/alerts/*.json; do
  uid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uid"])' "$rule")
  if gcx api "/api/v1/provisioning/alert-rules/$uid" -o json >/dev/null 2>&1; then
    gcx api "/api/v1/provisioning/alert-rules/$uid" -X PUT -d "@$rule" -o json >/dev/null
  else
    gcx api /api/v1/provisioning/alert-rules -d "@$rule" -o json >/dev/null
  fi
done
