#!/usr/bin/env python3
"""Pull a CRSP CIZ (v2) common-stock panel from WRDS PostgreSQL.

Demonstrates the four things that most often go wrong when porting SIZ code:

  1. Legacy tables (crsp.dsf / crsp.msf) stop at 2024-12-31 -- use CIZ tables.
  2. SHRCD IN (10, 11) needs FIVE CIZ columns, not one.
  3. The delisting return is already inside dlyret / mthret -- never add DelRet.
  4. There is no vwretd column; market returns come from an INDNO join.

Credentials come from ~/.pgpass (chmod 600):

    wrds-pgdata.wharton.upenn.edu:9737:wrds:USERNAME:PASSWORD

Set PGUSER (or pass --user) to that USERNAME -- libpq matches ~/.pgpass on the
user too, so it fails if your OS username differs from your WRDS one.

The value-weighted return this prints will NOT equal CRSP's VWRETD: this sample is
common stock only, while INDNO 1000200 spans a broader eligible universe with CRSP's
own weighting rules. Use the index series when you want the benchmark itself.

Verified against WRDS 2026-07-26:
    --start 2025-11-01 --end 2025-12-31 --freq monthly -> 7,373 rows / 3,703 permnos
    --start 2025-12-01 --end 2025-12-05 --freq daily   -> 18,347 rows / 3,674 permnos

Usage:
    python ciz_panel.py --start 2024-01-01 --end 2025-12-31 --freq monthly
    python ciz_panel.py --start 2025-01-02 --end 2025-01-31 --freq daily
"""

from __future__ import annotations

import argparse
import getpass
import os

import pandas as pd
import psycopg2

HOST = "wrds-pgdata.wharton.upenn.edu"
PORT = 9737
DATABASE = "wrds"

# SHRCD IN (10, 11) + EXCHCD IN (1, 2, 3). All five share/issuer columns are
# required: ShareType is never 'COM' in CIZ -- 'COM' lives at SecuritySubType.
def common_stock(alias: str) -> str:
    a = f"{alias}." if alias else ""
    return f"""
      {a}sharetype       = 'NS'
  AND {a}securitytype    = 'EQTY'
  AND {a}securitysubtype = 'COM'
  AND {a}usincflg        = 'Y'
  AND {a}issuertype      IN ('ACOR', 'CORP')
  AND {a}primaryexch     IN ('N', 'A', 'Q')
"""

# CRSP NYSE/NYSEMKT/Nasdaq/Arca Value-Weighted Market Index -- the CIZ home of
# legacy VWRETD (TotRet) and VWRETX (PrcRet).
VWRETD_INDNO = 1000200

# stkmthsecuritydata carries the universe columns as of MthPrcDt, so the monthly
# panel needs no join to stksecurityinfohist.
MONTHLY_SQL = f"""
SELECT m.permno,
       m.mthcaldt,
       m.mthprc,
       m.mthprcflg,
       m.mthret,                 -- delisting return already included
       m.mthretx,
       m.mthcap,                 -- $ thousands, CRSP's own figure
       m.mthprevcap,             -- prior-period cap: the VW weight, no LAG() needed
       m.mthvol,
       m.mthcompflg,             -- completeness of the underlying daily data
       m.ticker,
       m.issuernm,
       i.mthtotret AS vwretd,
       i.mthprcret AS vwretx
FROM crsp.stkmthsecuritydata m
JOIN crsp.indmthseriesdata i
  ON i.mthcaldt = m.mthcaldt
 AND i.indno    = %(indno)s
WHERE m.mthcaldt BETWEEN %(start)s AND %(end)s
  AND {common_stock("m")}
ORDER BY m.permno, m.mthcaldt
"""

# The daily files have no identifier columns, so the universe filter comes from
# stksecurityinfohist. The BETWEEN join is what makes it point-in-time -- without
# it you apply today's classification to the whole history.
#
# Uses stkdlysecuritydata (32 cols) rather than stkdlysecurityprimarydata (12 cols)
# only because DlyPrevCap lives in the wider file. Drop DlyPrevCap and switch to
# the primary file if you do not need value weights -- same rows, ~1/3 the bytes.
DAILY_SQL = f"""
SELECT d.permno,
       d.dlycaldt,
       d.dlyprc,
       d.dlyprcflg,              -- 'TR' trade, 'BA' bid-ask avg, 'DA' delisting
       d.dlyret,                 -- delisting return already included
       d.dlyretx,
       d.dlycap,
       d.dlyprevcap,             -- prior-period cap: the VW weight, no LAG() needed
       d.dlyvol,
       d.dlydelflg,
       h.ticker,
       h.issuernm,
       i.dlytotret AS vwretd,
       i.dlyprcret AS vwretx
FROM crsp.stkdlysecuritydata d
JOIN crsp.stksecurityinfohist h
  ON h.permno = d.permno
 AND d.dlycaldt BETWEEN h.secinfostartdt AND h.secinfoenddt
JOIN crsp.inddlyseriesdata i
  ON i.dlycaldt = d.dlycaldt
 AND i.indno    = %(indno)s
WHERE d.dlycaldt BETWEEN %(start)s AND %(end)s
  AND h.conditionaltype  = 'RW'
  AND h.tradingstatusflg = 'A'
  AND {common_stock("h")}
ORDER BY d.permno, d.dlycaldt
"""


def pull(freq: str, start: str, end: str, user: str | None = None) -> pd.DataFrame:
    """Run the panel query. `user` must be the WRDS username, not the OS one --
    libpq matches ~/.pgpass on (host, port, db, user), so leaving it unset makes
    the lookup fail with 'no password supplied' whenever they differ."""
    sql = MONTHLY_SQL if freq == "monthly" else DAILY_SQL
    params = {"start": start, "end": end, "indno": VWRETD_INDNO}
    user = user or os.environ.get("PGUSER") or getpass.getuser()
    with psycopg2.connect(
        host=HOST, port=PORT, database=DATABASE, user=user, sslmode="require"
    ) as conn:
        return pd.read_sql(sql, conn, params=params)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", required=True, help="YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD")
    ap.add_argument("--freq", choices=["daily", "monthly"], default="monthly")
    ap.add_argument("--user", help="WRDS username (default: $PGUSER)")
    ap.add_argument("--out", help="optional parquet output path")
    args = ap.parse_args()

    df = pull(args.freq, args.start, args.end, args.user)

    ret = "mthret" if args.freq == "monthly" else "dlyret"
    date = "mthcaldt" if args.freq == "monthly" else "dlycaldt"

    print(f"rows={len(df):,}  permnos={df.permno.nunique():,}")
    print(f"dates {df[date].min()} .. {df[date].max()}")
    print(f"mean {ret}: {df[ret].astype(float).mean():.6f}")

    # Value-weighted portfolio return. Weight on the PREVIOUS period's cap --
    # weighting by the contemporaneous cap builds this period's return into its
    # own weight and biases the portfolio return upward.
    cap = "mthprevcap" if args.freq == "monthly" else "dlyprevcap"
    g = df.dropna(subset=[ret, cap]).astype({ret: float, cap: float})
    vw = g.groupby(date).apply(
        lambda x: (x[ret] * x[cap]).sum() / x[cap].sum(), include_groups=False
    )
    print("\nvalue-weighted return, first 5 periods:")
    print(vw.head())

    if args.out:
        df.to_parquet(args.out, index=False)
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
