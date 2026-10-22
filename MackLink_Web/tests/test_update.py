"""Manual release checks use fake HTTP responses and background work, never UI."""
import json
from pathlib import Path
import sys
import threading
import time
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
from update import INSTALLER_DOWNLOAD, INSTALLER_FILENAME, INSTALLER_MANIFEST, MAX_INSTALLER_BYTES, MAX_RESPONSE_BYTES, RELEASES_API, TIMEOUT, NoRedirect, UpdateChecker, check_latest_release, parse_version


class Response:
    def __init__(self, content, headers=None, status=200):
        self.content, self.limit = content, None
        self.headers, self.status = headers or {}, status
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, limit):
        self.limit = limit
        return self.content[:limit]


class Opener:
    def __init__(self, payload=None, error=None):
        self.response = Response(json.dumps(payload).encode())
        self.error, self.calls = error, []
    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if self.error:
            raise self.error
        return self.response


class PublishedInstaller:
    """GitHub has no Release; its manifest must match the actual website DMG."""
    def __init__(self, manifest=None, headers=None):
        self.manifest = manifest or {'version': '1.4.0', 'filename': INSTALLER_FILENAME, 'size': 50530381, 'sha256': 'a' * 64}
        self.metadata = Response(json.dumps(self.manifest).encode())
        self.binary = Response(b'NEVER READ THE INSTALLER', headers or {'Content-Length': str(self.manifest.get('size')), 'ETag': '"' + str(self.manifest.get('sha256')) + '"'})
        self.calls = []
    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if request.full_url == RELEASES_API:
            raise urllib.error.HTTPError(RELEASES_API, 404, 'No GitHub Release', None, None)
        if request.full_url == INSTALLER_MANIFEST:
            return self.metadata
        if request.full_url == INSTALLER_DOWNLOAD:
            return self.binary
        raise AssertionError('Untrusted update request: ' + request.full_url)


