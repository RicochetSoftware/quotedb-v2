#!/usr/bin/env python3
"""Register a bounded maintenance window before interrupting the stack."""
import json
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(config, bodies, opener=None):
    url = config['url']
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Maintenance URL must use HTTPS without embedded credentials')
    secret = config['secret']
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError('Missing maintenance operator secret')
    opener = opener or build_opener(NoRedirect())
    for payload in bodies:
        body = json.dumps(payload).encode()
        request = Request(url, data=body, headers={
            'Authorization': f'Bearer {secret}', 'Content-Type': 'application/json',
            'User-Agent': 'QuoteDB-Maintenance/1.0',
        }, method='POST')
        # Reuse the operation ID on retries: the operator API is idempotent.
        for attempt in range(3):
            try:
                with opener.open(request, timeout=5) as response:
                    if response.status != 204:
                        raise ValueError('Unexpected maintenance response')
                break
            except (HTTPError, URLError, TimeoutError):
                if attempt == 2:
                    raise RuntimeError('Maintenance operation failed') from None
                time.sleep(1)


def register(config, reason, opener=None, state_path=None):
    start = int(time.time() * 1000)
    operation = str(uuid.uuid4())
    bodies = [{
        'kind': 'maintenance', 'id': f'{operation}-{component}',
        'component': component, 'start': start, 'end': start + 600_000,
        'note': {'deploy': 'Scheduled application deployment',
                 'reboot': 'Scheduled server restart'}[reason],
    } for component in ('web', 'admin', 'bot', 'api', 'site')]
    if state_path:
        # Persist before sending so a reboot cannot lose the IDs.
        state_path.write_text(json.dumps([body['id'] for body in bodies]))
    send(config, bodies, opener)
    print('Registered maintenance with a ten-minute maximum.')


def finish(config, state_path, opener=None):
    if not state_path.exists():
        return
    ids = json.loads(state_path.read_text())
    send(config, [{'kind': 'maintenance-recovery', 'id': item, 'note': ''} for item in ids], opener)
    state_path.unlink()
    print('Recovery requested; fresh healthy probes will close maintenance.')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[2] not in ('deploy', 'reboot', 'finish'):
        sys.exit('Usage: status-maintenance.py CONFIG_JSON deploy|reboot|finish')
    try:
        config_path = Path(sys.argv[1])
        config = json.loads(config_path.read_text())
        state_path = config_path.with_suffix('.active.json')
        if sys.argv[2] == 'finish':
            finish(config, state_path)
        else:
            register(config, sys.argv[2], state_path=state_path)
    except Exception:
        sys.exit('Maintenance operation failed; existing windows retain their expiry.')
