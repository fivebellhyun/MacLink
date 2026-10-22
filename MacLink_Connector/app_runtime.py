"""Private local state and lifecycle helpers for the MacLink menu bar app.

This module deliberately imports no macOS GUI or remote desktop dependencies, so
configuration, IPC and process ownership can be verified without a desktop.
"""
from __future__ import annotations

import fcntl
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

VERSION = '1.4.1'
WEBSITE_URL = 'https://www.maclink.cloud'
APP_ROOT = Path.home() / 'Library/Application Support/MacLink'
CONFIG_PATH = APP_ROOT / 'config.json'
STATUS_PATH = APP_ROOT / 'status.json'
LOG_PATH = APP_ROOT / 'connector.log'
LOGIN_PATH = Path.home() / 'Library/LaunchAgents/com.maclink.connector.plist'
MAX_CONFIG_BYTES = 32 * 1024
MAX_STATUS_BYTES = 4096


def private_directory(path: Path) -> Path:
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
        raise ValueError('MacLink data folder must be owned by the current user.')
    os.chmod(path, 0o700)
    return path


def read_json(path: Path, limit: int):
    """Read a bounded regular file; never follow a final-component symlink."""
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError('The selected file is not a valid MacLink JSON file.')
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('The selected file is too large.')
        return json.loads(raw)


