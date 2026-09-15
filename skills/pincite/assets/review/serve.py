#!/usr/bin/env python3
"""Local write server for the pincite review page.

Serves a directory over HTTP exactly as ``python3 -m http.server`` does, and
additionally accepts ``POST /pincites.json`` from the review page, persisting the
body atomically to ``pincites.json`` in the served directory.

Usage: serve.py [port] [manuscript-root]

Serve the MANUSCRIPT ROOT, not ``scratch/review/``. The page loads each source PDF
by a path relative to the served root, so serving the page's own directory leaves
every PDF unreachable.

The POST path is a write primitive reachable from any page the browser has open, so
it is guarded as a state-changing endpoint rather than as "just localhost":

* ``Content-Type: application/json`` is mandatory. It is not a CORS-simple type, so
  a cross-origin ``fetch`` must first win a preflight, which this server never
  answers. ``text/plain`` and ``application/x-www-form-urlencoded`` — the types a
  plain ``<form>`` or a no-cors ``fetch`` can send without a preflight — are refused.
* ``Sec-Fetch-Site`` must be absent or ``same-origin``.
* ``Origin`` must be present and be this server's own loopback origin and port.

stdlib only, binds 127.0.0.1 only.
"""

import http.server
import json
import os
import posixpath
import socketserver
import sys
import tempfile
import urllib.parse

TARGET = "/pincites.json"
DEST_NAME = "pincites.json"
MAX_BODY = 8 * 1024 * 1024  # generous for a whole manuscript's decisions, bounded for safety
ALLOWED_CONTENT_TYPE = "application/json"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}
DEFAULT_PORT = 8765


class ReviewHandler(http.server.SimpleHTTPRequestHandler):
    """GET is stock http.server; POST /pincites.json writes the decisions atomically."""

    server_version = "PinciteReview/1.0"

    def log_message(self, fmt, *args):  # keep the captured pipes quiet
        pass

    # --- request guards -------------------------------------------------

    def _content_type_ok(self):
        raw = self.headers.get("Content-Type")
        if not raw:
            return False
        return raw.split(";", 1)[0].strip().lower() == ALLOWED_CONTENT_TYPE

    def _fetch_site_ok(self):
        site = self.headers.get("Sec-Fetch-Site")
        return site is None or site.strip().lower() == "same-origin"

    def _origin_ok(self):
        """Origin must be present and be this server's own loopback origin.

        Requiring it is stronger than "match it when present" and costs nothing: the
        Fetch standard makes browsers send Origin on every request whose method is
        not GET or HEAD, so the review page's own POST always carries it.
        """
        origin = self.headers.get("Origin")
        if origin is None:
            return False
        origin = origin.strip()
        if origin.lower() == "null":
            return False
        parsed = urllib.parse.urlparse(origin)
        if parsed.scheme != "http":
            return False
        host = (parsed.hostname or "").lower()
        if host not in LOOPBACK_HOSTS:
            return False
        return parsed.port == self.server.server_address[1]

    def _destination(self):
        """Resolve the POST target, or None if it is not the pincites endpoint.

        The path is normalised before comparison, so ``/../escaped.json`` and other
        traversing targets never match, and the resolved file is re-checked against
        the server root before anything is written.
        """
        path = urllib.parse.urlsplit(self.path).path
        path = urllib.parse.unquote(path)
        path = posixpath.normpath(path)
        if path != TARGET:
            return None
        root = os.path.realpath(self.directory)
        dest = os.path.realpath(os.path.join(root, DEST_NAME))
        if dest != os.path.join(root, DEST_NAME):
            return None
        if os.path.dirname(dest) != root:
            return None
        return dest

    # --- responses ------------------------------------------------------

    def _reply(self, status, payload):
        body = json.dumps(payload).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass
        self.close_connection = True

    # --- POST -----------------------------------------------------------

    def do_POST(self):
        if not (self._content_type_ok() and self._fetch_site_ok() and self._origin_ok()):
            self._reply(403, {"error": "refused"})
            return

        dest = self._destination()
        if dest is None:
            self._reply(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._reply(400, {"error": "bad content-length"})
            return
        if length < 0:
            self._reply(400, {"error": "bad content-length"})
            return
        if length > MAX_BODY:
            # Refuse without reading the body at all.
            self._reply(413, {"error": "body too large"})
            return

        body = self.rfile.read(length)
        if len(body) != length:
            self._reply(400, {"error": "truncated body"})
            return

        try:
            data = json.loads(body.decode("utf8"))
        except (ValueError, UnicodeDecodeError):
            # Nothing is written: any existing pincites.json stays byte-identical.
            self._reply(400, {"error": "invalid json"})
            return

        # The pincite itself is free text — `1279--81`, `55,086`, `(manuscript at
        # 66)` are all real values in this manuscript. Well-formed JSON is the only
        # thing checked; the author is the authority on citation form.
        try:
            self._write_atomic(dest, data)
        except OSError as exc:
            self._reply(500, {"error": str(exc)})
            return

        self._reply(200, {"ok": True})

    def _write_atomic(self, dest, data):
        """Write to a temp file in the destination's own directory, then rename.

        os.replace is atomic within a filesystem, so a concurrent reader sees either
        the whole old file or the whole new one, never a truncated one.
        """
        directory = os.path.dirname(dest)
        fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=".pincites-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf8") as tmp:
                json.dump(data, tmp)
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_name, dest)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main(argv):
    port = DEFAULT_PORT
    root = os.getcwd()

    args = list(argv)
    if args:
        try:
            port = int(args[0])
        except ValueError:
            root = args[0]
            args = args[1:]
        else:
            args = args[1:]
    if args:
        root = args[0]

    root = os.path.abspath(root)
    if not os.path.isdir(root):
        sys.stderr.write(f"not a directory: {root}\n")
        return 2

    def handler(*a, **kw):
        return ReviewHandler(*a, directory=root, **kw)

    server = Server(("127.0.0.1", port), handler)
    sys.stderr.write(f"serving {root} at http://127.0.0.1:{server.server_address[1]}/\n")
    sys.stderr.write("open /scratch/review/index.html\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
