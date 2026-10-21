"""Browser-approved device registration; UI snapshots never contain credentials."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import ssl
import stat
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from app_runtime import APP_ROOT, VERSION, WEBSITE_URL, atomic_json, read_json, validate_config

PENDING_PATH = APP_ROOT / 'enrollment.json'
MAX_BYTES = 8192
TIMEOUT = 6
POLL_INTERVAL = 4
APPROVAL_TTL = 600
RECOVERY_TTL = 86400
ACTIVE_STATES = frozenset(('starting', 'pending', 'network', 'cancelling'))


class EnrollmentError(RuntimeError):
    def __init__(self, reason, retryable=False):
        super().__init__(reason)
        self.reason, self.retryable = reason, retryable


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def post(path, secret, payload):
    """One bounded, authenticated HTTPS request; never follow a redirect."""
    if not re.fullmatch(r'/api/enrollment/(?:start|[a-f0-9]{24}/(?:poll|cancel))', path):
        raise EnrollmentError('invalid-response')
    import certifi
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    request = urllib.request.Request(WEBSITE_URL + path, data=json.dumps(payload).encode(), method='POST', headers={
        'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'MacLink/' + VERSION,
    })
    try:
        with opener.open(request, timeout=TIMEOUT) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise EnrollmentError('invalid-response')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise EnrollmentError('invalid-response')
        return value
    except urllib.error.HTTPError as error:
        if error.code == 409:
            raise EnrollmentError('conflict') from None
        if error.code == 404:
            raise EnrollmentError('not-found') from None
        raise EnrollmentError('network' if error.code == 429 or error.code >= 500 else 'denied', error.code == 429 or error.code >= 500) from None
    except (TimeoutError, OSError, urllib.error.URLError):
        raise EnrollmentError('network', True) from None
    except (ValueError, UnicodeError):
        raise EnrollmentError('invalid-response') from None


def valid_name(value):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 60 and not any(ord(char) < 32 or ord(char) == 127 for char in value)


def verification(response, pending, now):
    expected = WEBSITE_URL + '/connect-mac?request=' + pending['requestId']
    expires = response.get('expiresAt')
    if (response.get('id') != pending['requestId'] or response.get('status') not in ('pending', 'approved')
            or response.get('verificationUrl') != expected or not isinstance(response.get('verificationCode'), str)
            or not re.fullmatch(r'[0-9]{6}', response['verificationCode'])
            or isinstance(expires, bool) or not isinstance(expires, (int, float)) or not 0 < expires < float('inf')
            or response.get('pollInterval') != POLL_INTERVAL):
        raise EnrollmentError('invalid-response')
    return {'verification_url': expected, 'verification_code': str(response['verificationCode']),
            'expires_at': min(expires / 1000, pending['created'] + APPROVAL_TTL)}


class EnrollmentManager:
    """HTTP runs in one owned background thread; AppKit reads snapshots on its timer."""
    def __init__(self, path=PENDING_PATH, request=post, clock=time.time, interval=POLL_INTERVAL):
        self.path, self.request, self.clock, self.interval = Path(path), request, clock, interval
        self.lock = threading.RLock()
        self.stop_event, self.wake_event, self.cancel_event = threading.Event(), threading.Event(), threading.Event()
        self.thread = None
        self.pending = self.result = None
        self.state = {'status': 'idle', 'error': None, 'verification_code': None, 'verification_url': None, 'expires_at': None}

    def _load(self):
        try:
            info = self.path.lstat()
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise EnrollmentError('storage')
        try:
            value = read_json(self.path, MAX_BYTES)
            created = value.get('created')
            if (not isinstance(value, dict) or not valid_name(value.get('name'))
                    or not re.fullmatch(r'[a-f0-9]{24}', value.get('requestId', ''))
                    or any(not re.fullmatch(r'[a-f0-9]{64}', value.get(key, '')) for key in ('pollSecret', 'credentialToken'))
                    or isinstance(created, bool) or not isinstance(created, (int, float))
                    or not -60 <= self.clock() - created
                    or not isinstance(value.get('cancelRequested', False), bool)):
                raise ValueError()
            if self.clock() - created > RECOVERY_TTL + APPROVAL_TTL:
                self.path.unlink()
                return None
            return value
        except (ValueError, TypeError, AttributeError, OSError):
            raise EnrollmentError('storage') from None

    def _set(self, **fields):
        with self.lock:
            self.state.update(fields)

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def approved_config(self):
        with self.lock:
            return dict(self.result) if self.result is not None else None

    def _remove(self):
        # One menu app owns this directory. Never remove a replaced request.
        try:
            saved = self._load()
            if saved and saved['requestId'] == self.pending['requestId']:
                self.path.unlink()
        except FileNotFoundError:
            pass

    def complete(self):
        """Call only after the approved config was atomically saved locally."""
        with self.lock:
            if self.result is None:
                return
            self._remove()
            self.result = None
            self.state.update(status='complete', error=None, verification_code=None, verification_url=None)

    def start(self, name=None, resume_only=False):
        with self.lock:
            if self.thread is not None and self.thread.is_alive() or self.result is not None:
                return False
            pending = self._load()
            if pending is None:
                if resume_only:
                    return False
                if not valid_name(name):
                    raise EnrollmentError('invalid-name')
                pending = {'requestId': secrets.token_hex(12), 'pollSecret': secrets.token_hex(32),
                           'credentialToken': secrets.token_hex(32), 'name': name.strip(), 'created': self.clock()}
                atomic_json(self.path, pending)
            elif pending.get('cancelRequested') and not resume_only:
                # Only a fresh, explicit Connect action may continue an
                # approval that previously conflicted with cancellation.
                pending.pop('cancelRequested')
                atomic_json(self.path, pending)
            self.pending = pending
            self.stop_event.clear(); self.wake_event.clear(); self.cancel_event.clear()
            if pending.get('cancelRequested'):
                self.cancel_event.set()
            self.state = {'status': 'cancelling' if self.cancel_event.is_set() else 'starting', 'error': None,
                          'verification_code': None, 'verification_url': None, 'expires_at': pending['created'] + APPROVAL_TTL}
            self.thread = threading.Thread(target=self._run, name='MacLink registration', daemon=True)
            self.thread.start()
            return True

    def cancel(self):
        with self.lock:
            if self.state['status'] not in ACTIVE_STATES | {'approved'}:
                return False
            had_result = self.result is not None
            self.result = None
            self.pending['cancelRequested'] = True
            atomic_json(self.path, self.pending)
            self.cancel_event.set(); self.wake_event.set()
            self.state.update(status='cancelling', error=None, verification_url=None)
            if had_result:
                previous = self.thread
                def cancel_approved():
                    if previous is not None: previous.join(TIMEOUT + 1)
                    if not self.stop_event.is_set() and self.snapshot()['status'] == 'cancelling': self._run()
                self.thread = threading.Thread(target=cancel_approved, name='MacLink registration cancellation', daemon=True)
                self.thread.start()
            return True

    def shutdown(self):
        # Preserve proof for idempotent recovery after app restart. The browser
        # may have approved while a response or the app was being closed.
        self.stop_event.set(); self.wake_event.set()

    def _wait(self):
        self.wake_event.wait(self.interval)
        self.wake_event.clear()

    def _terminal(self, response):
        if not isinstance(response, dict) or response.get('id') != self.pending['requestId']:
            raise EnrollmentError('invalid-response')
        status = response.get('status')
        if status == 'approved':
            value = response.get('config')
            if not isinstance(value, dict) or value.get('site') != WEBSITE_URL or not valid_name(value.get('name')) or 'token' in value:
                raise EnrollmentError('invalid-response')
            try:
                config = validate_config({**value, 'token': self.pending['credentialToken']})
            except (ValueError, TypeError):
                raise EnrollmentError('invalid-response') from None
            with self.lock:
                if self.cancel_event.is_set(): return False
                self.result = config
                self.state.update(status='approved', error=None, verification_url=None)
            return True
        if status in ('expired', 'cancelled'):
            self._remove()
            self._set(status=status, error=None, verification_url=None, verification_code=None)
            return True
        if status != 'pending':
            raise EnrollmentError('invalid-response')
        return False

    def _cancel_remote(self):
        path = '/api/enrollment/' + self.pending['requestId']
        try:
            return self.request(path + '/cancel', self.pending['pollSecret'], {})
        except EnrollmentError as error:
            if error.reason == 'conflict':
                raise EnrollmentError('cancel-conflict') from None
            if error.reason == 'not-found':
                return {'id': self.pending['requestId'], 'status': 'cancelled'}
            raise

    def _run(self):
        pending = self.pending
        deadline = pending['created'] + APPROVAL_TTL
        try:
            # A past approval deadline still needs a final poll: an approved
            # result remains recoverable for 24 hours with the same proof.
            if self.clock() < deadline and not self.cancel_event.is_set():
                while not self.stop_event.is_set() and not self.cancel_event.is_set():
                    try:
                        response = self.request('/api/enrollment/start', pending['pollSecret'], {
                            'requestId': pending['requestId'], 'name': pending['name'],
                            'credentialHash': hashlib.sha256(pending['credentialToken'].encode()).hexdigest(),
                        })
                        if response.get('status') in ('expired', 'cancelled'):
                            self._terminal(response); return
                        details = verification(response, pending, self.clock())
                        deadline = details['expires_at']
                        self._set(status='pending', error=None, **details)
                        break
                    except EnrollmentError as error:
                        if not error.retryable:
                            raise
                        if self.clock() >= deadline:
                            break
                        self._set(status='network', error=error.reason)
                        self._wait()
            while not self.stop_event.is_set():
                try:
                    if self.cancel_event.is_set():
                        response = self._cancel_remote()
                        if self._terminal(response): return
                        raise EnrollmentError('invalid-response')
                    response = self.request('/api/enrollment/' + pending['requestId'] + '/poll', pending['pollSecret'], {})
                    if self._terminal(response): return
                    if self.cancel_event.is_set(): continue
                    if self.clock() >= deadline:
                        # The server has just confirmed that approval did not
                        # happen; do not discard a result based on our clock.
                        response = self._cancel_remote()
                        if response.get('status') == 'approved':
                            self._terminal(response); return
                        self._remove(); self._set(status='expired', error=None, verification_url=None, verification_code=None)
                        return
                    self._set(status='pending', error=None)
                except EnrollmentError as error:
                    if not error.retryable or self.clock() >= deadline:
                        raise
                    self._set(status='cancelling' if self.cancel_event.is_set() else 'network', error=error.reason)
                self._wait()
        except EnrollmentError as error:
            if not self.stop_event.is_set():
                if error.reason == 'not-found':
                    self._remove(); self._set(status='expired', error=None, verification_url=None, verification_code=None)
                else:
                    self._set(status='failed', error=error.reason, verification_url=None)
        except Exception:
            if not self.stop_event.is_set(): self._set(status='failed', error='storage', verification_url=None)
