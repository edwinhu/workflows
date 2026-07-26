#!/usr/bin/env python3
"""pull_npx_items.py — pull the SMALL dimension tables the cells join back to.

Runs LOCALLY (no grid needed). build_npx.sas emits (itemonagendaid, block)
cells; this fetches the item-level and fund-level attributes that give those
cells meaning.

    --items   risk.vavoteresults for the window   848,736 rows,  ~15s,  ~40 MB
    --funds   distinct fund/institution names      ~60K rows,     fast,  ~ 3 MB

WHY THESE ARE SEPARATE PULLS
----------------------------
These are exactly the columns a naive INNER JOIN replicates across every
fund-item row. Measured over 2005-2025: the item columns (cusip, sponsor,
voteresult, meetingtype, mgmtrec — avg 33.7 text bytes) have 848,736 distinct
values and get shipped 144,376,253 times. Pulling them once and joining locally
is a ~170x reduction on that part of the payload, and takes 15 seconds.

    ./pull_npx_items.py --items --out items.parquet
    ./pull_npx_items.py --funds --out funds.parquet --start-year 2005 --end-year 2025
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extensions

# WRDS returns NUMERIC as decimal.Decimal; cast at the wire so downstream gets
# plain floats instead of an object-dtype column of Decimals.
psycopg2.extensions.register_type(
    psycopg2.extensions.new_type((1700,), "DEC2FLOAT",
                                 lambda v, c: float(v) if v is not None else None)
)

ITEM_SELECT = """v.itemonagendaid, v.meetingid, v.meetingdate, v.meetingtype,
       v.cusip, v.ticker, v.issagendaitemid, v.seqnumber, v.sponsor,
       v.mgmtrec, v.voteresult, v.votedfor, v.votedagainst, v.votedabstain,
       v.votedwithheld, v.brokernonvote, v.base, v.outstandingshare,
       v.voterequirement"""

FUND_SELECT = "n.fundid, n.institutionid, n.fundname, n.institutionname"

# Empty by default so counts reconcile against build_npx.sas. The canonical
# meetingtype filter (gotcha #9, references/iss-voting.md) is:
#   "v.meetingtype IN ('Annual','Special','Annual/Special',
#                      'Proxy Contest','Proxy Contest (M&A)')"
DEFAULT_WHERE = ""


def connect(user: str):
    # Password comes from ~/.pgpass — never inline it.
    return psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                            database="wrds", user=user, sslmode="require")


def window(where_extra: str) -> str:
    pred = "v.meetingdate >= %(start)s AND v.meetingdate <= %(end)s"
    return pred + (f"\n  AND ({where_extra})" if where_extra.strip() else "")


def items_sql(where_extra: str) -> str:
    return (f"SELECT {ITEM_SELECT}\nFROM risk.vavoteresults v\n"
            f"WHERE {window(where_extra)}")


def funds_sql(where_extra: str) -> str:
    # EXISTS, not a join: a semi-join restricts to funds that voted in the
    # window without multiplying the N-PX side by vavoteresults' duplicate
    # itemonagendaid rows.
    return (f"SELECT DISTINCT {FUND_SELECT}\n"
            f"FROM risk.voteanalysis_npx n\n"
            f"WHERE EXISTS (\n"
            f"    SELECT 1 FROM risk.vavoteresults v\n"
            f"    WHERE v.itemonagendaid = n.itemonagendaid\n"
            f"      AND {window(where_extra)}\n)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", action="store_true")
    ap.add_argument("--funds", action="store_true")
    ap.add_argument("--start-year", type=int, default=2005)
    ap.add_argument("--end-year", type=int, default=2025)
    ap.add_argument("--where", default=DEFAULT_WHERE, help="extra predicates on vavoteresults")
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--out", required=True)
    ap.add_argument("--print-sql", action="store_true")
    args = ap.parse_args()

    if args.items == args.funds:
        sys.exit("pick exactly one of --items / --funds")

    sql = items_sql(args.where) if args.items else funds_sql(args.where)
    if args.print_sql:
        print(sql)
        return

    t0 = time.time()
    conn = connect(args.user)
    try:
        df = pd.read_sql(sql, conn, params={"start": f"{args.start_year}-01-01",
                                            "end": f"{args.end_year}-12-31"})
    finally:
        conn.close()

    out = Path(args.out)
    df.to_parquet(out, index=False, compression="zstd")
    print(f"{'items' if args.items else 'funds'}: {len(df):,} rows, "
          f"{out.stat().st_size/1e6:.1f} MB, {time.time()-t0:.1f}s -> {out}")

    if args.items:
        n_dupe = len(df) - df["itemonagendaid"].nunique()
        # Not a failure — 'Pending' + final versioning pairs. But it is why an
        # INNER JOIN to N-PX fans out (144,376,253 vs 144,375,860), so state it
        # rather than let the next person inherit it silently.
        print(f"  itemonagendaid: {df['itemonagendaid'].nunique():,} distinct, "
              f"{n_dupe:,} duplicate row(s).")
        if n_dupe:
            print("  Drop voteresult='Pending' before joining to the cells.")


if __name__ == "__main__":
    main()
