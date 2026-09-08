import base64
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch

import publish_update_log as client


PAYLOAD = {"releaseKey": "commit:abc", "title": "새 기능", "body": "개선 사항\n두 번째 줄"}
KEY = base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")


@contextmanager
def fake_server(status=201, headers=None, raw=None):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            calls.append((self.path, self.headers.get("Authorization"), self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(status)
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(raw if raw is not None else json.dumps({
                "entry": {"id": "12", "publishedAt": "2026-09-08T01:02:03Z"}, "replayed": status == 200,
            }).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class PublishUpdateLogTests(unittest.TestCase):
    def test_key_creation_is_private_exclusive_and_does_not_print_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "key")
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                client.generate_key(path)
            key = client.read_key(path)
            self.assertEqual(len(key), 43)
            self.assertNotIn(key, stdout.getvalue() + stderr.getvalue())
            self.assertIn(hashlib.sha256(key.encode()).hexdigest(), stdout.getvalue())
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(client.PublishError):
                client.generate_key(path)
            self.assertEqual(client.read_key(path), key)
            link = Path(directory, "link")
            link.symlink_to(path)
            with self.assertRaises(client.PublishError):
                client.generate_key(link)

    def test_payload_validation_matches_go_unicode_boundaries(self):
        good = {**PAYLOAD, "title": "\u2003" + "한" * 120 + "\xa0", "body": "한" * 10000}
        self.assertEqual(len(client.normalize_payload(good)["title"]), 120)
        for changes in [{"title": "한" * 121}, {"body": "한" * 10001}, {"title": "\x1cfoo"}, {"body": "\x7f"}, {"body": "\ud800"}, {"title": "a\nb"}, {"releaseKey": "bad\n"}, {"title": None}]:
            with self.subTest(changes=repr(changes)[:60]), self.assertRaises(client.PublishError):
                client.normalize_payload({**PAYLOAD, **changes})
        self.assertEqual(client.normalize_payload({**PAYLOAD, "title": "a\tb", "body": "a\t\r\nb"})["body"], "a\t\r\nb")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "duplicate.json")
            path.write_text('{"releaseKey":"a","title":"first","title":"second","body":"x"}')
            with self.assertRaises(client.PublishError):
                client.read_payload(path)

    def test_dry_run_uses_no_key_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "payload.json")
            path.write_text(json.dumps(PAYLOAD), encoding="utf-8")
            stdout = io.StringIO()
            with patch.object(client, "read_key", side_effect=AssertionError("read secret")), patch.object(client, "publish", side_effect=AssertionError("network")), redirect_stdout(stdout):
                self.assertEqual(client.main(["publish", "--payload", str(path), "--dry-run"]), 0)
            self.assertEqual(json.loads(stdout.getvalue()), PAYLOAD)

    def test_url_requires_https_and_explicit_numeric_loopback_exception(self):
        self.assertEqual(client.endpoint("https://api.example.test/base/"), "https://api.example.test/base/automation/update-logs")
        self.assertEqual(client.endpoint("http://[::1]:8090", True), "http://[::1]:8090/automation/update-logs")
        for url in ["http://127.0.0.1", "https://key@api.example.test", "https://api.example.test?key=x", "https://api.example.test/#x", "https://api.example.test:0", "https://api.example.test\n"]:
            with self.subTest(url=url), self.assertRaises(client.PublishError):
                client.endpoint(url)
        for url in ["http://localhost", "http://192.0.2.1", "file:///tmp/test"]:
            with self.assertRaises(client.PublishError):
                client.endpoint(url, True)

    def test_real_http_request_and_replay_receipt_ignore_environment_proxy(self):
        for status in [201, 200]:
            with fake_server(status) as (base, calls), patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:1", "no_proxy": ""}):
                result = client.publish(PAYLOAD, client.endpoint(base, True), KEY)
                self.assertEqual(result["id"], "12")
                self.assertEqual(result["replayed"], status == 200)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], "/automation/update-logs")
                self.assertEqual(calls[0][1], "Bearer " + KEY)
                self.assertEqual(json.loads(calls[0][2]), PAYLOAD)

    def test_errors_and_redirects_do_not_echo_secrets_or_retry(self):
        for status in [302, 400, 401, 404, 409, 429, 500]:
            with fake_server(status, {"Retry-After": "45", "Location": "/stolen"}, KEY.encode()) as (base, calls):
                with self.assertRaises(client.PublishError) as caught:
                    client.publish(PAYLOAD, client.endpoint(base, True), KEY)
                self.assertNotIn(KEY, str(caught.exception))
                self.assertEqual(len(calls), 1)
                if status == 429:
                    self.assertIn("45초", str(caught.exception))
        raw = json.dumps({"entry": {"id": "12", "publishedAt": KEY}, "replayed": False}).encode()
        with fake_server(raw=raw) as (base, _), self.assertRaises(client.PublishError) as caught:
            client.publish(PAYLOAD, client.endpoint(base, True), KEY)
        self.assertNotIn(KEY, str(caught.exception))

    def test_key_requires_canonical_random_token_shape(self):
        with patch.dict(os.environ, {"PLATFORM_UPDATE_LOG_API_KEY": KEY}):
            self.assertEqual(client.read_key(), KEY)
        for token in ["short", KEY + "=", KEY + "\n", "A" * 42 + "B"]:
            with patch.dict(os.environ, {"PLATFORM_UPDATE_LOG_API_KEY": token}), self.assertRaises(client.PublishError):
                client.read_key()


if __name__ == "__main__":
    unittest.main()
