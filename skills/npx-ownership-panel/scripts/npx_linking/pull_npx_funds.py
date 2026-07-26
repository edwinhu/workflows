#!/usr/bin/env python3
"""pull_npx_funds.py — the ISS fund dimension, straight from WRDS.

L0 of the ladder. Reduces the 238M-row `risk.voteanalysis_npx` to ONE ROW PER
`fundid` (~27K) entirely server-side, so nothing large crosses the wire.

This is the file that makes the ladder portable: every column below comes from
WRDS, so a fresh checkout with credentials can build it. No project artifacts.

Emits per fundid:
    fundid, institutionid
    fundname_modal, institutionname_modal   most-frequent name across the window
    fundcik                                 modal ISS-reported CIK — the L2 CIK scope
    seriesid                                ISS-reported SEC series id (2023+ only)
    n_seriesid_variants                     >1 means an identity collision
    first_vote_year, last_vote_year
    n_vote_rows                             cast to int64 — see the uint32 trap
    iss_nonregistrant                       trailing '*' on institutionname

WHY MODAL AND NOT LATEST
------------------------
Fund names are restated. The modal name over the window is the one the fuzzy
tiers have the best chance of matching against a CRSP vintage; the latest name
systematically fails for funds that died mid-panel, which is exactly the cohort
the fuzzy tiers exist to serve.

    ./pull_npx_funds.py --out npx_funds.parquet                     # 2005-2025
    ./pull_npx_funds.py --out smoke.parquet --start-year 2023 --end-year 2023
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extensions

psycopg2.extensions.register_type(
    psycopg2.extensions.new_type((1700,), "DEC2FLOAT",
                                 lambda v, c: float(v) if v is not None else None)
)

# ISS began reporting `seriesid` on N-PX in 2023. Before that the id must be
# carried back over the stable fundid ("propagated" tier) — it is not missing
# data, it is a reporting-era boundary.
ISS_SERIESID_ERA = 2023

# One pass, aggregated server-side. The name pick is deterministic: highest row
# count, ties broken by the name itself, so two runs give identical output.
FUNDS_SQL = """
WITH scoped AS (
    SELECT n.fundid, n.institutionid, n.fundname, n.institutionname, n.fundcik,
           n.meetingdate, n.seriesid
    FROM risk.voteanalysis_npx n
    WHERE n.meetingdate >= %(start)s AND n.meetingdate <= %(end)s
      AND n.fundid IS NOT NULL
      {item_universe}
),
name_counts AS (
    SELECT fundid, fundname, institutionname, fundcik, COUNT(*) AS n,
           ROW_NUMBER() OVER (
               PARTITION BY fundid
               ORDER BY COUNT(*) DESC, fundname, institutionname
           ) AS rn
    FROM scoped
    GROUP BY fundid, fundname, institutionname, fundcik
),
agg AS (
    SELECT fundid,
           MAX(institutionid)                            AS institutionid,
           MIN(EXTRACT(YEAR FROM meetingdate))::int      AS first_vote_year,
           MAX(EXTRACT(YEAR FROM meetingdate))::int      AS last_vote_year,
           COUNT(*)                                      AS n_vote_rows
    FROM scoped
    GROUP BY fundid
),
sid AS (
    -- seriesid exists only in the reporting era; take the most-attested one AND
    -- count the variants, so identity collisions are visible rather than silent.
    SELECT fundid,
           MAX(CASE WHEN rn = 1 THEN seriesid END) AS seriesid,
           COUNT(*)                                AS n_seriesid_variants
    FROM (
        SELECT fundid, seriesid,
               ROW_NUMBER() OVER (PARTITION BY fundid
                                  ORDER BY COUNT(*) DESC, seriesid) AS rn
        FROM scoped
        WHERE seriesid IS NOT NULL AND seriesid <> ''
        GROUP BY fundid, seriesid
    ) t
    GROUP BY fundid
)
SELECT a.fundid, a.institutionid,
       nc.fundname        AS fundname_modal,
       nc.institutionname AS institutionname_modal,
       nc.fundcik,
       s.seriesid, s.n_seriesid_variants,
       a.first_vote_year, a.last_vote_year, a.n_vote_rows
FROM agg a
LEFT JOIN name_counts nc ON nc.fundid = a.fundid AND nc.rn = 1
LEFT JOIN sid s          ON s.fundid  = a.fundid
"""


# Restrict to N-PX rows whose item exists in vavoteresults — the SAME universe
# build_npx.sas aggregates. Without it `n_vote_rows` counts the 237,057,808-row
# meetingdate universe instead of the 144,375,860-row analysis universe, and
# every coverage percentage is computed against the wrong denominator.
# EXISTS, not a join: vavoteresults is not unique on itemonagendaid.
ITEM_UNIVERSE_SQL = """
      AND EXISTS (
          SELECT 1 FROM risk.vavoteresults v
          WHERE v.itemonagendaid = n.itemonagendaid
            AND v.meetingdate >= %(start)s AND v.meetingdate <= %(end)s
      )
"""


def connect(user: str):
    return psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                            database="wrds", user=user, sslmode="require")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--start-year", type=int, default=2005)
    ap.add_argument("--end-year", type=int, default=2025)
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--no-item-universe", action="store_true",
                    help="count ALL N-PX rows in the date window, not just those "
                         "whose item is in vavoteresults (faster; wrong denominator "
                         "for coverage against the analysis universe)")
    ap.add_argument("--print-sql", action="store_true")
    args = ap.parse_args()

    sql = FUNDS_SQL.format(
        item_universe="" if args.no_item_universe else ITEM_UNIVERSE_SQL)

    if args.print_sql:
        print(sql)
        return

    t0 = time.time()
    conn = connect(args.user)
    try:
        df = pd.read_sql(sql, conn,
                         params={"start": f"{args.start_year}-01-01",
                                 "end": f"{args.end_year}-12-31"})
    finally:
        conn.close()

    # THE uint32 TRAP. n_vote_rows is the weight behind every coverage number in
    # the report. A 32-bit accumulation silently under-reports: it made an index
    # block read 6.3% when the truth was 36.1%. Force 64-bit here, once, at the
    # source, so no downstream sum can inherit it.
    df["n_vote_rows"] = df["n_vote_rows"].astype("int64")

    df["iss_nonregistrant"] = (
        df["institutionname_modal"].fillna("").str.strip().str.endswith("*")
    )
    df = df.sort_values("fundid").reset_index(drop=True)

    out = Path(args.out)
    df.to_parquet(out, index=False, compression="zstd")

    n_sid = df["seriesid"].notna().sum()
    collisions = int((df["n_seriesid_variants"].fillna(0) > 1).sum())
    print(f"npx_funds: {len(df):,} fundids, {out.stat().st_size/1e3:.0f} KB, "
          f"{time.time()-t0:.0f}s -> {out}")
    print(f"  vote rows represented : {df['n_vote_rows'].sum():,}")
    print(f"  ISS seriesid present  : {n_sid:,} ({100*n_sid/len(df):.1f}%) "
          f"[reported {ISS_SERIESID_ERA}+ only]")
    print(f"  seriesid collisions   : {collisions} fundid(s) with >1 seriesid "
          f"— resolve at FUND grain, never on the vote panel")
    print(f"  ISS non-registrants   : {int(df['iss_nonregistrant'].sum()):,} "
          f"(no SEC seriesId by construction; not link failures)")


if __name__ == "__main__":
    main()
