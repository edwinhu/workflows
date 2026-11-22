#!/usr/bin/env python3
"""Resolve EDGAR accessions to WRDS filing paths and pull exhibits out of raw SGML submissions (stdlib only).

    path <cik> <accession> [--clean]        rclone path of one filing (offline)
    resolve [file|-]                        "cik accession" lines -> wrdsfname lines for `rclone copy --files-from`
    fetch <file|-> <dest> [--clean]         resolve, then ONE rclone copy of what is not cached -> local paths, one per line
    extract <file|-> (--filename F | --type T | --list)

Python: fetch_round(pairs, dest) is one round; fetch_rounds(seeds, dest, discover) repeats it with the pairs
discover(local paths) returns, never requesting a pair twice.

Exit: 0 ok, 1 failed query or copy, 2 bad arguments/input/truncated SGML, 3 no match or missing, 4 ambiguous.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Iterable, NamedTuple, Optional, Sequence

PG_HOST, PG_PORT, PG_DB = "wrds-pgdata.wharton.upenn.edu", "9737", "wrds"
ROOT_RAW = "wrds:/wrds/sec/archives"
ROOT_CLEAN = "wrds:/wrds/sec/wrds_clean_filings"
CHUNK = 5000
# [0-9], not \d: \d matches other scripts' digits. This regex is also what makes inlining into SQL safe.
_ACC = re.compile(r"[0-9]{10}-[0-9]{2}-[0-9]{6}|[0-9]{18}")
_WRDSFNAME = re.compile(r"[0-9]{6}/[0-9]+/(?:[0-9]{10}-[0-9]{2}-[0-9]{6}|[0-9]{18})\.txt")
_ROW_CIK = re.compile(r"[0-9]+")


class QueryError(RuntimeError):
    """The WRDS query failed. Never to be read as 'missing'."""


class CopyError(RuntimeError):
    """The rclone copy failed. Never to be read as 'missing'."""


class NoMatchError(LookupError):
    pass


class AmbiguousError(LookupError):
    def __init__(self, filenames: list):
        self.filenames = filenames
        super().__init__("ambiguous: matches " + ", ".join(filenames) + " (pick one with --filename)")


class Resolved(NamedTuple):
    cik: Optional[str]  # as given, 10-digit padded; None for an accession-only pair
    accession: str  # dashed
    wrdsfname: Optional[str]
    status: str  # ok | relocated | missing


class Document(NamedTuple):
    sequence: str
    type: str
    filename: str
    description: str
    text: bytes


def norm_accession(accession) -> str:
    s = accession if isinstance(accession, str) else ""
    if not _ACC.fullmatch(s):
        raise ValueError(f"invalid accession {accession!r}: want 0001104659-20-000437 or 18 digits")
    return s if "-" in s else f"{s[:10]}-{s[10:12]}-{s[12:]}"


def norm_cik(cik) -> int:
    if isinstance(cik, bool) or not isinstance(cik, (int, str)):
        raise ValueError(f"invalid cik {cik!r}")
    if isinstance(cik, str) and not re.fullmatch(r"[0-9]{1,10}", cik):
        raise ValueError(f"invalid cik {cik!r}: want 1-10 digits")
    n = int(cik)
    if not 0 <= n <= 9_999_999_999:
        raise ValueError(f"invalid cik {cik!r}")
    return n


def rel_path(cik, accession) -> str:
    n = norm_cik(cik)
    return f"{n:010d}"[:6] + f"/{n}/{norm_accession(accession)}.txt"


def rclone_path(cik, accession, clean: bool = False) -> str:
    return f"{ROOT_CLEAN if clean else ROOT_RAW}/{rel_path(cik, accession)}"


# ── resolve ───────────────────────────────────────────────────────────────────────────────────
def _pg_user() -> str:
    user = os.environ.get("PGUSER")
    if user:
        return user
    try:
        with open(os.path.expanduser("~/.pgpass")) as f:
            for line in f:
                p = line.rstrip("\n").split(":")
                if not line.startswith("#") and len(p) >= 4 and p[0] == PG_HOST and p[3]:
                    return p[3]
    except OSError:
        pass
    raise QueryError(f"no WRDS user: set PGUSER or add a {PG_HOST} line to ~/.pgpass")


def psql_query(accessions: Sequence[str]) -> list:
    """One psql call: (accession, cik, wrdsfname) rows. SQL goes on stdin so any list length fits."""
    accs = [norm_accession(a) for a in accessions]
    sql = ("SELECT accession, cik, wrdsfname FROM wrdssec_all.wrds_forms WHERE wrdsfname IS NOT NULL "
           "AND accession IN (" + ",".join(f"'{a}'" for a in accs) + ");\n")
    cmd = ["psql", "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1",
           "-h", PG_HOST, "-p", PG_PORT, "-d", PG_DB, "-U", _pg_user()]
    try:
        r = subprocess.run(cmd, input=sql, capture_output=True, text=True,
                           env={**os.environ, "PGSSLMODE": "require"})
    except OSError as e:
        raise QueryError(f"cannot run psql: {e}") from e
    if r.returncode != 0:
        raise QueryError(f"psql exited {r.returncode}: {r.stderr.strip()}")
    rows = []
    for line in r.stdout.splitlines():
        if not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) != 3:
            raise QueryError(f"unexpected psql row: {line!r}")
        rows.append((cols[0], cols[1], cols[2]))
    return rows


def resolve(pairs: Iterable, query: Optional[Callable[[list], Iterable]] = None) -> list:
    """One Resolved per (cik|None, accession) pair, from one query per CHUNK distinct accessions."""
    query = query or psql_query
    items = [(None if c is None else norm_cik(c), norm_accession(a)) for c, a in pairs]
    distinct = list(dict.fromkeys(a for _, a in items))
    by_acc: dict = {}
    for i in range(0, len(distinct), CHUNK):
        for acc, cik, fname in query(distinct[i:i + CHUNK]):
            if not isinstance(cik, str) or not _ROW_CIK.fullmatch(cik):
                raise QueryError(f"query row for {acc}: bad cik {cik!r}")
            if not isinstance(fname, str) or not _WRDSFNAME.fullmatch(fname):
                raise QueryError(f"query row for {acc}: bad wrdsfname {fname!r}")
            by_acc.setdefault(acc, []).append((int(cik), fname))
    out = []
    for cik, acc in items:
        rows = sorted(by_acc.get(acc, ()), key=lambda r: r[1])
        padded = None if cik is None else f"{cik:010d}"
        if not rows:
            out.append(Resolved(padded, acc, None, "missing"))
            continue
        same = [r for r in rows if r[0] == cik]
        if same or cik is None:
            out.append(Resolved(padded, acc, (same or rows)[0][1], "ok"))
        else:
            out.append(Resolved(padded, acc, rows[0][1], "relocated"))
    return out


# ── fetch ─────────────────────────────────────────────────────────────────────────────────────
def rclone_copy(argv: Sequence[str]) -> None:
    try:
        r = subprocess.run(list(argv), capture_output=True, text=True)
    except OSError as e:
        raise CopyError(f"cannot run rclone: {e}") from e
    if r.returncode != 0:
        raise CopyError(f"rclone exited {r.returncode}: {r.stderr.strip()}")


def _present(p: Optional[Path]) -> bool:
    return p is not None and p.is_file() and p.stat().st_size > 0


def _round(pairs, dest, clean, query, copy):
    results = resolve(pairs, query)
    root = ROOT_CLEAN if clean else ROOT_RAW
    base = Path(dest) / root.rsplit("/", 1)[1]
    paths = [base / r.wrdsfname if r.wrdsfname else None for r in results]
    need = list(dict.fromkeys(r.wrdsfname for r, p in zip(results, paths) if p and not _present(p)))
    if need:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write("\n".join(need) + "\n")
        try:
            (copy or rclone_copy)(["rclone", "copy", root, str(base), "--files-from", f.name,
                                   "--transfers", "8", "--no-traverse", "--log-level", "ERROR"])
        finally:
            os.unlink(f.name)
    # rclone exits 0 on a listed file that does not exist, so presence on disk decides "missing".
    return results, [str(p) if _present(p) else None for p in paths]


def fetch_round(pairs: Iterable, dest, clean: bool = False, query=None, copy=None) -> list:
    """One local path (or None if missing) per pair: one resolve, at most one `rclone copy` of the uncached."""
    return _round(pairs, dest, clean, query, copy)[1]


def fetch_rounds(seeds: Iterable, dest, discover: Callable[[list], Iterable], clean: bool = False,
                 query=None, copy=None) -> list:
    """Repeat fetch_round on the pairs discover(this round's found paths) returns; results of every round, in order."""
    seen: set = set()
    out: list = []
    pairs = list(seeds)
    while True:
        new = []
        for c, a in pairs:
            key = (None if c is None else norm_cik(c), norm_accession(a))
            if key not in seen:
                seen.add(key)
                new.append((c, a))
        if not new:
            return out
        res = fetch_round(new, dest, clean, query, copy)
        out.extend(res)
        pairs = list(discover([p for p in res if p]))


# ── SGML ──────────────────────────────────────────────────────────────────────────────────────
_HEAD_TAGS = {b"<TYPE>": "type", b"<SEQUENCE>": "sequence", b"<FILENAME>": "filename", b"<DESCRIPTION>": "description"}


def _lines(data: bytes):
    """(start, end_without_eol, next_start) per line; split on \\n only, so CRLF and body bytes survive."""
    pos, n = 0, len(data)
    while pos < n:
        nl = data.find(b"\n", pos)
        nxt = n if nl < 0 else nl + 1
        end = nxt if nl < 0 else nl
        yield pos, end, nxt
        pos = nxt


def documents(sgml: bytes) -> list:
    """Every <DOCUMENT>; text is the bytes between <TEXT>'s line and </TEXT>'s line, never decoded."""
    docs, cur, text_start = [], None, None
    for start, end, nxt in _lines(sgml):
        line = sgml[start:end].rstrip(b" \t\r")
        if text_start is not None:
            if line == b"</TEXT>":
                assert cur is not None
                cur["text"], text_start = sgml[text_start:start], None
            continue
        if cur is None:
            if line == b"<DOCUMENT>":
                cur = {"type": "", "sequence": "", "filename": "", "description": "", "text": b""}
            continue
        if line == b"<TEXT>":
            text_start = nxt
        elif line == b"</DOCUMENT>":
            docs.append(Document(cur["sequence"], cur["type"], cur["filename"], cur["description"], cur["text"]))
            cur = None
        else:
            for tag, key in _HEAD_TAGS.items():
                if line.startswith(tag):
                    cur[key] = line[len(tag):].decode("utf-8", "replace").strip()
    if cur is not None or text_start is not None:
        raise ValueError("truncated SGML: unterminated <DOCUMENT>")
    return docs


def extract(sgml: bytes, filename: Optional[str] = None, doc_type: Optional[str] = None) -> Document:
    if filename is None and doc_type is None:
        raise ValueError("extract needs a filename or a type")
    hits = [d for d in documents(sgml)
            if (filename is None or d.filename.lower() == filename.lower())
            and (doc_type is None or d.type.lower() == doc_type.lower())]
    if not hits:
        raise NoMatchError(f"no document matches filename={filename!r} type={doc_type!r}")
    if len(hits) > 1:
        raise AmbiguousError([d.filename or f"(sequence {d.sequence})" for d in hits])
    return hits[0]


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────
def _read(src: str) -> bytes:
    if src == "-":
        return sys.stdin.buffer.read()
    try:
        with open(src, "rb") as f:
            return f.read()
    except OSError as e:
        raise ValueError(f"cannot read {src}: {e.strerror}") from e


def _parse_pairs(text: str) -> list:
    pairs = []
    for n, line in enumerate(text.splitlines(), 1):
        tok = [t for t in re.split(r"[\s,]+", line.strip()) if t]
        if not tok:
            continue
        if len(tok) > 2:
            raise ValueError(f"line {n}: want 'cik accession' or 'accession', got {line!r}")
        pairs.append((tok[0], tok[1]) if len(tok) == 2 else (None, tok[0]))
    return pairs


def _cmd_path(a) -> int:
    print(rclone_path(a.cik, a.accession, clean=a.clean))
    return 0


def _cmd_resolve(a) -> int:
    results = resolve(_parse_pairs(_read(a.file).decode("utf-8", "replace")))
    for r in results:
        who = f"{r.cik or '-'} {r.accession}"
        if r.status == "relocated":
            print(f"relocated: {who} -> {r.wrdsfname}", file=sys.stderr)
        elif r.status == "missing":
            print(f"missing: {who}", file=sys.stderr)
    out = sys.stdout
    for p in dict.fromkeys(r.wrdsfname for r in results if r.wrdsfname):
        out.write(p + "\n")
    return 3 if any(r.status == "missing" for r in results) else 0


def _cmd_fetch(a) -> int:
    results, paths = _round(_parse_pairs(_read(a.file).decode("utf-8", "replace")), a.dest, a.clean, None, None)
    for r, p in zip(results, paths):
        who = f"{r.cik or '-'} {r.accession}"
        if p is None:
            print(f"missing: {who}", file=sys.stderr)
        elif r.status == "relocated":
            print(f"relocated: {who} -> {r.wrdsfname}", file=sys.stderr)
    for p in dict.fromkeys(p for p in paths if p):
        sys.stdout.write(p + "\n")
    return 3 if None in paths else 0


def _cmd_extract(a) -> int:
    data = _read(a.file)
    if a.list:
        for d in documents(data):
            print("\t".join(re.sub(r"\s+", " ", x) for x in (d.sequence, d.type, d.filename, d.description)))
        return 0
    try:
        d = extract(data, filename=a.filename, doc_type=a.type)
    except NoMatchError as e:
        print(e, file=sys.stderr)
        return 3
    except AmbiguousError as e:
        print(e, file=sys.stderr)
        return 4
    sys.stdout.buffer.write(d.text)
    sys.stdout.buffer.flush()
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="edgar_filing.py", description=(__doc__ or "").splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("path", help="print the rclone path of one filing")
    p.add_argument("cik")
    p.add_argument("accession")
    p.add_argument("--clean", action="store_true", help="wrds_clean_filings instead of archives")
    p.set_defaults(fn=_cmd_path)
    p = sub.add_parser("resolve", help="cik/accession lines -> wrdsfname lines")
    p.add_argument("file", nargs="?", default="-")
    p.set_defaults(fn=_cmd_resolve)
    p = sub.add_parser("fetch", help="cik/accession lines -> local paths, one bulk copy")
    p.add_argument("file")
    p.add_argument("dest")
    p.add_argument("--clean", action="store_true", help="wrds_clean_filings instead of archives")
    p.set_defaults(fn=_cmd_fetch)
    p = sub.add_parser("extract", help="one document (or the list) from an SGML submission")
    p.add_argument("file")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--filename")
    g.add_argument("--type")
    g.add_argument("--list", action="store_true")
    p.set_defaults(fn=_cmd_extract)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except QueryError as e:
        print(f"query failed: {e}", file=sys.stderr)
        return 1
    except CopyError as e:
        print(f"copy failed: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
