"""Tests for the pincite review page's local write server.

The server is driven as a SUBPROCESS over real HTTP, never imported. That is the
transport the browser uses, and it means an absent server fails as a refused
connection rather than as an ImportError.

The cross-origin cases exist because the POST path is a write primitive reachable
from any page the browser has open: a server that accepts a text/plain POST needs
no CORS preflight, so any page could atomically replace a sitting's decisions.
"""

import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import unittest

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE = os.path.join(SKILL, "assets", "review", "serve.py")

# Free text, as the manuscript already contains it: an en-dash range, a Federal
# Register page with a comma, and a preprint's manuscript pagination.
SAMPLE = [
    {"fn": 12, "citekey": "Easterbrook1983", "occurrence": 1,
     "action": "set", "pin": "1279--81", "note": ""},
    {"fn": 44, "citekey": "SECRelease2020", "occurrence": 2,
     "action": "set", "pin": "55,086", "note": "FR page"},
    {"fn": 91, "citekey": "Bebchuk2019", "occurrence": 1,
     "action": "set", "pin": "(manuscript at 66)", "note": ""},
]
JSON_CT = "application/json"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_review_scratch")
        shutil.rmtree(self.root, ignore_errors=True)
        os.makedirs(os.path.join(self.root, "paper", "references"))
        # Bibliography PDFs really do carry spaces in their filenames.
        with open(os.path.join(self.root, "paper", "references",
                               "Easterbrook 1983 - Voting in Corporate Law.pdf"), "wb") as f:
            f.write(b"%PDF-1.4 static-ok")

        self.port = free_port()
        self.origin = f"http://127.0.0.1:{self.port}"
        self.proc = subprocess.Popen(
            [sys.executable, SERVE, str(self.port), self.root],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._await_server()

    def _await_server(self, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                stderr = self.proc.stderr
                err = stderr.read().decode("utf8", "replace") if stderr else ""
                self.fail("server exited before accepting connections:\n" + err)
            try:
                with socket.create_connection(("127.0.0.1", self.port), 0.2):
                    return
            except OSError:
                time.sleep(0.05)
        self.fail(f"server did not accept connections within {timeout:.1f}s")

    def tearDown(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.root, ignore_errors=True)

    def raw_post(self, path, body, headers=None):
        """POST with full control of headers — urllib cannot forge Sec-Fetch-Site."""
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode()
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("POST", path, body, headers or {"Content-Type": JSON_CT})
            r = conn.getresponse()
            r.read()
            return r.status
        finally:
            conn.close()

    def same_origin_post(self, body, path="/pincites.json"):
        return self.raw_post(
            path,
            body,
            {"Content-Type": JSON_CT, "Origin": self.origin, "Sec-Fetch-Site": "same-origin"},
        )

    def pincites_path(self):
        return os.path.join(self.root, "pincites.json")

    def read_pincites(self):
        with open(self.pincites_path()) as f:
            return json.load(f)

    def snapshot(self):
        if not os.path.exists(self.pincites_path()):
            return None
        with open(self.pincites_path(), "rb") as f:
            return f.read()

    def assert_untouched(self, before):
        """The file must be byte-identical, or still absent."""
        if before is None:
            self.assertFalse(os.path.exists(self.pincites_path()),
                             "a refused POST created the file")
        else:
            with open(self.pincites_path(), "rb") as f:
                self.assertEqual(f.read(), before, "a refused POST modified the file")


class TestWrite(ServerCase):
    def test_same_origin_json_post_reaches_disk(self):
        self.assertEqual(self.same_origin_post(SAMPLE), 200)
        self.assertEqual(self.read_pincites(), SAMPLE)

    def test_free_text_pincites_round_trip_unchanged(self):
        """The server validates JSON, never citation form."""
        self.same_origin_post(SAMPLE)
        pins = [row["pin"] for row in self.read_pincites()]
        self.assertEqual(pins, ["1279--81", "55,086", "(manuscript at 66)"])

    def test_post_overwrites_existing(self):
        self.same_origin_post(SAMPLE)
        second = [{"fn": 1, "citekey": "Only", "occurrence": 1,
                   "action": "skip", "pin": "", "note": "later"}]
        self.assertEqual(self.same_origin_post(second), 200)
        self.assertEqual(self.read_pincites(), second)

    def test_write_is_atomic_never_truncates(self):
        """Fails if the server truncates-then-writes: os.replace changes the inode."""
        self.same_origin_post(SAMPLE)
        first_inode = os.stat(self.pincites_path()).st_ino
        big = [dict(SAMPLE[0], fn=i) for i in range(400)]
        self.same_origin_post(big)
        self.assertEqual(self.read_pincites(), big)
        self.assertNotEqual(
            first_inode,
            os.stat(self.pincites_path()).st_ino,
            "destination was written in place; an interrupted write would truncate it",
        )

    def test_no_temp_files_left_behind(self):
        self.same_origin_post(SAMPLE)
        leftovers = [n for n in os.listdir(self.root) if n.endswith(".tmp")]
        self.assertEqual(leftovers, [])


class TestCrossOrigin(ServerCase):
    """The class of attack that a same-origin-only suite cannot see."""

    def test_text_plain_post_is_refused(self):
        """text/plain is CORS-simple: no preflight, so any page can send it."""
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post("/pincites.json", b'[{"wiped": true}]',
                               {"Content-Type": "text/plain"})
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_form_urlencoded_post_is_refused(self):
        """The other CORS-simple type an ordinary <form> can send."""
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post(
            "/pincites.json", b'[{"wiped": true}]',
            {"Content-Type": "application/x-www-form-urlencoded"},
        )
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_cross_site_fetch_metadata_is_refused(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post(
            "/pincites.json", [{"wiped": True}],
            {"Content-Type": JSON_CT, "Origin": self.origin, "Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_foreign_origin_is_refused(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post(
            "/pincites.json", [{"wiped": True}],
            {"Content-Type": JSON_CT, "Origin": "http://evil.example"},
        )
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_loopback_origin_on_another_port_is_refused(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post(
            "/pincites.json", [{"wiped": True}],
            {"Content-Type": JSON_CT, "Origin": f"http://127.0.0.1:{self.port + 1}"},
        )
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_missing_origin_is_refused(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post("/pincites.json", [{"wiped": True}], {"Content-Type": JSON_CT})
        self.assertEqual(status, 403)
        self.assert_untouched(before)

    def test_missing_content_type_is_refused(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post("/pincites.json", b'[{"wiped": true}]', {})
        self.assertEqual(status, 403)
        self.assert_untouched(before)


class TestRejects(ServerCase):
    def test_malformed_body_returns_400_and_preserves_file(self):
        self.same_origin_post(SAMPLE)
        before = self.snapshot()
        status = self.raw_post(
            "/pincites.json", b"{not json at all",
            {"Content-Type": JSON_CT, "Origin": self.origin, "Sec-Fetch-Site": "same-origin"},
        )
        self.assertEqual(status, 400)
        self.assert_untouched(before)

    def test_post_to_other_path_is_not_written(self):
        self.assertEqual(self.same_origin_post(SAMPLE, path="/elsewhere.json"), 404)
        self.assertFalse(os.path.exists(os.path.join(self.root, "elsewhere.json")))

    def test_traversing_post_target_is_refused(self):
        outside = os.path.join(os.path.dirname(self.root), "escaped.json")
        if os.path.exists(outside):
            os.remove(outside)
        status = self.same_origin_post(SAMPLE, path="/../escaped.json")
        self.assertNotEqual(status, 200)
        self.assertFalse(os.path.exists(outside), "POST escaped the server root")

    def test_oversized_body_is_refused(self):
        before = self.snapshot()
        huge = b'[{"x": "' + b"a" * (64 * 1024 * 1024) + b'"}]'
        try:
            status = self.raw_post(
                "/pincites.json", huge,
                {"Content-Type": JSON_CT, "Origin": self.origin, "Sec-Fetch-Site": "same-origin"},
            )
        except (http.client.HTTPException, OSError):
            status = None  # server closing the connection is an acceptable refusal
        if status is not None:
            self.assertNotEqual(status, 200)
        self.assert_untouched(before)


class TestStatic(ServerCase):
    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("GET", path)
            r = conn.getresponse()
            return r.status, r.read()
        finally:
            conn.close()

    def test_get_serves_a_pdf_whose_filename_has_spaces(self):
        """The page builds PDF URLs with encodeURIComponent per path segment."""
        status, body = self.get(
            "/paper/references/Easterbrook%201983%20-%20Voting%20in%20Corporate%20Law.pdf"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, b"%PDF-1.4 static-ok")

    def test_get_reads_back_what_the_post_wrote(self):
        self.same_origin_post(SAMPLE)
        status, body = self.get("/pincites.json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), SAMPLE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
