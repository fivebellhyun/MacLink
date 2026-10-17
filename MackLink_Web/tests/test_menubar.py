"""Menu app config, private IPC and child ownership tests without a GUI/network."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
import app_runtime as runtime


def config(**changes):
    return {'site': 'https://mac.example', 'device': 'a' * 24, 'token': 'b' * 64,
            'name': 'My Mac', 'allow_unattended': False, **changes}


class ConfigurationTests(unittest.TestCase):
    def test_import_is_atomic_private_and_disables_downloaded_unattended_flag(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'MacLink'
            destination = root / 'config.json'
            confirmed = config(allow_unattended=True, extra='ignored')
            saved = runtime.save_imported_config(confirmed, destination)
            self.assertEqual(saved, config())
            self.assertEqual(runtime.load_config(destination), config())
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            self.assertEqual(list(root.iterdir()), [destination])
            runtime.save_imported_config(config(token='c' * 64), destination)
            self.assertEqual(runtime.load_config(destination)['token'], 'c' * 64)

    def test_invalid_import_preserves_existing_key(self):
        bad = [config(site='http://mac.example'), config(site='https://name:secret@mac.example'),
               config(site='https://mac.example/path'), config(site='https://mac.example?token=abc'),
               config(site='https://mac.example/#key'), config(site='https://mac.example:bad'),
               config(site='https://mac.example\\path'), config(site='https://mac.example\n'),
               config(token='x' * 64), config(device='abc'), config(name='unsafe\nname'),
               config(allow_unattended='yes'), [], None]
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / 'config.json'
            runtime.atomic_json(destination, config())
            before = destination.read_bytes()
            for candidate in bad:
                with self.subTest(candidate=candidate):
                    with self.assertRaises(ValueError):
                        runtime.save_imported_config(candidate, destination)
                    self.assertEqual(destination.read_bytes(), before)

    def test_bounded_json_rejects_symlinks_and_nonregular_files(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'key.json'
            path.write_text('x' * (runtime.MAX_CONFIG_BYTES + 1))
            with self.assertRaises(ValueError):
                runtime.load_config(path)
            link = Path(folder) / 'link.json'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                runtime.load_config(link)
            fifo = Path(folder) / 'pipe.json'
            os.mkfifo(fifo)
            with self.assertRaises(ValueError):
                runtime.load_config(fifo)

    def test_confirmed_copy_is_saved_even_if_download_is_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            source, destination = Path(folder) / 'download.json', Path(folder) / 'saved.json'
            runtime.atomic_json(source, config())
            confirmed = runtime.load_config(source)
            runtime.atomic_json(source, config(token='c' * 64))
            runtime.save_imported_config(confirmed, destination)
            self.assertEqual(runtime.load_config(destination)['token'], 'b' * 64)


class StatusTests(unittest.TestCase):
    def test_status_has_no_secrets_and_rejects_other_process_or_old_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'status.json'
            publisher = runtime.StatusPublisher(path, clock=lambda: 100)
            publisher.publish(connection='online', session='active', mode='control', screen=True,
                              token='secret', site='https://secret', peer='a person', accessibility=True)
            written = path.read_text()
            for secret in ('secret', 'token', 'site', 'peer', 'person'):
                self.assertNotIn(secret, written)
            self.assertEqual(runtime.read_status(path, pid=os.getpid(), now=101)['session'], 'active')
            self.assertIsNone(runtime.read_status(path, pid=os.getpid() + 1, now=101))
            self.assertIsNone(runtime.read_status(path, now=111))
            self.assertIsNone(runtime.read_status(path, now=99))
            path.chmod(0o644)
            self.assertIsNone(runtime.read_status(path, now=101))

    def test_bad_or_partial_status_is_ignored(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'status.json'
            for raw in ({}, {'pid': 1, 'updated': 100, 'connection': ['bad']},
                        {'pid': True, 'updated': 100}, {'pid': 1, 'updated': float('nan')}):
                runtime.atomic_json(path, raw)
                self.assertIsNone(runtime.read_status(path, now=100))
            path.write_text('{')
            self.assertIsNone(runtime.read_status(path, now=100))

    def test_throttle_keeps_a_heartbeat_and_publishes_changes_immediately(self):
        now = [100]
        with tempfile.TemporaryDirectory() as folder:
            publisher = runtime.StatusPublisher(Path(folder) / 'status.json', clock=lambda: now[0])
            with patch.object(runtime, 'atomic_json') as writer:
                publisher.publish(connection='online')
                now[0] += .25
                publisher.publish(connection='online')
                self.assertEqual(writer.call_count, 1)
                publisher.publish(connection='reconnecting')
                self.assertEqual(writer.call_count, 2)
                now[0] += 2
                publisher.publish(connection='reconnecting')
                self.assertEqual(writer.call_count, 3)


class LockTests(unittest.TestCase):
    def test_legacy_flock_blocks_new_worker_and_unlock_restores_start(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            legacy = runtime.InstanceLock(root / 'agent.lock')
            self.assertTrue(legacy.acquire())
            self.assertTrue(runtime.worker_running(root))
            legacy.release()
            self.assertFalse(runtime.worker_running(root))
            self.assertEqual(stat.S_IMODE((root / 'agent.lock').stat().st_mode), 0o600)

    def test_menu_lock_blocks_second_process(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'menubar.lock'
            lock = runtime.InstanceLock(path)
            self.assertTrue(lock.acquire())
            script = ('import sys; from pathlib import Path; '
                      'from app_runtime import InstanceLock; '
                      'sys.exit(0 if not InstanceLock(Path(sys.argv[1])).acquire() else 1)')
            child = subprocess.run([sys.executable, '-c', script, str(path)],
                                   env={**os.environ, 'PYTHONPATH': str(Path(runtime.__file__).parent)})
            self.assertEqual(child.returncode, 0)
            lock.release()


class FakeProcess:
    pid = 123
    def __init__(self):
        self.code = None
        self.terminations = 0
        self.kills = 0
    def poll(self): return self.code
    def wait(self): return self.code
    def terminate(self): self.terminations += 1
    def kill(self): self.kills += 1


class LifecycleTests(unittest.TestCase):
    def test_frozen_worker_uses_same_executable_without_system_python(self):
        self.assertEqual(runtime.worker_command(Path('/private/config.json'), '/Applications/MacLink.app/Contents/MacOS/MacLink', frozen=True),
                         ['/Applications/MacLink.app/Contents/MacOS/MacLink', '--worker', '--config', '/private/config.json'])
        self.assertEqual(runtime.worker_command(Path('/private/config.json'), '/python', frozen=False, script='/source/menubar.py'),
                         ['/python', '/source/menubar.py', '--worker', '--config', '/private/config.json'])

    def test_stop_waits_for_child_and_explicit_quit_cancels_pending_restart(self):
        now = [0]
        worker = runtime.WorkerController(clock=lambda: now[0])
        child = FakeProcess()
        worker.process = child
        worker.stop(restart=True)
        self.assertEqual(child.terminations, 1)
        worker.tick()
        self.assertIs(worker.process, child)
        worker.stop(restart=False)
        self.assertFalse(worker.restart_pending)
        self.assertEqual(child.terminations, 1)
        now[0] = 8
        worker.tick()
        self.assertEqual(child.kills, 1)
        child.code = -9
        worker.tick()
        self.assertIsNone(worker.process)
        self.assertEqual(worker.last_exit, 0)

    def test_restart_waits_for_exit_before_starting_replacement(self):
        worker = runtime.WorkerController()
        child = FakeProcess()
        worker.process = child
        with patch.object(worker, 'start') as start:
            worker.stop(restart=True)
            worker.tick()
            start.assert_not_called()
            child.code = 0
            worker.tick()
            start.assert_called_once()
            self.assertFalse(worker.restart_pending)

    def test_live_legacy_worker_prevents_spawn(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'config.json'
            runtime.atomic_json(path, config())
            lock = runtime.InstanceLock(root / 'agent.lock')
            lock.acquire()
            with patch.object(runtime.subprocess, 'Popen') as popen:
                worker = runtime.WorkerController(path, popen=popen)
                with self.assertRaises(RuntimeError): worker.start()
                popen.assert_not_called()
            lock.release()


class LoginTests(unittest.TestCase):
    def test_login_opens_bundle_once_and_does_not_resurrect_explicit_quit(self):
        payload = runtime.login_payload(Path('/Applications/MacLink.app'))
        self.assertEqual(payload['ProgramArguments'], ['/usr/bin/open', '-g', '-a', '/Applications/MacLink.app'])
        self.assertTrue(payload['RunAtLoad'])
        self.assertNotIn('KeepAlive', payload)
        self.assertNotIn('python', ' '.join(payload['ProgramArguments']))

    def test_disable_unregisters_job_and_removes_only_requested_login_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'com.maclink.connector.plist'
            path.write_bytes(b'old')
            with patch.object(runtime.subprocess, 'run') as runner:
                runtime.set_login_enabled(False, path=path, runner=runner)
                args = runner.call_args.args[0]
                self.assertEqual(args[:2], ['/bin/launchctl', 'bootout'])
                self.assertEqual(args[-1], str(path))
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
