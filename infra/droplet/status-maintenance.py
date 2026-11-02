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


def register(config, reason, opener=None):
    url = config['url']
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Maintenance URL must use HTTPS without embedded credentials')
    secret = config['secret']
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError('Missing maintenance operator secret')
    opener = opener or build_opener(NoRedirect())
    start = int(time.time() * 1000)
    operation = str(uuid.uuid4())
    for component in ('web', 'admin', 'bot', 'api', 'site'):
        body = json.dumps({
            'kind': 'maintenance', 'id': f'{operation}-{component}',
            'component': component, 'start': start, 'end': start + 600_000,
            'note': {'deploy': 'Scheduled application deployment',
                     'reboot': 'Scheduled server restart'}[reason],
        }).encode()
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
                    raise RuntimeError(f'Maintenance registration failed for {component}') from None
                time.sleep(1)
    print('Registered 10 minutes of maintenance for all five services.')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[2] not in ('deploy', 'reboot'):
        sys.exit('Usage: status-maintenance.py CONFIG_JSON deploy|reboot')
    try:
        register(json.loads(Path(sys.argv[1]).read_text()), sys.argv[2])
    except Exception:
        # Never print credentials, request bodies or response bodies.
        sys.exit('Could not register maintenance; interruption cancelled.')
