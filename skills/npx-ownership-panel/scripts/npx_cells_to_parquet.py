#!/usr/bin/env python3
"""npx_cells_to_parquet.py — stack the per-year cell datasets into ONE parquet.

Runs ON the grid, after the array. Output is the single small file that gets
transferred back — the whole point of the exercise. Follows the same shape as
sas_to_parquet.py: the SAS jobs already aggregated, so this is just a concat.

Two things it does that a plain concat does not:

1. RE-AGGREGATES on (itemonagendaid, block). Tasks partition on
   npx.meetingdate, and a handful of itemonagendaids carry rows in more than
   one meeting year (restated filings). Those cells arrive split across two
   task outputs. Summing them here is correct whether or not any exist; a plain
   concat would leave duplicate keys in a file whose stated grain is unique.

2. RECONCILES. The array can lose a task to a node eviction and still look
   clean — you get 20 files instead of 21, the concat succeeds, and a year is
   silently missing from the panel. --expect-years and --expect-rows make that
   a hard failure.

    ./npx_cells_to_parquet.py --expect-years 2005 2025 --expect-rows 144375860
"""

import argparse
import re
import sys
import time
from pathlib import Path

import pandas as pd

CELL_RE = re.compile(r"npx_cells_(\d{4})\.sas7bdat$")

KEYS = ["itemonagendaid", "block"]
SUMS = ["n_rows", "n_for", "n_against", "n_abstain", "n_other",
        "sv_for", "sv_against", "sv_abstain", "n_no_sv",
        "tna_for", "tna_against", "tna_abstain", "n_no_tna"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="/scratch/nyu/eddyhu/npx")
    ap.add_argument("--out", default=None)
    ap.add_argument("--expect-years", nargs=2, type=int, metavar=("START", "END"))
    ap.add_argument("--expect-rows", type=int,
                    help="total vote rows kept; must equal the PostgreSQL semi-join count")
    args = ap.parse_args()

    d = Path(args.dir)
    files = sorted(f for f in d.glob("npx_cells_*.sas7bdat") if CELL_RE.search(f.name))
    if not files:
        sys.exit(f"no npx_cells_YYYY.sas7bdat in {d}")

    found = {int(CELL_RE.search(f.name).group(1)) for f in files}
    if args.expect_years:
        y1, y2 = args.expect_years
        missing = sorted(set(range(y1, y2 + 1)) - found)
        if missing:
            sys.exit(f"FAIL coverage: missing year(s) {missing}\n"
                     f"  Re-run them: qsub -t {missing[0]}-{missing[-1]} run_npx_array.sh")

    t0 = time.time()
    chunks = []
    for f in files:
        df = pd.read_sas(f).copy()
        # pandas reads SAS char columns as bytes; decode before grouping or
        # every block label ends up as b'index' in the parquet.
        # .loc, not df[c] = — read_sas can hand back a view, and chained
        # assignment silently stops updating the frame under copy-on-write.
        for c in df.columns:
            if df[c].dtype == object:
                df.loc[:, c] = df[c].str.decode("utf-8", errors="replace").str.strip()
        print(f"  {f.name}: {len(df):>9,} cells, {int(df['n_rows'].sum()):>12,} vote rows",
              flush=True)
        chunks.append(df)

    cells = pd.concat(chunks, ignore_index=True)
    del chunks

    before = len(cells)
    agg = {c: "sum" for c in SUMS if c in cells.columns}
    if "part_year" in cells.columns:
        agg["part_year"] = "min"
    cells = cells.groupby(KEYS, as_index=False).agg(agg)
    if before != len(cells):
        print(f"  re-aggregated {before:,} -> {len(cells):,} cells "
              f"({before - len(cells):,} split across meeting years)", flush=True)

    cells = cells.sort_values(KEYS, kind="stable").reset_index(drop=True)
    assert not cells.duplicated(subset=KEYS).any(), "grain (itemonagendaid, block) not unique"

    out = Path(args.out or d / "npx_block_direction.parquet")
    cells.to_parquet(out, index=False, compression="zstd")

    total_rows = int(cells["n_rows"].sum())
    print(f"\nWrote {out}: {len(cells):,} cells, {out.stat().st_size/1e6:.1f} MB, "
          f"{time.time()-t0:.0f}s")
    print(f"  vote rows represented: {total_rows:,}")
    print(f"  reduction: {total_rows/max(len(cells),1):.0f}x rows -> cells")

    unlinked = cells.loc[cells["block"] == "__unlinked__", "n_rows"].sum()
    print(f"  unlinked vote rows: {int(unlinked):,} "
          f"({100*unlinked/max(total_rows,1):.2f}%) — crosswalk coverage gap")

    if args.expect_rows is not None:
        if total_rows != args.expect_rows:
            sys.exit(f"FAIL reconciliation: {total_rows:,} vote rows, "
                     f"expected {args.expect_rows:,} (delta {total_rows-args.expect_rows:+,})")
        print(f"PASS reconciliation: {total_rows:,} == expected")


if __name__ == "__main__":
    main()
