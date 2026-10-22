"""Manual public release checks; never download or install an application."""
import json
import re
import ssl
import threading
import urllib.error
import urllib.request

RELEASES_API = 'https://api.github.com/repos/fivebellhyun/MacLink/releases/latest'
INSTALLER_MANIFEST = 'https://raw.githubusercontent.com/fivebellhyun/MacLink/main/MackLink_Web/lib/connector-installer-manifest.json'
INSTALLER_DOWNLOAD = 'https://www.maclink.cloud/api/downloads/MacLink-Connector-arm64.dmg'
INSTALLER_FILENAME = 'MacLink-Connector-arm64.dmg'
TIMEOUT = 6
MAX_RESPONSE_BYTES = 64 * 1024
MAX_INSTALLER_BYTES = 4 * 1024 * 1024 * 1024


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


def _request(url, current_version, method='GET'):
    return urllib.request.Request(url, headers={
        'Accept': 'application/json', 'User-Agent': 'MacLink/' + current_version,
    }, method=method)


def _json(opener, url, current_version):
    with opener.open(_request(url, current_version), timeout=TIMEOUT) as response:
        content = response.read(MAX_RESPONSE_BYTES + 1)
    if len(content) > MAX_RESPONSE_BYTES:
        raise ValueError('Update metadata is too large')
    return json.loads(content)


def _installer_version(opener, current_version):
    """A source manifest counts only when it matches the public binary's HEAD.

    The website distributes DMGs before GitHub Releases exist. A committed
    manifest alone may describe an unpublished build, so its checksum and size
    must match the fixed public download. No URL supplied by JSON is opened.
    """
    manifest = _json(opener, INSTALLER_MANIFEST, current_version)
    if not isinstance(manifest, dict):
        raise ValueError('Invalid installer metadata')
    version = parse_version(manifest.get('version'))
    size, checksum = manifest.get('size'), manifest.get('sha256')
    if (version is None or manifest.get('filename') != INSTALLER_FILENAME
            or type(size) is not int or not 0 < size <= MAX_INSTALLER_BYTES
            or not isinstance(checksum, str) or re.fullmatch(r'[0-9a-f]{64}', checksum) is None):
        raise ValueError('Invalid installer metadata')
    with opener.open(_request(INSTALLER_DOWNLOAD, current_version, 'HEAD'), timeout=TIMEOUT) as response:
        length = response.headers.get('Content-Length', '')
        if (response.status != 200 or not re.fullmatch(r'[0-9]+', length) or int(length) != size
                or response.headers.get('ETag') != '"' + checksum + '"'):
            raise ValueError('The public installer does not match its metadata')
    return version


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
        try:
            release = _json(opener, RELEASES_API, current_version)
            if not isinstance(release, dict) or release.get('draft', False) is not False or release.get('prerelease', False) is not False:
                return failed
            latest = parse_version(release.get('tag_name'))
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            latest = _installer_version(opener, current_version)
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
