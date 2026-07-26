#!/usr/bin/env -S uv run python3 -u
"""Convert aggregated SAS mf_own datasets to a single parquet file.

The SAS jobs already aggregated to permno-quarter, so these files are small.
Just concat and save.

Output: /scratch/nyu/hue/mf_own_2003_2024.parquet
"""

import pandas as pd
import time
from pathlib import Path

OUT = Path("/scratch/nyu/hue")
t0 = time.time()

print("Loading aggregated MF ownership datasets...", flush=True)
chunks = []
for f in sorted(OUT.glob("mf_own_*.sas7bdat")):
    print(f"  {f.name}...", end="", flush=True)
    if f.stat().st_size < 1_000:
        print(f" SKIPPED ({f.stat().st_size} bytes)", flush=True)
        continue
    df = pd.read_sas(f)
    print(f" {len(df):,} rows", flush=True)
    chunks.append(df)

if not chunks:
    print("ERROR: No mf_own_*.sas7bdat files found in /scratch/nyu/hue/")
    raise SystemExit(1)

combined = pd.concat(chunks, ignore_index=True)

# SAS date → pandas datetime
if "qtr" in combined.columns and combined["qtr"].dtype == "float64":
    combined["qtr"] = pd.to_datetime(combined["qtr"], unit="D", origin="1960-01-01")

# Drop any duplicates from overlapping year ranges
combined = combined.drop_duplicates(subset=["qtr", "permno"], keep="last")

outfile = OUT / "mf_own_2003_2024.parquet"
combined.to_parquet(outfile, index=False, compression="zstd")
elapsed = time.time() - t0
print(f"\nDone. Wrote {len(combined):,} rows to {outfile}", flush=True)
print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f} min)", flush=True)
