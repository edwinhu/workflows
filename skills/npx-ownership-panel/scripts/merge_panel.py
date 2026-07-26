#!/usr/bin/env -S uv run python3
"""Merge voting with institutional and mutual fund ownership.

Reads parquet outputs from build_votes.py, build_inst_own.py, build_mf_own.py.
Output: /scratch/nyu/hue/pass_panel.parquet
"""

import pandas as pd
import numpy as np
import time
from pathlib import Path

OUT = Path("/scratch/nyu/hue")
t0 = time.time()

# ---------- Load ----------
print("Loading panels...")
meetings = pd.read_parquet(OUT / "meetings.parquet")
inst_own = pd.read_parquet(OUT / "inst_own.parquet")
print(f"  Meetings: {len(meetings):,}")
print(f"  Inst own: {len(inst_own):,}")

# Stack all MF ownership chunks
mf_files = sorted(OUT.glob("mf_own_*.parquet"))
if mf_files:
    mf_own = pd.concat([pd.read_parquet(f) for f in mf_files], ignore_index=True)
    mf_own = mf_own.sort_values(["permno", "qtr"]).drop_duplicates(
        subset=["permno", "qtr"], keep="last"
    )
    print(f"  MF own: {len(mf_own):,} (from {len(mf_files)} files)")
else:
    mf_own = pd.DataFrame()
    print("  MF own: no files found")

# ---------- Merge: meetings × inst_own (as-of backward) ----------
print("\nMerging meetings with institutional ownership...")
meetings["recorddate"] = pd.to_datetime(meetings["recorddate"])
meetings = meetings.dropna(subset=["recorddate"]).copy()
meetings = meetings.sort_values("recorddate")

io_sorted = inst_own[["permno", "rdate", "ior_pct", "num_owners", "io_total"]].copy()
io_sorted = io_sorted.rename(columns={"ior_pct": "ior"})
io_sorted["permno"] = io_sorted["permno"].astype(int)
io_sorted["rdate"] = pd.to_datetime(io_sorted["rdate"]).astype("datetime64[ns]")
io_sorted = io_sorted.sort_values("rdate")

merged = pd.merge_asof(
    meetings, io_sorted,
    left_on="recorddate", right_on="rdate",
    by="permno", direction="backward",
    tolerance=pd.Timedelta("180 days"),
)
print(f"  IO match: {merged['ior'].notna().sum():,} / {len(merged):,}")

# ---------- Merge: + MF ownership (as-of backward) ----------
if not mf_own.empty:
    print("Merging with mutual fund ownership...")
    mf_sorted = mf_own[["permno", "qtr", "mf_pct", "passive_pct", "index_pct",
                         "num_mf_owners"]].copy()
    mf_sorted["permno"] = mf_sorted["permno"].astype(int)
    mf_sorted["qtr"] = pd.to_datetime(mf_sorted["qtr"]).astype("datetime64[ns]")
    mf_sorted = mf_sorted.sort_values("qtr")

    merged = pd.merge_asof(
        merged.sort_values("recorddate"),
        mf_sorted,
        left_on="recorddate", right_on="qtr",
        by="permno", direction="backward",
        tolerance=pd.Timedelta("180 days"),
    )
    print(f"  MF match: {merged['mf_pct'].notna().sum():,} / {len(merged):,}")

# ---------- Pivotalness ----------
print("Computing pivotalness metrics...")
merged["inst_pivotal"] = (np.abs(merged["forpct"] - 50) <= merged["ior"]).astype(int)
if "mf_pct" in merged.columns:
    merged["mf_pivotal"] = (np.abs(merged["forpct"] - 50) <= merged["mf_pct"]).astype(int)
    merged["passive_pivotal"] = (np.abs(merged["forpct"] - 50) <= merged["passive_pct"]).astype(int)
    merged["index_pivotal"] = (np.abs(merged["forpct"] - 50) <= merged["index_pct"]).astype(int)

# ---------- Save ----------
outfile = OUT / "pass_panel.parquet"
merged.to_parquet(outfile, index=False, compression="zstd")
elapsed = time.time() - t0
print(f"\nDone. Wrote {len(merged):,} rows to {outfile}")
print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f} min)")

# Summary stats
print("\n--- Summary Statistics ---")
stats_cols = ["turnout", "forpct", "ior"]
if "mf_pct" in merged.columns:
    stats_cols += ["mf_pct", "passive_pct", "index_pct"]
print(merged[stats_cols].describe().round(2).to_string())
