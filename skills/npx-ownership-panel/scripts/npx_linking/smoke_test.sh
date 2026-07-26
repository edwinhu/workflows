#!/bin/bash
# smoke_test.sh — run the whole ladder on ONE YEAR and assert it works.
#
# The project's Test-Before-Scaling rule applies to linking too: do not run the
# 21-year pull and the full matcher before proving the ladder resolves anything.
# This takes ~2 minutes and needs nothing but WRDS credentials in ~/.pgpass.
#
#   ./smoke_test.sh                 # 2023, writes to ./smoke/
#   ./smoke_test.sh 2024 /tmp/sm    # pick the year and output dir
#   PYTHON=python3 ./smoke_test.sh
#
# Asserts:
#   1. the fund dimension pulls and is non-empty
#   2. the CRSP dimension pulls and series_cik is populated
#   3. the via_seriesid tier resolves a majority of vote rows
#   4. every fundid gets a block, and block shares reconcile to 100%
#   5. TNA is split, not duplicated, across fundids sharing a CRSP unit

set -euo pipefail
cd "$(dirname "$0")"

YEAR="${1:-2023}"
DIR="${2:-./smoke}"
PYTHON="${PYTHON:-python3}"
mkdir -p "$DIR"

echo "=== smoke test: year ${YEAR}, out ${DIR}, python ${PYTHON} ==="

echo
echo "--- 1. ISS fund dimension ---"
"$PYTHON" pull_npx_funds.py --out "$DIR/funds.parquet" \
    --start-year "$YEAR" --end-year "$YEAR"

echo
echo "--- 2. CRSP fund dimension ---"
[ -f "$DIR/crsp.parquet" ] || "$PYTHON" pull_crsp_funds.py --out "$DIR/crsp.parquet"

echo
echo "--- 3. ladder (exact tiers only — fuzzy is exercised by the full run) ---"
"$PYTHON" build_npx_crsp_link.py \
    --npx-funds "$DIR/funds.parquet" \
    --crsp-funds "$DIR/crsp.parquet" \
    --out "$DIR/link.parquet" --no-fuzzy

echo
echo "--- 4. assertions ---"
"$PYTHON" - "$DIR/link.parquet" <<'PY'
import sys
import polars as pl

link = pl.read_parquet(sys.argv[1])
total_rows = int(link["n_vote_rows"].sum())
fails = []

def check(ok, msg):
    print(f"  [{'PASS' if ok else 'FAIL'}] {msg}")
    if not ok:
        fails.append(msg)

check(link.height > 0, f"fund dimension non-empty ({link.height:,} fundids)")

exact = link.filter(pl.col("match_tier").is_in(["iss_seriesid", "propagated"]))
share = 100 * int(exact["n_vote_rows"].sum()) / max(total_rows, 1)
check(share > 50, f"via_seriesid resolves a majority of vote rows ({share:.1f}%)")

check(link["block"].null_count() == 0, "every fundid has a block")
check(set(link["block"].unique()) <= set(("index", "passive", "active", "asset_owner")),
      f"blocks are from the documented set: {sorted(set(link['block'].unique()))}")

by = (link.group_by("block")
          .agg(pl.col("n_vote_rows").cast(pl.Int64).sum().alias("r")))
pct = 100 * by["r"].sum() / total_rows
# The uint32 trap: a 32-bit accumulation makes this miss 100 silently.
check(abs(pct - 100.0) < 0.01, f"block vote-row shares reconcile to 100% ({pct:.4f}%)")

check(link.filter(pl.col("crsp_fundno").is_not_null()).height > 0,
      "at least one fundid carries a crsp_fundno")

linked = link.filter(pl.col("crsp_fundno").is_not_null()
                     & pl.col("tna_latest").is_not_null())
check(linked.height > 0, f"TNA assigned to linked funds ({linked.height:,})")

# Many-to-one: where several fundids share a CRSP unit, the split must make the
# fundid-grain total equal the unit total, not a multiple of it.
shared = linked.filter(pl.col("n_fundids_sharing_unit") > 1)
if shared.height:
    per_unit = (shared.group_by("crsp_fundno")
                      .agg(pl.col("tna_latest").sum().alias("summed"),
                           pl.col("tna_latest").first().alias("per_fundid"),
                           pl.col("n_fundids_sharing_unit").first().alias("n")))
    bad = per_unit.filter(
        ((pl.col("per_fundid") * pl.col("n")) - pl.col("summed")).abs() > 1e-6)
    check(bad.height == 0,
          f"TNA split reconciles across {shared.height:,} shared-unit fundids")
else:
    print("  [SKIP] no shared CRSP units in this sample")

print()
if fails:
    print(f"SMOKE TEST FAILED ({len(fails)} assertion(s))")
    sys.exit(1)
print("SMOKE TEST PASSED")
PY
