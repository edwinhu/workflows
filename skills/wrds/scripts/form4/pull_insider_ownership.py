"""Volkova script 8 port — insider ownership data.

Original R code scrapes `https://www.sec.gov/cgi-bin/own-disp?...` per CIK.
That endpoint is rate-limited (10 req/s, ~30-60min for our universe) and the
current SEC layout leaves Owner-CIK empty in the transactions table, forcing
a name-based join that's error-prone.

WRDS exposes the same Form 3/4/5 data via the Thomson Reuters insider
feed (`tr_insiders.table1`). The coordinator explicitly directs this path.

Pruning strategy (per coordinator guidance — table1 is 17.3M rows / 5.5 GB):
  1. Filter server-side: formtype IN ('3','4','5'), sectitle = 'COM'
  2. Chunk by year to avoid OOM (2019-2024 → 6 queries of ~300K rows each)
  3. Project only needed columns (9 cols)
  4. Scope to cusip6 universe (issuers in blockholders panel) via IN clause
  5. Save per-year parquet files for resume-friendliness

Output:
  data/processed/tr_insider_{year}.parquet  (one per year)
  data/processed/tr_insider_all.parquet     (concatenated)

Mapping: TR uses `personid` as the insider identifier (not SEC CIK). We use
personid directly as blockholder_CIK for insider rows — downstream analysis
compares (company_CIK, blockholder_CIK, year) triples; personid is unique
per insider and won't collide with real-company CIKs in practice.
"""

from __future__ import annotations

import argparse
import sys
import time
import os
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# PATHS. Vendored from mirror `scripts/`, where `parents[1]` was the project
# root. Standalone it is not, so the root is overridable — same convention as
# npx_linking/_config.py:
#     FORM4_ROOT=/path/to/project python step1_query_filings.py
# ---------------------------------------------------------------------------
PROJ = Path(os.environ["FORM4_ROOT"]).resolve() if os.environ.get("FORM4_ROOT") \
    else Path(__file__).resolve().parents[4]

# mirror imported `src.wrds_pull`; psycopg2 direct keeps this standalone.
import psycopg2  # noqa: E402


class _WrdsPull:
    @staticmethod
    def connect(user: str | None = None):
        return psycopg2.connect(
            host=os.environ.get("WRDS_PGHOST", "wrds-pgdata.wharton.upenn.edu"),
            port=int(os.environ.get("WRDS_PGPORT", "9737")),
            dbname="wrds",
            user=user or os.environ.get("WRDS_USER") or os.environ.get("USER"),
            sslmode="require",
        )


wrds_pull = _WrdsPull()


COLS = ["fdate", "formtype", "personid", "owner", "cname",
        "cusip6", "trandate", "sharesheld", "shares_adj", "acqdisp"]


def build_cusip6_universe() -> list[str]:
    """cusip6 whitelist = issuers in the counterfactual panel plus the parsed
    13D/G filings for 2024. Typically ~6-10K values."""
    cusips: set[str] = set()
    votes_path = Path("data/processed/votes.parquet")
    if votes_path.exists():
        votes = pd.read_parquet(votes_path, columns=["cusip"])
        cusips |= set(votes["cusip"].dropna().astype(str).str[:6])

    # Intentionally skip cusip_map (40K issuers, most have no vote coverage).
    # We only want issuers in the cf universe + the 2024 13D/G parse.

    parsed = Path("data/raw/blockholders/2024/parsed.parquet")
    if parsed.exists():
        p = pd.read_parquet(parsed, columns=["cusip6"])
        cusips |= set(p["cusip6"].dropna().astype(str).str[:6])

    cusips = {c for c in cusips if c and len(c) == 6}
    return sorted(cusips)


def pull_year(conn, year: int, cusip6_list: list[str]) -> pd.DataFrame:
    """Pull one year of TR insider filings for the cusip6 universe."""
    # Use ANY(%s) with a single array parameter (cleaner than IN with thousands of %s)
    sql = """
        SELECT fdate, formtype, personid, owner, cname,
               cusip6, trandate, sharesheld, shares_adj, acqdisp, sectitle
        FROM tr_insiders.table1
        WHERE formtype IN ('3','4','5')
          AND sectitle = 'COM'
          AND EXTRACT(YEAR FROM fdate) = %(yr)s
          AND cusip6 = ANY(%(cusips)s)
    """
    df = pd.read_sql(sql, conn, params={"yr": year, "cusips": cusip6_list})
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year-from", type=int, default=2019)
    ap.add_argument("--year-to", type=int, default=2024)
    ap.add_argument("--out-dir", default="data/processed")
    ap.add_argument("--full-cusip", action="store_true",
                    help="Skip cusip6 whitelist (pull every issuer — heavier)")
    args = ap.parse_args()

    t0 = time.time()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    if args.full_cusip:
        cusips = None
        print("[cusips] --full-cusip: no whitelist (pull all issuers)")
    else:
        cusips = build_cusip6_universe()
        print(f"[cusips] universe: {len(cusips)} cusip6 values")
        if not cusips:
            raise RuntimeError("empty cusip6 universe; fix paths")

    conn = wrds_pull.connect(user="eddyhu")
    all_chunks: list[pd.DataFrame] = []
    for yr in range(args.year_from, args.year_to + 1):
        path = out / f"tr_insider_{yr}.parquet"
        if path.exists():
            df = pd.read_parquet(path)
            print(f"  [{yr}] cached {len(df):,} rows")
            all_chunks.append(df)
            continue
        ts = time.time()
        if cusips is None:
            sql = """
                SELECT fdate, formtype, personid, owner, cname,
                       cusip6, trandate, sharesheld, shares_adj, acqdisp
                FROM tr_insiders.table1
                WHERE formtype IN ('3','4','5')
                  AND sectitle = 'COM'
                  AND EXTRACT(YEAR FROM fdate) = %(yr)s
            """
            df = pd.read_sql(sql, conn, params={"yr": yr})
        else:
            df = pull_year(conn, yr, cusips)
        df.to_parquet(path, index=False)
        print(f"  [{yr}] {len(df):,} rows  ({time.time()-ts:.1f}s)")
        all_chunks.append(df)

    conn.close()

    combined = pd.concat(all_chunks, ignore_index=True)
    combined.to_parquet(out / "tr_insider_all.parquet", index=False)
    print(f"[done] {len(combined):,} total rows  elapsed={time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
