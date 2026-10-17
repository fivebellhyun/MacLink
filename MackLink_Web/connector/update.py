"""Manual, read-only checks of the public GitHub release; no app or device state."""
import json
import re
import ssl
import threading
import urllib.error
import urllib.request

RELEASES_API = 'https://api.github.com/repos/fivebellhyun/MacLink/releases/latest'
TIMEOUT = 6
MAX_RESPONSE_BYTES = 64 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def parse_version(value):
    match = re.fullmatch(r'(?:connector-v|v)?([0-9]+)\.([0-9]+)\.([0-9]+)', value) if isinstance(value, str) else None
    if not match:
        return None
    try:
        return tuple(int(part) for part in match.groups())
    except ValueError:
        return None


def check_latest_release(current_version, opener=None):
    failed = {'status': 'failed', 'latest': None}
    current = parse_version(current_version)
    if current is None:
        return failed
    try:
        if opener is None:
            import certifi
            opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
                context=ssl.create_default_context(cafile=certifi.where())))
        request = urllib.request.Request(RELEASES_API, headers={
            'Accept': 'application/json', 'User-Agent': 'MacLink/' + current_version,
        })
        with opener.open(request, timeout=TIMEOUT) as response:
            content = response.read(MAX_RESPONSE_BYTES + 1)
        if len(content) > MAX_RESPONSE_BYTES:
            return failed
        release = json.loads(content)
        latest = parse_version(release.get('tag_name')) if isinstance(release, dict) else None
        if latest is None:
            return failed
        return {'status': 'available' if latest > current else 'current',
                'latest': '.'.join(str(part) for part in latest)}
    except urllib.error.HTTPError as error:
        return {'status': 'unpublished', 'latest': None} if error.code == 404 else failed
    except (OSError, ValueError, TypeError):
        return failed


class UpdateChecker:
    """A button starts one daemon thread; the existing UI timer reads snapshots."""
    def __init__(self, current_version, check=check_latest_release):
        self.current_version, self.check = current_version, check
        self.lock = threading.Lock()
        self.result = {'status': 'idle', 'latest': None}

    def snapshot(self):
        with self.lock:
            return dict(self.result)

    def start(self):
        with self.lock:
            if self.result['status'] == 'checking':
                return False
            self.result = {'status': 'checking', 'latest': None}
        try:
            threading.Thread(target=self._run, daemon=True).start()
        except RuntimeError:
            with self.lock:
                self.result = {'status': 'failed', 'latest': None}
            return False
        return True

    def _run(self):
        try:
            result = self.check(self.current_version)
        except Exception:
            result = {'status': 'failed', 'latest': None}
        with self.lock:
            self.result = result
