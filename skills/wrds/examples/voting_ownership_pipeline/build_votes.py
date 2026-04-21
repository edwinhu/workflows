#!/usr/bin/env -S uv run python3
"""Build ISS vote results panel with CRSP permno.

Replaces the first ~200 lines of 1-make.sas.
Output: /scratch/nyu/hue/meetings.parquet (~600K rows)
"""

import psycopg2
import pandas as pd
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import time
from pathlib import Path

OUT = Path("/scratch/nyu/hue")
OUT.mkdir(parents=True, exist_ok=True)

conn = psycopg2.connect(
    host="wrds-pgdata.wharton.upenn.edu", port=9737,
    database="wrds", user="eddyhu", sslmode="require",
)

t0 = time.time()

# ---------- Step 1: ISS vote results ----------
print("Step 1: Pulling ISS vote results...")
votes = pd.read_sql("""
    SELECT cusip, companyid, issagendaitemid, itemonagendaid, meetingid,
           meetingdate, meetingtype, recorddate, ticker, sponsor,
           mgmtrec, voteresult, votedfor, votedagainst, votedabstain,
           votedwithheld, brokernonvote, base, outstandingshare AS tso,
           seqnumber, voterequirement
    FROM risk.vavoteresults
    WHERE meetingdate BETWEEN '2003-01-01' AND '2024-12-31'
      AND voteresult IN ('Pass', 'Fail')
      AND meetingtype IN ('Annual', 'Special', 'Annual/Special',
                          'Proxy Contest', 'Proxy Contest (M&A)')
""", conn, parse_dates=["meetingdate", "recorddate"])
print(f"  {len(votes):,} items, {votes['meetingid'].nunique():,} meetings")

# ---------- Step 2: Compute turnout and forpct ----------
print("Step 2: Computing turnout and forpct...")
bases = votes["base"].str.strip()

conditions = [
    bases.isin(["F+A+AB", "F A AB", "F+A+B"]),
    bases.isin(["F+A", "F A"]),
    bases == "Votes Represent",
    bases.isin(["Capital Represe", "Outstanding"]),
]
denominators = [
    votes["votedfor"] + votes["votedagainst"] + votes["votedabstain"],
    votes["votedfor"] + votes["votedagainst"],
    (votes["votedabstain"] + votes["votedagainst"] + votes["votedfor"]
     + votes["brokernonvote"].fillna(0) + votes["votedwithheld"].fillna(0)),
    votes["tso"],
]
votes["denom"] = np.select(conditions, denominators, default=np.nan)

total_votes = (votes["votedfor"].fillna(0) + votes["votedagainst"].fillna(0)
               + votes["votedabstain"].fillna(0) + votes["votedwithheld"].fillna(0)
               + votes["brokernonvote"].fillna(0))

votes["turnout"] = np.where(votes["tso"] > 0, total_votes / votes["tso"] * 100, np.nan)
votes["forpct"] = np.where(votes["denom"] > 0, votes["votedfor"] / votes["denom"] * 100, np.nan)
votes["mgmt_for"] = (votes["mgmtrec"] == "For").astype(int)

# Clean
votes = votes[~bases.isin(["NA", "NULL"])].copy()
votes = votes[~((votes["votedfor"] <= 0) & (votes["voteresult"] == "Pass"))].copy()
votes = votes[votes["turnout"] <= 120].copy()
votes["turnout"] = votes["turnout"].clip(0, 100)
votes["forpct"] = votes["forpct"].clip(0, 100)
print(f"  After cleaning: {len(votes):,} items")

# ---------- Step 3: Link to CRSP permno ----------
print("Step 3: Linking to CRSP permno...")

# Pass 1: CUSIP match (6-char)
cusip_map = pd.read_sql("""
    SELECT DISTINCT ON (SUBSTR(ncusip, 1, 6))
           SUBSTR(ncusip, 1, 6) AS cusip6, permno
    FROM crsp.msenames
    WHERE ncusip IS NOT NULL AND ncusip != ''
    ORDER BY SUBSTR(ncusip, 1, 6), namedt DESC
""", conn)

votes["cusip6"] = votes["cusip"].str[:6]
votes = votes.merge(cusip_map, on="cusip6", how="left")
unmatched = votes["permno"].isna()
print(f"  CUSIP match: {(~unmatched).sum():,}, unmatched: {unmatched.sum():,}")

# Pass 2: Ticker fallback
if unmatched.any():
    ticker_map = pd.read_sql("""
        SELECT DISTINCT ON (ticker)
               ticker, permno AS permno_tk
        FROM crsp.msenames
        WHERE ticker IS NOT NULL AND ticker != ''
        ORDER BY ticker, namedt DESC
    """, conn)
    votes = votes.merge(ticker_map, on="ticker", how="left")
    votes.loc[unmatched, "permno"] = votes.loc[unmatched, "permno_tk"]
    votes.drop(columns="permno_tk", inplace=True)
    still_unmatched = votes["permno"].isna()
    print(f"  After ticker fallback: {still_unmatched.sum():,} unmatched ({still_unmatched.mean():.1%})")

votes = votes.dropna(subset=["permno"]).copy()
votes["permno"] = votes["permno"].astype(int)

# Deduplicate
votes = votes.sort_values("itemonagendaid").drop_duplicates(subset=["itemonagendaid"], keep="first")
print(f"  Final meetings: {len(votes):,} items, {votes['meetingid'].nunique():,} meetings")

# ---------- Step 4: Link CIK ----------
print("Step 4: Linking CIK...")
cik_map = pd.read_sql("""
    SELECT DISTINCT ticker, cik
    FROM wrdssec.wciklink_ticker
    WHERE ticker IS NOT NULL
""", conn)
votes = votes.merge(cik_map, on="ticker", how="left")

# ---------- Save ----------
outfile = OUT / "meetings.parquet"
votes.to_parquet(outfile, index=False, compression="zstd")
elapsed = time.time() - t0
print(f"\nDone. Wrote {len(votes):,} rows to {outfile}")
print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f} min)")

conn.close()
