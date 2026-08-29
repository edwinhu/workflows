#!/usr/bin/env python3
"""L2a-headers — the pre-2010 series vocabulary the SEC masters cannot contain.

WHY THIS STAGE EXISTS

`build_sec_series_master.py` consolidates the SEC Investment Company Series and
Class Report, which is an annual snapshot of THEN-ACTIVE registrants starting in
2010. A fund that lived and died before the first snapshot appears in no vintage
at all, and the SEC's own documentation says the report "does not contain a
comprehensive listing of closed-end registrants (Form N-2 filers) or unit
investment trusts (Form S-6 filers)".

But series IDs became mandatory for N-1A/N-3/N-4/N-6 registrants on 2006-02-06,
and every 40-Act filing carries the series/class block in its SGML header. So
the vocabulary the SEC file is missing is recoverable from the filings.

MEASURED 2026-08-28, scanning 224,103 40-Act filings 2006-2009 (1m52s; 80.4%
carried a block):

    16,603 series / 47,666 classes extracted
     2,889 series appear in NO SEC vintage
     2,754 of those (95.3%) belong to open-end (N-1A) registrants
        70 (2.4%) are the N-2 / S-6 populations the report excludes by design

Validated against 2010 and 2011, where both sources exist: class->parent-series
agreement 100.00% on 37,810 and 37,858 shared classes, ticker 99.40%/99.63%,
CIK 98.59%/99.96%, zero malformed ids. Name disagreements run in the scan's
favour -- it carries the name as filed (Invesco, BMO) where the annual file
carries the pre-rename one (AIM, Marshall).

INPUT is the TSV emitted by `skills/wrds/scripts/scan_headers` in series mode:

    scan_headers -files-from <40act.txt> -emit series -header > forty_act.tsv

That binary reads /wrds/sec/archives directly, so this stage needs the grid (or
a copy of its output). It is therefore OPTIONAL: absent the TSV the chain builds
exactly as before, one vocabulary source lighter.

Usage:
    build_header_series_master.py <scan.tsv> [<scan2.tsv> ...] -o out.parquet
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict

import pandas as pd

csv.field_size_limit(10_000_000)

#: The scan emits one row per (filing, series, class). The vocabulary needs one
#: row per (series, name, year) -- a series with twelve share classes is still
#: one name, and carrying the duplicates would weight it twelve times in IDF.
OUT_COLUMNS = ["series_id", "series_name", "file_year", "owner_cik", "n_filings"]


def read_scan(paths):
    """Collapse scan rows to distinct (series_id, series_name, file_year)."""
    seen = defaultdict(lambda: {"cik": "", "n": 0})
    for path in paths:
        with open(path, newline="") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                sid = (r.get("series_id") or "").strip()
                name = (r.get("series_name") or "").strip()
                filed = (r.get("filed_date") or "").strip()
                if not sid or not name or len(filed) < 4:
                    continue
                key = (sid, name, filed[:4])
                slot = seen[key]
                slot["n"] += 1
                if not slot["cik"]:
                    slot["cik"] = (r.get("owner_cik") or "").lstrip("0")
    rows = [{"series_id": sid, "series_name": nm, "file_year": int(yr),
             "owner_cik": v["cik"], "n_filings": v["n"]}
            for (sid, nm, yr), v in seen.items()]
    return pd.DataFrame(rows, columns=OUT_COLUMNS)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("scans", nargs="+", help="scan_headers -emit series TSV(s)")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()

    df = read_scan(args.scans)
    if df.empty:
        sys.exit("no series rows found -- is this a `-emit series` TSV?")
    df = df.sort_values(["series_id", "file_year", "series_name"])
    df.to_parquet(args.out, index=False)

    print(f"wrote {args.out}: {len(df):,} (series, name, year) rows")
    print(f"  distinct series : {df['series_id'].nunique():,}")
    print(f"  distinct names  : {df['series_name'].nunique():,}")
    print(f"  years           : {df['file_year'].min()}-{df['file_year'].max()}")
    multi = df.groupby("series_id")["series_name"].nunique()
    print(f"  series carrying >1 name: {(multi > 1).sum():,} "
          f"({100 * (multi > 1).mean():.1f}%) -- the rename history the SEC "
          f"annual file cannot express")


if __name__ == "__main__":
    main()
