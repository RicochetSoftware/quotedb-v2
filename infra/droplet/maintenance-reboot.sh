#!/usr/bin/env bash
# Only reboot when updates require it, and never overlap a deployment.
set -euo pipefail
cd /opt/quotedb
exec 9>.deploy.lock
flock -w 600 9
[[ -f /var/run/reboot-required ]] || exit 0
python3 ./status-maintenance.py ./status-maintenance.json reboot
systemctl reboot
