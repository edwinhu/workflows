#!/usr/bin/env python3
"""Stage the DEF 14A filing index for the scan_covers `quorum` profile.

Emits two files, because the scanner and the panel builder need different things:

  quorum_filings.tsv   cik, accession, fdate, meeting_year, path
                       the metadata index. `meeting_year` is the only field the
                       scanner CANNOT recover — it sees a filing, not the meeting
                       the filing is about — so build_panel.py joins it back on
                       `path`.
  quorum_files.txt     one path per line, for `scan_covers -files-from`.

Then, on the grid:

    scan_covers -profile quorum -files-from quorum_files.txt \\
        -root /wrds/sec/wrds_clean_filings > quorum_raw.tsv
    python build_panel.py --scan quorum_raw.tsv --index quorum_filings.tsv

Usage:
    python stage.py --start-year 2005 --end-year 2025 --out .
    python stage.py --ciks-from my_ciks.txt --out .
"""
from __future__ import annotations

import argparse
import csv
import os
import socket
from pathlib import Path

# WRDS IPv6 is unreliable from some networks; force IPv4 before psycopg2 loads.
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, family=0, *a, **k):
    return _orig_getaddrinfo(host, port, socket.AF_INET, *a, **k)


socket.getaddrinfo = _ipv4_only

import psycopg2  # noqa: E402

# DEF 14A only. PRE 14A is the preliminary version and a firm that files both
# would appear twice with possibly different text; the definitive one governs.
QUERY = """
SELECT cik, accession, fdate, form, fname
FROM wrdssec_all.wrds_forms
WHERE form IN ('DEF 14A', 'DEFM14A')
  AND fdate BETWEEN %(start)s AND %(end)s
  {cik_clause}
"""


def fname_to_path(fname: str) -> str:
    """WRDS `fname` -> path under wrds_clean_filings/.

    'edgar/data/34088/0001193125-25-073986.txt'
      -> '000034/34088/0001193125-25-073986.txt'

    The first component is the CIK zero-padded to 10 then truncated to 6 — that
    is the archive's bucketing, not a checksum. Getting it wrong yields a path
    that does not exist rather than a wrong file, so failures are loud.
    """
    parts = fname.split("/")
    cik_int = parts[2]
    filename = parts[3]
    return f"{cik_int.zfill(10)[:6]}/{cik_int}/{filename}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=2005)
    ap.add_argument("--end-year", type=int, default=2025)
    ap.add_argument("--ciks-from", help="file of CIKs, one per line; omit for all filers")
    ap.add_argument("--out", default=".")
    ap.add_argument("--host", default=os.environ.get("WRDS_PGHOST", "wrds-pgdata.wharton.upenn.edu"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("WRDS_PGPORT", "9737")))
    ap.add_argument("--user", default=os.environ.get("WRDS_USER") or os.environ.get("USER"))
    args = ap.parse_args()

    params = {"start": f"{args.start_year}-01-01", "end": f"{args.end_year}-12-31"}
    cik_clause = ""
    if args.ciks_from:
        ciks = [c.strip() for c in Path(args.ciks_from).read_text().split() if c.strip()]
        if not ciks:
            raise SystemExit(f"{args.ciks_from} is empty")
        cik_clause = "AND cik IN %(ciks)s"
        params["ciks"] = tuple(ciks)
        print(f"[stage] restricted to {len(ciks):,} CIKs")

    conn = psycopg2.connect(host=args.host, port=args.port, dbname="wrds",
                            user=args.user, sslmode="require")
    cur = conn.cursor()
    cur.execute(QUERY.format(cik_clause=cik_clause), params)
    rows = cur.fetchall()
    conn.close()
    print(f"[stage] {len(rows):,} DEF 14A filings {args.start_year}-{args.end_year}")

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    idx_path = outdir / "quorum_filings.tsv"
    lst_path = outdir / "quorum_files.txt"

    n = 0
    with idx_path.open("w", newline="") as fh, lst_path.open("w") as lh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(["cik", "accession", "fdate", "meeting_year", "path"])
        for cik, accession, fdate, _form, fname in rows:
            if not fname:
                continue
            path = fname_to_path(fname)
            # meeting_year = filing year. A proxy is filed weeks before its
            # annual meeting and essentially never crosses a year boundary in a
            # way that matters here; build_panel dedups per (cik, meeting_year)
            # so a rare December filing for a January meeting collapses into the
            # same firm-year rather than splitting it.
            w.writerow([cik, accession, fdate, str(fdate)[:4], path])
            lh.write(path + "\n")
            n += 1

    print(f"[out] {idx_path} ({n:,} rows)")
    print(f"[out] {lst_path}")
    print(f"\nNext:\n  scan_covers -profile quorum -files-from {lst_path.name} \\\n"
          f"      -root /wrds/sec/wrds_clean_filings > quorum_raw.tsv\n"
          f"  python build_panel.py --scan quorum_raw.tsv --index {idx_path.name}")


if __name__ == "__main__":
    main()
