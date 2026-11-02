import importlib.util
import json
import unittest
import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location(
    'maintenance', Path(__file__).with_name('status-maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


class MaintenanceTests(unittest.TestCase):
    config = {'url': 'https://status.example.com/operator', 'secret': 'x' * 32}

    def opener(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.status = 204
        return opener

    def test_all_components_have_bounded_window_and_authenticated_request(self):
        opener = self.opener()
        with patch.object(maintenance.time, 'time', return_value=1000):
            maintenance.register(self.config, 'deploy', opener)
        requests = [call.args[0] for call in opener.open.call_args_list]
        bodies = [json.loads(request.data) for request in requests]
        self.assertEqual({b['component'] for b in bodies}, {'web', 'admin', 'bot', 'api', 'site'})
        self.assertEqual(len({b['id'] for b in bodies}), 5)
        for request, body in zip(requests, bodies):
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + 'x' * 32)
            self.assertEqual(request.get_header('User-agent'), 'QuoteDB-Maintenance/1.0')
            self.assertEqual(body['start'], 1_000_000)
            self.assertEqual(body['end'] - body['start'], 600_000)

    def test_retry_preserves_id_and_window(self):
        opener = self.opener()
        response = opener.open.return_value
        opener.open.side_effect = [URLError('offline'), response, response, response, response, response]
        with patch.object(maintenance.time, 'sleep'):
            maintenance.register(self.config, 'reboot', opener)
        first, retry = [c.args[0] for c in opener.open.call_args_list[:2]]
        self.assertEqual(first.data, retry.data)
        self.assertEqual(json.loads(first.data)['note'], 'Scheduled server restart')

    def test_registration_failure_aborts_without_leaking_secret(self):
        opener = self.opener()
        opener.open.side_effect = URLError(self.config['secret'])
        with patch.object(maintenance.time, 'sleep'):
            with self.assertRaises(RuntimeError) as error:
                maintenance.register(self.config, 'deploy', opener)
        self.assertNotIn(self.config['secret'], str(error.exception))
        self.assertEqual(opener.open.call_count, 3)

    def test_refuses_insecure_url_before_sending_credentials(self):
        opener = self.opener()
        with self.assertRaises(ValueError):
            maintenance.register({**self.config, 'url': 'http://example.com'}, 'deploy', opener)
        opener.open.assert_not_called()

    def test_finish_uses_persisted_ids_and_retries_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'active.json'
            opener = self.opener()
            maintenance.register(self.config, 'reboot', opener, state)
            maintenance.register(self.config, 'deploy', opener, state)
            ids = json.loads(state.read_text())
            self.assertEqual(len(ids), 10)
            failed = self.opener()
            failed.open.side_effect = URLError('offline')
            with patch.object(maintenance.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    maintenance.finish(self.config, state, failed)
            self.assertTrue(state.exists())
            finish = self.opener()
            maintenance.finish(self.config, state, finish)
            bodies = [json.loads(c.args[0].data) for c in finish.open.call_args_list]
            self.assertEqual([b['id'] for b in bodies], ids)
            self.assertTrue(all(b['kind'] == 'maintenance-recovery' for b in bodies))
            self.assertFalse(state.exists())

    def test_redirects_are_not_followed(self):
        self.assertIsNone(maintenance.NoRedirect().redirect_request(
            None, None, 307, '', {}, 'https://other.example.com'))


class InterruptionTests(unittest.TestCase):
    def run_script(self, script, registration_exit, required=True, docker_exit=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'status-maintenance.json').write_text('{}')
            if required:
                (root / 'reboot-required').touch()
            for command in ('python3', 'systemctl', 'docker', 'flock'):
                code = registration_exit if command == 'python3' else docker_exit if command == 'docker' else 0
                path = root / command
                path.write_text(f'#!/bin/sh\necho {command} >> "$CALL_LOG"\nexit {code}\n')
                path.chmod(0o700)
            script = script.replace('/opt/quotedb', directory).replace(
                '/var/run/reboot-required', str(root / 'reboot-required'))
            result = subprocess.run(['bash', '-euc', script], cwd=root, capture_output=True,
                                    env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'],
                                         'CALL_LOG': str(root / 'calls')})
            calls = (root / 'calls').read_text().splitlines() if (root / 'calls').exists() else []
            return result.returncode, calls

    def test_reboot_requires_successful_registration(self):
        script = Path(__file__).with_name('maintenance-reboot.sh').read_text()
        code, calls = self.run_script(script, 1)
        self.assertNotEqual(code, 0)
        self.assertNotIn('systemctl', calls)
        code, calls = self.run_script(script, 0)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ['flock', 'python3', 'systemctl'])

    def test_no_pending_reboot_creates_no_maintenance(self):
        script = Path(__file__).with_name('maintenance-reboot.sh').read_text()
        code, calls = self.run_script(script, 0, required=False)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ['flock'])

    def test_release_requests_recovery_only_after_compose_health_passes(self):
        release = Path(__file__).with_name('release.sh').read_text()
        script = 'docker compose up -d --remove-orphans' + release.split(
            'docker compose up -d --remove-orphans', 1)[1].split('# Keep recent images', 1)[0]
        code, calls = self.run_script(script, 0, docker_exit=1)
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, ['docker'])
        code, calls = self.run_script(script, 0)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ['docker', 'python3'])

    def test_release_cannot_replace_postgres_without_registration(self):
        release = Path(__file__).with_name('release.sh').read_text()
        script = release.split('# Register after pulls,', 1)[1].split('# Ownership migrations', 1)[0]
        script = '# Register after pulls,' + script
        code, calls = self.run_script(script, 1)
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, ['python3'])
        code, calls = self.run_script(script, 0)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ['python3', 'docker'])


if __name__ == '__main__':
    unittest.main()
