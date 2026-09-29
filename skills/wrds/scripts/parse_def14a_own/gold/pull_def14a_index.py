#!/usr/bin/env python3
"""pull_def14a_index.py — the DEF 14A filing index, metadata only.

One row per (cik, accession) DEF 14A filing 1996-2021, with the archive-relative
path the parser reads. Metadata only: the filing BODY never moves through the
SQL connection (wrds_sec_search.filing_def is 45 GB of document text; pulling it
is the transfer this design exists to prevent).

Output (outside git):
    $GOLD_DIR/def14a_index.tsv.gz        the index
    $GOLD_DIR/def14a_index.json          sidecar: SQL, params, pull date, rows, sha256
"""

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import sys

import psycopg2

SQL = """
select cik, accession, form, fdate, rdate, coname, fname
from wrdssec_all.wrds_forms
where form = %(form)s and fdate between %(d0)s and %(d1)s
order by cik, fdate, accession
"""


def relpath(fname: str) -> str:
    """edgar/data/104169/0000104169-24-000123.txt -> 000010/104169/0000104169-24-000123.txt"""
    parts = fname.split("/")
    if len(parts) < 4:
        return ""
    cikint = parts[2]
    return "%s/%s/%s" % (str(int(cikint)).zfill(10)[:6], cikint, parts[3])


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--form", default="DEF 14A")
    ap.add_argument("--start", default="1996-01-01")
    ap.add_argument("--end", default="2021-12-31")
    args = ap.parse_args()
    os.makedirs(args.gold_dir, exist_ok=True)

    params = {"form": args.form, "d0": args.start, "d1": args.end}
    con = psycopg2.connect(
        host="wrds-pgdata.wharton.upenn.edu", port=9737, database="wrds",
        user=args.user, sslmode="require",
    )
    cur = con.cursor()
    cur.execute(SQL, params)
    rows = cur.fetchall()
    con.close()
    print("[in ] wrds_forms %s %s..%s: %d rows" % (args.form, args.start, args.end, len(rows)))

    out = os.path.join(args.gold_dir, "def14a_index.tsv.gz")
    n_out = n_nopath = 0
    with gzip.open(out, "wt") as fh:
        fh.write("cik\taccession\tform\tfiling_date\trdate\tconame\trelpath\n")
        for cik, acc, form, fdate, rdate, coname, fname in rows:
            rp = relpath(fname or "")
            if not rp:
                n_nopath += 1
                continue
            fh.write(
                "\t".join([
                    str(cik), acc, form, str(fdate), str(rdate or ""),
                    (coname or "").replace("\t", " "), rp,
                ]) + "\n"
            )
            n_out += 1
    print("[out] %s: %d rows (%d dropped: unparseable fname)" % (out, n_out, n_nopath))
    if n_out == 0:
        sys.exit("ERROR: empty index")

    side = {
        "artifact": os.path.basename(out),
        "sql": " ".join(SQL.split()),
        "params": params,
        "wrds_account": args.user,
        "pull_date": dt.datetime.now().astimezone().isoformat(),
        "rows": n_out,
        "rows_dropped_bad_fname": n_nopath,
        "sha256": sha256_of(out),
    }
    sc = os.path.join(args.gold_dir, "def14a_index.json")
    with open(sc, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s sha256=%s" % (sc, side["sha256"]))


if __name__ == "__main__":
    main()