def validate_config(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError('The device key file must contain a JSON object.')
    site, device, token = (raw.get(key) for key in ('site', 'device', 'token'))
    if not all(isinstance(value, str) for value in (site, device, token)):
        raise ValueError('The device key file is missing a website, device, or key.')
    try:
        url = urlparse(site)
        valid_url = (len(site) <= 2048 and '\\' not in site and url.scheme == 'https' and bool(url.hostname) and url.path in ('', '/')
                     and not url.query and not url.fragment and not url.username and not url.password
                     and not any(ord(char) <= 32 or ord(char) == 127 for char in site))
        url.port  # Reject malformed ports before the file is saved.
    except ValueError:
        valid_url = False
    if not valid_url:
        raise ValueError('The website must be a base HTTPS address without credentials.')
    if not re.fullmatch(r'[a-f0-9]{24}', device) or not re.fullmatch(r'[a-f0-9]{64}', token):
        raise ValueError('The device key is invalid. Download a new key from your website.')
    name = raw.get('name', 'MacBook')
    if not isinstance(name, str) or not name.strip() or len(name) > 120 or any(ord(char) < 32 for char in name):
        raise ValueError('The device name is invalid.')
    return {'site': site.rstrip('/'), 'device': device, 'token': token,
            'name': name.strip()}


def load_config(path: Path = CONFIG_PATH) -> dict:
    return validate_config(read_json(path, MAX_CONFIG_BYTES))


def atomic_json(path: Path, payload: dict) -> None:
    parent = private_directory(Path(path).parent)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + Path(path).name + '-', dir=parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(payload, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save_imported_config(config: dict, destination: Path = CONFIG_PATH) -> dict:
    """Save only the confirmed device registration fields."""
    config = validate_config(config)
    atomic_json(destination, config)
    return config


def import_config(source: Path, destination: Path = CONFIG_PATH) -> dict:
    return save_imported_config(load_config(source), destination)


class InstanceLock:
    """One menu app or one worker per configuration directory, including legacy workers."""
    def __init__(self, path: Path):
        self.path = Path(path)
        self.fd = None

    def acquire(self) -> bool:
        if self.fd is not None:
            return True
        private_directory(self.path.parent)
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            os.fchmod(fd, 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd
        return True

    def release(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def worker_running(root: Path = APP_ROOT) -> bool:
    probe = InstanceLock(Path(root) / 'agent.lock')
    available = probe.acquire()
    probe.release()
    return not available


CONNECTION_STATES = {'starting', 'connecting', 'online', 'reconnecting', 'stopped', 'error'}
SESSION_STATES = {'idle', 'approved', 'active', 'paused'}
STATUS_ERRORS = {'none', 'revoked', 'network', 'startup', 'permission', 'worker_exit'}


def clean_status(raw) -> dict:
    """Allowlist IPC fields. No tokens, URLs, session IDs, or arbitrary errors reach disk."""
    if not isinstance(raw, dict):
        raise ValueError('Invalid status.')
    result = {}
    for key, allowed in (('connection', CONNECTION_STATES), ('session', SESSION_STATES), ('error', STATUS_ERRORS)):
        value = raw.get(key, 'none' if key == 'error' else 'idle' if key == 'session' else 'starting')
        if value not in allowed:
            raise ValueError('Invalid status field.')
        result[key] = value
    for key in ('screen', 'accessibility'):
        result[key] = raw.get(key) is True
    mode = raw.get('mode')
    result['mode'] = mode if mode in ('view', 'control') else None
    pid = raw.get('pid')
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        raise ValueError('Invalid status process.')
    result['pid'] = pid
    updated = raw.get('updated')
    if isinstance(updated, bool) or not isinstance(updated, (float, int)) or not 0 < updated < float('inf'):
        raise ValueError('Invalid status time.')
    result['updated'] = updated
    return result


class StatusPublisher:
    def __init__(self, path: Path, clock=time.time):
        self.path, self.clock, self.last, self.last_write = Path(path), clock, None, 0

    def publish(self, **fields):
        now = self.clock()
        status = clean_status({**fields, 'pid': os.getpid(), 'updated': now})
        comparable = {key: value for key, value in status.items() if key != 'updated'}
        if comparable != self.last or now - self.last_write >= 2:
            atomic_json(self.path, status)
            self.last, self.last_write = comparable, now


def read_status(path: Path = STATUS_PATH, pid=None, now=None, max_age=10) -> dict | None:
    try:
        info = Path(path).lstat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            return None
        status = clean_status(read_json(path, MAX_STATUS_BYTES))
        age = (time.time() if now is None else now) - status['updated']
        if not 0 <= age <= max_age or (pid is not None and status['pid'] != pid):
            return None
        return status
    except (OSError, ValueError, TypeError):
        return None


def worker_command(config: Path, executable=None, frozen=None, script=None) -> list[str]:
    executable = executable or sys.executable
    frozen = getattr(sys, 'frozen', False) if frozen is None else frozen
    command = [str(executable)]
    if not frozen:
        command.append(str(script or Path(__file__).with_name('menubar.py')))
    return command + ['--worker', '--config', str(config)]


class WorkerController:
    """Own only the child we spawned; never signal a PID read from disk."""
    def __init__(self, config=CONFIG_PATH, popen=subprocess.Popen, clock=time.monotonic):
        self.config, self.popen, self.clock = Path(config), popen, clock
        self.process = None
        self.stop_deadline = None
        self.restart_pending = False
        self.log_stream = None
        self.last_exit = None
        self.last_pid = None

    def start(self):
        if self.process is not None:
            if self.process.poll() is None:
                return False
            self.tick()
        load_config(self.config)
        if worker_running(self.config.parent):
            raise RuntimeError('Another MacLink connector is running. Stop the old Terminal or login connector first.')
        private_directory(LOG_PATH.parent)
        fd = os.open(LOG_PATH, os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        os.fchmod(fd, 0o600)
        self.log_stream = os.fdopen(fd, 'ab', buffering=0)
        try:
            self.process = self.popen(worker_command(self.config), stdin=subprocess.DEVNULL,
                                      stdout=self.log_stream, stderr=self.log_stream, close_fds=True)
        except BaseException:
            self.log_stream.close()
            self.log_stream = None
            raise
        self.stop_deadline, self.last_exit, self.last_pid = None, None, self.process.pid
        return True

    def stop(self, restart=False):
        self.restart_pending = restart
        if self.process is None:
            if restart:
                self.restart_pending = False
                self.start()
            return
        if self.stop_deadline is None and self.process.poll() is None:
            self.process.terminate()
            self.stop_deadline = self.clock() + 8

    def tick(self):
        if self.process is None:
            return
        code = self.process.poll()
        if code is None:
            if self.stop_deadline is not None and self.clock() >= self.stop_deadline:
                self.process.kill()
            return
        self.process.wait()
        self.last_exit = 0 if self.stop_deadline is not None else code
        self.process = None
        self.stop_deadline = None
        if self.log_stream:
            self.log_stream.close()
            self.log_stream = None
        if self.restart_pending:
            self.restart_pending = False
            self.start()


def bundle_path(executable=None) -> Path | None:
    path = Path(executable or sys.executable).resolve()
    for parent in path.parents:
        if parent.suffix == '.app':
            return parent
    return None


def login_payload(app: Path | None = None) -> dict:
    app = app or bundle_path()
    args = ['/usr/bin/open', '-g', '-a', str(app)] if app else [sys.executable, str(Path(__file__).with_name('menubar.py'))]
    # open exits immediately. KeepAlive would repeatedly reopen after an explicit Quit.
    return {'Label': 'com.maclink.connector', 'ProgramArguments': args,
            'RunAtLoad': True, 'ProcessType': 'Interactive'}


def login_enabled(path=LOGIN_PATH) -> bool:
    try:
        with Path(path).open('rb') as stream:
            payload = plistlib.load(stream)
        return payload == login_payload()
    except (OSError, ValueError, plistlib.InvalidFileException):
        return False


def set_login_enabled(enabled: bool, path=LOGIN_PATH, runner=subprocess.run):
    path = Path(path)
    domain = 'gui/' + str(os.getuid())
    if not enabled:
        runner(['/bin/launchctl', 'bootout', domain, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.maclink-login-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            plistlib.dump(login_payload(), stream)
        runner(['/bin/launchctl', 'bootout', domain, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        os.replace(temporary, path)
        runner(['/bin/launchctl', 'bootstrap', domain, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
