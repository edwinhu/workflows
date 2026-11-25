#!/usr/bin/env python3
"""Write MANIFEST.csv for a staged production directory.

    manifest.py STAGE_DIR

One row per file under STAGE_DIR, sorted by path, MANIFEST.csv itself excluded:

    path,bytes,sha256,modified_utc

`path` is relative to STAGE_DIR with `/`; `modified_utc` is the file's mtime floored to the whole
second, as YYYY-MM-DDTHH:MM:SSZ. Refuses (exit 1, nothing written) when the stage holds a cache or
VCS entry, because a manifest that lists one certifies it. package-check.sh's archive leg reads this
module's HEADER, row() and forbidden() so the writer and the checker cannot disagree on the format.
"""
import csv
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

NAME = "MANIFEST.csv"
HEADER = ["path", "bytes", "sha256", "modified_utc"]
STAMP = "%Y-%m-%dT%H:%M:%SZ"
FORBIDDEN_DIRS = frozenset({"__pycache__", ".ruff_cache", ".pytest_cache", ".git"})


def forbidden(rel: str) -> bool:
    parts = rel.split("/")
    return any(p in FORBIDDEN_DIRS for p in parts) or parts[-1].endswith(".pyc")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stamp(mtime: float) -> str:
    return datetime.fromtimestamp(int(mtime // 1), tz=timezone.utc).strftime(STAMP)


def row(path: Path, rel: str) -> list[str]:
    st = path.stat()
    return [rel, str(st.st_size), sha256(path), stamp(st.st_mtime)]


def walk(stage: Path) -> tuple[list[str], list[str]]:
    """(files, forbidden entries) under stage, as sorted `/` paths; MANIFEST.csv left out."""
    files, bad = [], []
    for dirpath, dirnames, filenames in os.walk(stage):
        base = Path(dirpath)
        for d in dirnames:
            rel = (base / d).relative_to(stage).as_posix()
            if forbidden(rel):
                bad.append(rel + "/")
        dirnames[:] = [d for d in dirnames if d not in FORBIDDEN_DIRS]
        for f in filenames:
            rel = (base / f).relative_to(stage).as_posix()
            if rel == NAME:
                continue
            (bad if forbidden(rel) else files).append(rel)
    return sorted(files), sorted(bad)


def write(stage: Path) -> int:
    files, bad = walk(stage)
    if bad:
        for b in bad:
            print(f"manifest.py: refusing, {b} must not ship", file=sys.stderr)
        return 1
    rows = [row(stage / rel, rel) for rel in files]
    tmp = stage / (NAME + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(HEADER)
        w.writerows(rows)
    tmp.replace(stage / NAME)
    print(f"manifest.py: {len(rows)} file(s) listed in {stage / NAME}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    stage = Path(argv[0])
    if not stage.is_dir():
        print(f"manifest.py: {stage} is not a directory", file=sys.stderr)
        return 2
    return write(stage)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