class ReleaseTests(unittest.TestCase):
    def test_published_website_installer_is_available_before_the_first_github_release(self):
        opener = PublishedInstaller()
        self.assertEqual(check_latest_release('1.3.2', opener), {'status': 'available', 'latest': '1.4.0'})
        self.assertEqual([(request.full_url, request.get_method()) for request, _ in opener.calls],
                         [(RELEASES_API, 'GET'), (INSTALLER_MANIFEST, 'GET'), (INSTALLER_DOWNLOAD, 'HEAD')])
        for request, timeout in opener.calls:
            self.assertIsNone(request.data)
            self.assertIsNone(request.get_header('Authorization'))
            self.assertIsNone(request.get_header('Cookie'))
            self.assertEqual(timeout, TIMEOUT)
        self.assertEqual(opener.metadata.limit, MAX_RESPONSE_BYTES + 1)
        self.assertIsNone(opener.binary.limit)  # No binary bytes are downloaded.

    def test_installer_version_never_comes_from_the_local_unpublished_build(self):
        self.assertEqual(check_latest_release('1.4.1', PublishedInstaller()), {'status': 'current', 'latest': '1.4.0'})
        self.assertEqual(check_latest_release('1.4.0', PublishedInstaller()), {'status': 'current', 'latest': '1.4.0'})

    def test_committed_but_unpublished_manifest_is_not_reported_as_an_update(self):
        for headers in ({'Content-Length': '50530381', 'ETag': '"' + 'b' * 64 + '"'},
                        {'Content-Length': '17', 'ETag': '"' + 'a' * 64 + '"'},
                        {'ETag': '"' + 'a' * 64 + '"'}, {'Content-Length': '50530381'},
                        {'Content-Length': '50530381', 'ETag': 'W/"' + 'a' * 64 + '"'}):
            with self.subTest(headers=headers):
                self.assertEqual(check_latest_release('1.3.2', PublishedInstaller(headers=headers)), {'status': 'failed', 'latest': None})

    def test_installer_fallback_validates_stable_version_size_checksum_and_fixed_filename(self):
        original = PublishedInstaller().manifest
        for patch in ({'version': '1.4.1-beta'}, {'version': None}, {'filename': 'https://example.invalid/evil.dmg'},
                      {'size': True}, {'size': 0}, {'size': -1}, {'size': MAX_INSTALLER_BYTES + 1},
                      {'sha256': 'z' * 64}, {'sha256': 'a' * 63}):
            with self.subTest(patch=patch):
                opener = PublishedInstaller({**original, **patch})
                self.assertEqual(check_latest_release('1.3.2', opener), {'status': 'failed', 'latest': None})
                self.assertEqual(len(opener.calls), 2)
        opener = PublishedInstaller({**original, 'url': 'https://example.invalid/evil.dmg', 'parts': [{'path': 'https://example.invalid/'}]})
        self.assertEqual(check_latest_release('1.3.2', opener)['latest'], '1.4.0')
        self.assertEqual(opener.calls[-1][0].full_url, INSTALLER_DOWNLOAD)

    def test_invalid_and_oversized_fallback_json_never_queries_the_installer(self):
        for content in (b'[]', b'null', b'<html>error</html>', b' ' * (MAX_RESPONSE_BYTES + 1)):
            opener = PublishedInstaller(); opener.metadata = Response(content)
            self.assertEqual(check_latest_release('1.3.2', opener), {'status': 'failed', 'latest': None})
            self.assertEqual(len(opener.calls), 2)

    def test_draft_and_prerelease_releases_do_not_count_even_with_a_stable_looking_tag(self):
        for extra in ({'draft': True}, {'prerelease': True}, {'draft': 'false'}, {'prerelease': 0}):
            self.assertEqual(check_latest_release('1.3.2', Opener({'tag_name': 'v9.0.0', **extra})), {'status': 'failed', 'latest': None})

    def test_stable_tag_versions_compare_as_numbers(self):
        for tag in ('1.3.2', 'v1.3.2', 'connector-v1.3.2'):
            self.assertEqual(parse_version(tag), (1, 3, 2))
        for tag in (None, {}, '1.3', 'release-1.3.2', 'v1.3.2-beta', 'v1.3.2\n'):
            self.assertIsNone(parse_version(tag))
        self.assertEqual(check_latest_release('1.9.0', Opener({'tag_name': 'v1.10.0'})),
                         {'status': 'available', 'latest': '1.10.0'})

    def test_fixed_public_get_has_a_timeout_and_ignores_release_urls_and_text(self):
        opener = Opener({'tag_name': 'connector-v1.3.3', 'html_url': 'https://example.invalid/', 'body': 'untrusted'})
        result = check_latest_release('1.3.2', opener)
        self.assertEqual(result, {'status': 'available', 'latest': '1.3.3'})
        self.assertEqual(len(opener.calls), 1)
        request, timeout = opener.calls[0]
        self.assertEqual(request.full_url, RELEASES_API)
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual(timeout, TIMEOUT)
        self.assertEqual(opener.response.limit, MAX_RESPONSE_BYTES + 1)
        self.assertIsNone(NoRedirect().redirect_request(request, None, 302, '', {}, 'https://example.invalid/'))

    def test_equal_or_older_public_release_is_up_to_date(self):
        for tag in ('v1.3.2', 'v1.3.1'):
            self.assertEqual(check_latest_release('1.3.2', Opener({'tag_name': tag}))['status'], 'current')

    def test_not_published_is_distinct_from_http_and_network_failure(self):
        for code in (404, 403, 429, 500):
            error = urllib.error.HTTPError(RELEASES_API, code, 'test', None, None)
            status = check_latest_release('1.3.2', Opener(error=error))['status']
            self.assertEqual(status, 'unpublished' if code == 404 else 'failed')
        for error in (TimeoutError(), urllib.error.URLError('test')):
            self.assertEqual(check_latest_release('1.3.2', Opener(error=error))['status'], 'failed')

    def test_invalid_and_oversized_responses_never_supply_a_version(self):
        for payload in ({}, [], {'tag_name': 'v1.3.2-beta'}, {'tag_name': 'https://example.invalid/'}):
            self.assertEqual(check_latest_release('1.3.2', Opener(payload)), {'status': 'failed', 'latest': None})
        for content in (b'<html>test</html>', b' ' * (MAX_RESPONSE_BYTES + 1)):
            opener = Opener()
            opener.response = Response(content)
            self.assertEqual(check_latest_release('1.3.2', opener), {'status': 'failed', 'latest': None})


class CheckerTests(unittest.TestCase):
    def wait_until_done(self, checker):
        deadline = time.monotonic() + 2
        while checker.snapshot()['status'] == 'checking' and time.monotonic() < deadline:
            time.sleep(.001)
        self.assertNotEqual(checker.snapshot()['status'], 'checking')

    def test_only_explicit_start_checks_and_duplicate_clicks_do_not_block_or_repeat(self):
        entered, finish = threading.Event(), threading.Event()
        calls = []
        def check(version):
            calls.append(version)
            entered.set()
            finish.wait(2)
            return {'status': 'current', 'latest': version}
        checker = UpdateChecker('1.3.2', check=check)
        self.assertEqual(checker.snapshot(), {'status': 'idle', 'latest': None})
        self.assertEqual(calls, [])
        try:
            self.assertTrue(checker.start())
            self.assertTrue(entered.wait(1))
            self.assertEqual(checker.snapshot()['status'], 'checking')
            self.assertFalse(checker.start())
            self.assertEqual(calls, ['1.3.2'])
        finally:
            finish.set()
        self.wait_until_done(checker)
        snapshot = checker.snapshot()
        snapshot['status'] = 'changed'
        self.assertEqual(checker.snapshot(), {'status': 'current', 'latest': '1.3.2'})

    def test_unexpected_background_error_becomes_retryable_failure(self):
        def check(version):
            raise RuntimeError('test')
        checker = UpdateChecker('1.3.2', check=check)
        self.assertTrue(checker.start())
        self.wait_until_done(checker)
        self.assertEqual(checker.snapshot(), {'status': 'failed', 'latest': None})
        self.assertTrue(checker.start())
        self.wait_until_done(checker)


if __name__ == '__main__':
    unittest.main()
