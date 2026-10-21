"""Automatic registration with fake HTTPS and private temporary state only."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
import enrollment as E
from app_runtime import atomic_json, save_imported_config


def pending(created=1000):
    return {'requestId': 'a' * 24, 'pollSecret': 'b' * 64, 'credentialToken': 'c' * 64,
            'name': 'Test Mac', 'created': created}


def started(payload, now=1000, **changes):
    return {'id': payload['requestId'], 'status': 'pending', 'expiresAt': (now + 600) * 1000,
            'verificationCode': '001234', 'verificationUrl': E.WEBSITE_URL + '/connect-mac?request=' + payload['requestId'], 'pollInterval': 4, **changes}


def approved(**changes):
    return {'status': 'approved', 'config': {'site': E.WEBSITE_URL, 'device': 'd' * 24, 'name': 'Test Mac', **changes}}


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'pending.json'

    def manager(self, request, now=1000):
        def contract_request(path, proof, payload):
            response = request(path, proof, payload)
            request_id = payload['requestId'] if path.endswith('/start') else path.split('/')[3]
            return {'id': request_id, **response}
        value = E.EnrollmentManager(self.path, request=contract_request, clock=lambda: now, interval=.005)
        self.addCleanup(value.shutdown)
        return value

    def wait(self, manager, status):
        deadline = time.monotonic() + 2
        while manager.snapshot()['status'] not in status and time.monotonic() < deadline:
            time.sleep(.001)
        self.assertIn(manager.snapshot()['status'], status)

    def test_background_registration_keeps_secrets_private_and_commits_only_after_approval(self):
        calls, threads = [], []
        main_thread = threading.get_ident()
        def request(path, proof, payload):
            calls.append((path, proof, payload)); threads.append(threading.get_ident())
            return started(payload) if path.endswith('/start') else approved()
        manager = self.manager(request)
        self.assertTrue(manager.start('Test Mac'))
        self.wait(manager, {'approved'})
        stored = json.loads(self.path.read_text())
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(len(stored['requestId']), 24)
        self.assertEqual(len(stored['pollSecret']), 64)
        self.assertEqual(len(stored['credentialToken']), 64)
        self.assertEqual(calls[0][2]['credentialHash'], hashlib.sha256(stored['credentialToken'].encode()).hexdigest())
        self.assertNotEqual(stored['pollSecret'], stored['credentialToken'])
        self.assertTrue(all(thread != main_thread for thread in threads))
        safe = repr(manager.snapshot())
        self.assertNotIn(stored['pollSecret'], safe)
        self.assertNotIn(stored['credentialToken'], safe)
        config = manager.approved_config()
        self.assertEqual(config['token'], stored['credentialToken'])
        destination = self.path.with_name('config.json')
        self.assertFalse(destination.exists())
        save_imported_config(config, destination); manager.complete()
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertFalse(self.path.exists())
        self.assertEqual(manager.snapshot()['status'], 'complete')

    def test_duplicate_clicks_do_not_block_or_create_another_request(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def request(path, proof, payload):
            calls.append(path); entered.set(); release.wait(1)
            return started(payload) if path.endswith('/start') else {'status': 'cancelled'}
        manager = self.manager(request)
        try:
            self.assertTrue(manager.start('Test Mac'))
            self.assertTrue(entered.wait(1))
            self.assertFalse(manager.start('Another Mac'))
            self.assertEqual(len(calls), 1)
        finally:
            release.set()
        self.wait(manager, {'cancelled'})

    def test_restart_reuses_proof_and_recovers_approval_after_ten_minute_deadline(self):
        value = pending(1000)
        atomic_json(self.path, value)
        calls = []
        def request(path, proof, payload):
            calls.append((path, proof)); return approved()
        manager = self.manager(request, now=1700)
        self.assertTrue(manager.start(resume_only=True))
        self.wait(manager, {'approved'})
        self.assertEqual(calls, [('/api/enrollment/' + value['requestId'] + '/poll', value['pollSecret'])])
        self.assertEqual(manager.approved_config()['token'], value['credentialToken'])
        self.assertTrue(self.path.exists())

    def test_expiry_is_confirmed_by_server_before_private_request_is_removed(self):
        atomic_json(self.path, pending())
        calls = []
        manager = self.manager(lambda path, proof, payload: (calls.append(path) or {'status': 'expired'}), now=1700)
        manager.start(resume_only=True)
        self.wait(manager, {'expired'})
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0].endswith('/poll'))
        self.assertFalse(self.path.exists())

    def test_explicit_cancel_preserves_existing_device_config(self):
        destination = self.path.with_name('config.json')
        original = {'site': E.WEBSITE_URL, 'device': 'e' * 24, 'token': 'f' * 64, 'name': 'Existing Mac'}
        save_imported_config(original, destination)
        before = destination.read_bytes()
        def request(path, proof, payload):
            if path.endswith('/start'): return started(payload)
            return {'status': 'cancelled' if path.endswith('/cancel') else 'pending'}
        manager = self.manager(request)
        manager.start('Test Mac'); self.wait(manager, {'pending'})
        self.assertTrue(manager.cancel())
        self.wait(manager, {'cancelled'})
        self.assertFalse(self.path.exists())
        self.assertEqual(destination.read_bytes(), before)

    def test_cancel_conflict_never_applies_approval_without_an_explicit_connect_retry(self):
        polls = []
        def request(path, proof, payload):
            if path.endswith('/start'): return started(payload)
            if path.endswith('/cancel'): raise E.EnrollmentError('conflict')
            polls.append(path)
            return approved() if len(polls) > 1 else {'status': 'pending'}
        manager = self.manager(request)
        manager.start('Test Mac'); self.wait(manager, {'pending'})
        # Let the first pending poll finish before explicitly cancelling.
        deadline = time.monotonic() + 1
        while not polls and time.monotonic() < deadline: time.sleep(.001)
        manager.cancel(); self.wait(manager, {'failed'})
        self.assertTrue(self.path.exists())
        self.assertEqual(manager.snapshot()['error'], 'cancel-conflict')
        self.assertIsNone(manager.approved_config())
        manager.thread.join(1)
        self.assertTrue(manager.start('Test Mac'))
        self.wait(manager, {'approved'})
        self.assertEqual(manager.approved_config()['token'], json.loads(self.path.read_text())['credentialToken'])

    def test_shutdown_retains_private_request_for_idempotent_resume(self):
        entered, release = threading.Event(), threading.Event()
        def request(path, proof, payload):
            entered.set(); release.wait(1); return started(payload)
        manager = self.manager(request)
        manager.start('Test Mac'); self.assertTrue(entered.wait(1))
        before = self.path.read_bytes()
        manager.shutdown(); release.set(); manager.thread.join(1)
        self.assertEqual(self.path.read_bytes(), before)
        recovered = self.manager(lambda path, proof, payload: started(payload) if path.endswith('/start') else approved())
        recovered.start(resume_only=True); self.wait(recovered, {'approved'})
        self.assertEqual(recovered.approved_config()['token'], json.loads(before)['credentialToken'])

    def test_network_retry_reuses_original_id_and_hash(self):
        starts = []
        def request(path, proof, payload):
            if path.endswith('/start'):
                starts.append((proof, payload))
                if len(starts) == 1: raise E.EnrollmentError('network', True)
                return started(payload)
            return approved()
        manager = self.manager(request)
        manager.start('Test Mac'); self.wait(manager, {'approved'})
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0], starts[1])

    def test_unsafe_verification_urls_never_reach_ui(self):
        manager = self.manager(lambda path, proof, payload: started(payload, verificationUrl='https://attacker.invalid/?token=unsafe'))
        manager.start('Test Mac'); self.wait(manager, {'failed'})
        self.assertIsNone(manager.snapshot()['verification_url'])
        self.assertIsNone(manager.approved_config())

    def test_approval_for_another_request_is_not_saved(self):
        manager = self.manager(lambda path, proof, payload: started(payload) if path.endswith('/start') else {'id': 'e' * 24, **approved()})
        manager.start('Test Mac'); self.wait(manager, {'failed'})
        self.assertIsNone(manager.approved_config())

    def test_approved_config_rejects_another_site_and_server_supplied_plaintext_token(self):
        for changes in ({'site': 'https://attacker.invalid'}, {'token': 'e' * 64}, {'name': None}):
            with self.subTest(fields=list(changes)):
                if self.path.exists(): self.path.unlink()
                manager = self.manager(lambda path, proof, payload: started(payload) if path.endswith('/start') else approved(**changes))
                manager.start('Test Mac'); self.wait(manager, {'failed'})
                self.assertIsNone(manager.approved_config())

    def test_pending_file_rejects_symlinks_insecure_permissions_and_oversize(self):
        for kind in ('symlink', 'permissions', 'oversize'):
            with self.subTest(kind=kind):
                if self.path.is_symlink() or self.path.exists(): self.path.unlink()
                if kind == 'symlink':
                    destination = self.path.with_name('other.json'); atomic_json(destination, pending()); self.path.symlink_to(destination)
                else:
                    atomic_json(self.path, pending())
                    if kind == 'permissions': self.path.chmod(0o644)
                    else: self.path.write_text('x' * (E.MAX_BYTES + 1))
                manager = self.manager(lambda *args: self.fail('HTTP must not run'))
                with self.assertRaises(E.EnrollmentError): manager.start(resume_only=True)

    def test_resume_without_request_or_empty_name_does_not_create_registration(self):
        manager = self.manager(lambda *args: self.fail('HTTP must not run'))
        self.assertFalse(manager.start(resume_only=True))
        for name in ('', 'a' * 61, 'Mac\nname'):
            with self.assertRaises(E.EnrollmentError): manager.start(name)
        self.assertFalse(self.path.exists())


class Response:
    def __init__(self, value): self.value, self.limit = value, None
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, limit): self.limit = limit; return self.value[:limit]


class HTTPTests(unittest.TestCase):
    def test_post_uses_only_fixed_tls_origin_with_proof_header_bounded_json_and_timeout(self):
        response = Response(b'{"status":"pending"}')
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout; return response
        opener = Opener()
        with patch.object(E.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(E.post('/api/enrollment/start', 'b' * 64, {'name': 'Test'}), {'status': 'pending'})
        self.assertEqual(opener.request.full_url, E.WEBSITE_URL + '/api/enrollment/start')
        self.assertEqual(opener.request.get_header('Authorization'), 'Bearer ' + 'b' * 64)
        self.assertEqual(opener.request.get_header('User-agent'), 'MacLink/1.4.0')
        self.assertEqual(opener.timeout, E.TIMEOUT)
        self.assertEqual(response.limit, E.MAX_BYTES + 1)
        self.assertIsNone(E.NoRedirect().redirect_request(opener.request, None, 307, '', {}, 'https://attacker.invalid/'))
        for path in ('http://attacker.invalid', '/api/enrollment/../../other', '/api/enrollment/start?token=secret'):
            with self.assertRaises(E.EnrollmentError): E.post(path, 'b' * 64, {})

    def test_non_json_and_oversized_responses_are_safe_failures(self):
        for raw in (b'<html>error</html>', b'[]', b' ' * (E.MAX_BYTES + 1)):
            response = Response(raw)
            with patch.object(E.urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = response
                with self.assertRaises(E.EnrollmentError): E.post('/api/enrollment/start', 'b' * 64, {})


if __name__ == '__main__': unittest.main()
