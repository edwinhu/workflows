#!/usr/bin/env python3
"""npx_link_to_csv.py — export the local fund->block crosswalk for SAS.

Runs LOCALLY. This is the only file that crosses the wire going UP, and it is
~700 KB. Everything downstream of it happens on the grid.

The crosswalk itself is built locally on purpose: it comes out of fuzzy fund
name / CIK / seriesid matching against CRSP MFDB, which is iterative work that
wants pandas and a notebook, not a batch queue. What does NOT belong locally is
applying it to 144M vote rows.

CSV rather than parquet because base SAS 9.4 cannot read parquet. Three columns,
fixed order, matching the INPUT statement in stage_npx_link.sas:

    fundid, block, tna_w

    ./npx_link_to_csv.py --in npx_crsp_link.parquet --out npx_link.csv
    ./npx_link_to_csv.py --in link.parquet --out npx_link.csv \
        --key fundid --group block --weight tna_latest
"""

import argparse
import sys
from pathlib import Path

import pandas as pd

MAX_BLOCK_LEN = 24  # must match `length block $24` in stage_npx_link.sas / build_npx.sas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", default="npx_link.csv")
    ap.add_argument("--key", default="fundid", help="N-PX join key")
    ap.add_argument("--group", default="block", help="grouping column carried into the cells")
    ap.add_argument("--weight", default="tna_latest", help="numeric weight; '' for none")
    args = ap.parse_args()

    df = pd.read_parquet(args.src)
    missing = [c for c in (args.key, args.group) if c not in df.columns]
    if missing:
        sys.exit(f"{args.src} lacks {missing}; has {list(df.columns)}")

    out = pd.DataFrame({
        "fundid": pd.to_numeric(df[args.key], errors="coerce"),
        "block": df[args.group].astype("string").fillna("__nogroup__").str.strip(),
        "tna_w": (pd.to_numeric(df[args.weight], errors="coerce")
                  if args.weight and args.weight in df.columns else pd.NA),
    })

    if args.weight and args.weight not in df.columns:
        print(f"NOTE: no weight column {args.weight!r}; tna_w written empty "
              f"(tna_* outputs will be 0 and n_no_tna == n_rows)")

    # A block label longer than the SAS $24 would be silently truncated on
    # input, merging two distinct blocks into one. Fail here instead.
    too_long = out.loc[out["block"].str.len() > MAX_BLOCK_LEN, "block"].unique()
    if len(too_long):
        sys.exit(f"block label(s) exceed SAS length ${MAX_BLOCK_LEN}: {list(too_long)[:5]}\n"
                 f"  Widen `length block ${MAX_BLOCK_LEN}` in stage_npx_link.sas AND build_npx.sas.")

    # A comma or newline inside a label would desynchronise the DSD read.
    bad = out.loc[out["block"].str.contains(r'[,\r\n"]', na=False), "block"].unique()
    if len(bad):
        sys.exit(f"block label(s) contain a comma/quote/newline: {list(bad)[:5]}")

    before = len(out)
    out = out.dropna(subset=["fundid"]).drop_duplicates(subset=["fundid"], keep="first")
    if len(out) != before:
        print(f"NOTE: {before - len(out):,} row(s) dropped (null or duplicate {args.key})")

    out = out.sort_values("fundid", kind="stable")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.out, index=False, na_rep="")

    print(f"Wrote {args.out}: {len(out):,} rows, "
          f"{Path(args.out).stat().st_size/1e3:.0f} KB")
    print(out["block"].value_counts().to_string())


if __name__ == "__main__":
    main()
