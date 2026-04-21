#!/usr/bin/env -S uv run python3
"""Serve every marimo notebook in a directory — read-only Run mode by default.

Run mode (default): `marimo.create_asgi_app().with_dynamic_directory()` — one
uvicorn process auto-discovers every `*.py` in DIRECTORY as a read-only app.
Add or remove files and the URL list updates without restart.

Edit mode (`--edit`): delegates to `marimo edit DIRECTORY` — marimo's built-in
multi-session editor. Fully editable; cells run on save.

Usage:
    serve.py [DIRECTORY] [--host HOST] [--port PORT] [--mount PATH]
             [--include-code] [--edit]

Defaults:
    DIRECTORY      = ./notebooks
    --host         = 127.0.0.1
    --port         = 2718
    --mount        = /<project-name> (parent directory of DIRECTORY) — run mode only
    --include-code = off (source hidden)                              — run mode only
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("directory", nargs="?", default="notebooks",
                   help="Directory containing marimo .py notebooks (default: ./notebooks)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=2718)
    p.add_argument("--mount", default=None,
                   help="URL path prefix (default: project name, derived from DIRECTORY's parent). "
                        "marimo requires a non-empty prefix. Run mode only.")
    p.add_argument("--include-code", action="store_true",
                   help="Expose notebook source in the app UI (default: hidden). Run mode only.")
    p.add_argument("--edit", action="store_true",
                   help="Launch `marimo edit DIRECTORY` instead of the read-only Run-mode server.")
    args = p.parse_args()

    directory = Path(args.directory).resolve()
    if not directory.is_dir():
        sys.exit(f"error: {directory} is not a directory")

    if args.edit:
        import shutil
        marimo_bin = shutil.which("marimo")
        if not marimo_bin:
            sys.exit("error: `marimo` not on PATH. pip/pixi add marimo")
        # --no-token makes the server auto-discoverable by the marimo-pair skill.
        # --watch re-reads the notebook file on disk so external edits show up.
        argv = [marimo_bin, "edit", str(directory),
                "--host", args.host, "--port", str(args.port),
                "--headless", "--no-token", "--watch"]
        print(f"Launching edit mode: {' '.join(argv)}")
        os.execv(marimo_bin, argv)

    try:
        from marimo import create_asgi_app
    except ImportError:
        sys.exit("error: marimo not installed. pip/pixi add marimo")
    try:
        import uvicorn
    except ImportError:
        sys.exit("error: uvicorn not installed. pip/pixi add uvicorn")

    notebooks = sorted(q for q in directory.glob("*.py") if not q.name.startswith("_"))

    raw_mount = args.mount if args.mount is not None else directory.parent.name
    stripped = raw_mount.strip("/")
    if not stripped:
        sys.exit("error: --mount resolved to empty (marimo requires a non-empty prefix). "
                 "Pass --mount explicitly or run from a named project directory.")
    mount = "/" + stripped

    print(f"Serving {len(notebooks)} notebook(s) from {directory} (read-only Run mode)")
    for nb in notebooks:
        print(f"  http://{args.host}:{args.port}{mount}/{nb.stem}")
    if not notebooks:
        print("  (no *.py files found — add notebooks and refresh)")
    print()

    server = create_asgi_app(include_code=args.include_code).with_dynamic_directory(
        path=mount,
        directory=str(directory),
    )
    app = server.build()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
