#!/usr/bin/env python3
"""pull_crsp_funds.py — the CRSP mutual-fund dimension, straight from WRDS.

The right-hand side of the ladder. Everything here is a WRDS table, so a fresh
checkout with credentials can build it.

    crsp.crsp_cik_map    crsp_fundno <-> series_cik (S000...) / contract_cik (C000...)
                         ** this is the via_seriesid tier — the majority of the link **
    crsp.fund_hdr        current name / ticker / mgmt_name / index_fund_flag per fundno
    crsp.fund_summary2   latest tna_latest + index_fund_flag + mgmt_name (class grain)

Emits one row per `crsp_fundno`:
    crsp_fundno, crsp_portno, series_cik, contract_cik,
    fund_name, ticker, mgmt_name, index_fund_flag,
    tna_latest, tna_latest_dt, first_offer_dt, end_dt, dead_flag

GRAIN WARNING
-------------
`fund_summary2` is CLASS-grained (one row per crsp_fundno = one share class) and
has one row per class PER PERIOD — 2.99M rows. We take the LATEST period per
class server-side; never pull the panel.

The analysis unit is the FUND, not the class. `crsp_portno` is CRSP's portfolio
identifier shared by a fund's classes (~88.7% populated among named funds).
Collapse on it downstream; where null, the class is its own singleton unit.

TNA IS PER CLASS. Summing tna_latest across the classes of one portno gives the
fund's TNA — but summing it across ISS fundids that share a crsp_fundno
double-counts. See build_npx_crsp_link.py, which splits it.

    ./pull_crsp_funds.py --out crsp_funds.parquet
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

# DISTINCT ON is the cheap "latest row per group" in PostgreSQL — it sorts once
# and keeps the first per key, instead of a self-join or a window + filter.
CRSP_SQL = """
WITH latest AS (
    SELECT DISTINCT ON (crsp_fundno)
           crsp_fundno, caldt, tna_latest, tna_latest_dt,
           index_fund_flag AS s_index_fund_flag,
           mgmt_name       AS s_mgmt_name,
           fund_name       AS s_fund_name,
           ticker          AS s_ticker,
           crsp_portno     AS s_crsp_portno,
           et_flag, crsp_obj_cd, lipper_class_name
    FROM crsp.fund_summary2
    ORDER BY crsp_fundno, caldt DESC
)
SELECT h.crsp_fundno,
       COALESCE(h.crsp_portno, l.s_crsp_portno)          AS crsp_portno,
       m.series_cik, m.contract_cik, m.comp_cik,
       COALESCE(h.fund_name, l.s_fund_name)              AS fund_name,
       COALESCE(h.ticker, l.s_ticker)                    AS ticker,
       COALESCE(h.mgmt_name, l.s_mgmt_name)              AS mgmt_name,
       h.mgmt_cd,
       -- fund_hdr is the current header; fund_summary2 carries the flag as of
       -- the last period a dead fund was observed. Prefer the header, fall back.
       COALESCE(h.index_fund_flag, l.s_index_fund_flag)  AS index_fund_flag,
       l.tna_latest, l.tna_latest_dt, l.caldt AS summary_caldt,
       l.et_flag, l.crsp_obj_cd, l.lipper_class_name,
       h.first_offer_dt, h.end_dt, h.dead_flag
FROM crsp.fund_hdr h
LEFT JOIN latest       l ON l.crsp_fundno = h.crsp_fundno
LEFT JOIN crsp.crsp_cik_map m ON m.crsp_fundno = h.crsp_fundno
"""


def connect(user: str):
    return psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                            database="wrds", user=user, sslmode="require")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--print-sql", action="store_true")
    args = ap.parse_args()

    if args.print_sql:
        print(CRSP_SQL)
        return

    t0 = time.time()
    conn = connect(args.user)
    try:
        df = pd.read_sql(CRSP_SQL, conn)
    finally:
        conn.close()

    df = df.sort_values("crsp_fundno").reset_index(drop=True)
    out = Path(args.out)
    df.to_parquet(out, index=False, compression="zstd")

    n_sid = df["series_cik"].notna().sum()
    n_tkr = df["ticker"].notna().sum()
    n_tna = df["tna_latest"].notna().sum()
    n_portno = df["crsp_portno"].notna().sum()
    print(f"crsp_funds: {len(df):,} crsp_fundnos, {out.stat().st_size/1e6:.1f} MB, "
          f"{time.time()-t0:.0f}s -> {out}")
    print(f"  series_cik (S000...) : {n_sid:,} ({100*n_sid/len(df):.1f}%) "
          f"-> {df['series_cik'].nunique():,} distinct series")
    print(f"  ticker               : {n_tkr:,} ({100*n_tkr/len(df):.1f}%)")
    print(f"  tna_latest           : {n_tna:,} ({100*n_tna/len(df):.1f}%)")
    print(f"  crsp_portno          : {n_portno:,} ({100*n_portno/len(df):.1f}%)")
    print("  index_fund_flag:")
    print(df["index_fund_flag"].fillna("(null = not index-linked)")
          .value_counts().to_string())


if __name__ == "__main__":
    main()
