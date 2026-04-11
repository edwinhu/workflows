#!/usr/bin/env python3 -u
"""Build 13-F institutional ownership panel from TFN S34.

Server-side aggregation per year: for each year, run a query that joins
S34 holdings with CUSIP→permno mapping and aggregates to permno-quarter.
Returns ~50K rows per year. Then locally join with TSO.

Output: /scratch/nyu/hue/inst_own.parquet (~2M permno-quarter rows)
"""

import psycopg2
import pandas as pd
import numpy as np
import sys
import time
from pathlib import Path

OUT = Path("/scratch/nyu/hue")
YEAR_START, YEAR_END = 2002, 2024

print(f"Building inst_own for {YEAR_START}-{YEAR_END}...", flush=True)
t0 = time.time()

conn = psycopg2.connect(
    host="wrds-pgdata.wharton.upenn.edu", port=9737,
    database="wrds", user="eddyhu", sslmode="require",
)
cur = conn.cursor()
cur.execute("SET statement_timeout = '3600s'")
cur.execute("SET work_mem = '256MB'")
conn.commit()

# --- Step 1: Download TSO reference ---
print("Step 1: Reference tables...", flush=True)

msf = pd.read_sql(f"""
    SELECT DISTINCT ON (permno, DATE_TRUNC('quarter', date))
           permno, DATE_TRUNC('quarter', date)::date AS qtr,
           shrout * 1000 AS tso
    FROM crsp.msf
    WHERE date BETWEEN '{YEAR_START}-01-01' AND '{YEAR_END}-12-31'
      AND shrout > 0
    ORDER BY permno, DATE_TRUNC('quarter', date), date DESC
""", conn, parse_dates=["qtr"])
print(f"  msf: {len(msf):,}", flush=True)

# --- Step 2: Process each year server-side ---
print(f"\nStep 2: Processing S34 by year ({YEAR_START}-{YEAR_END})...", flush=True)
chunks = []

for yr in range(YEAR_START, YEAR_END + 1):
    t1 = time.time()
    print(f"  {yr}: querying...", end="", flush=True)

    agg = pd.read_sql(f"""
        WITH first_vintage AS (
            SELECT mgrno, rdate, MIN(fdate) AS fdate
            FROM tfn.s34type1
            WHERE rdate BETWEEN '{yr}-01-01' AND '{yr}-12-31'
            GROUP BY mgrno, rdate
        ),
        holdings AS (
            SELECT fv.rdate, fv.mgrno, t3.cusip, t3.shares
            FROM first_vintage fv
            INNER JOIN tfn.s34type3 t3
                ON fv.mgrno = t3.mgrno AND fv.fdate = t3.fdate
            WHERE t3.shares > 0
        ),
        mapped AS (
            SELECT h.rdate, h.mgrno, n.permno, h.shares
            FROM holdings h
            INNER JOIN (
                SELECT DISTINCT SUBSTR(ncusip, 1, 6) AS cusip6, permno
                FROM crsp.msenames WHERE ncusip IS NOT NULL
            ) n ON SUBSTR(h.cusip, 1, 6) = n.cusip6
        )
        SELECT rdate, permno,
               COUNT(DISTINCT mgrno) AS num_owners,
               SUM(shares) AS io_total
        FROM mapped
        GROUP BY rdate, permno
    """, conn, parse_dates=["rdate"])

    elapsed_yr = time.time() - t1

    if agg.empty:
        print(f" no data ({elapsed_yr:.0f}s)", flush=True)
        continue

    chunks.append(agg)
    print(f" {len(agg):,} permno-quarters ({elapsed_yr:.0f}s)", flush=True)

# --- Step 3: Combine, join TSO, compute IOR ---
print("\nStep 3: Final assembly...", flush=True)
io = pd.concat(chunks, ignore_index=True)

io["qtr"] = io["rdate"].dt.to_period("Q").dt.to_timestamp("D")
io = io.merge(msf[["permno", "qtr", "tso"]], on=["permno", "qtr"], how="inner")

io["ior"] = (io["io_total"].astype(float) / io["tso"].replace(0, np.nan)).clip(0, 1.2)
io = io[io["ior"] <= 1.2].copy()
io["ior"] = io["ior"].clip(0, 1.0)
io["ior_pct"] = io["ior"] * 100

outfile = OUT / "inst_own.parquet"
io.to_parquet(outfile, index=False, compression="zstd")
elapsed = time.time() - t0
print(f"\nDone. Wrote {len(io):,} rows to {outfile}", flush=True)
print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f} min)", flush=True)

conn.close()
