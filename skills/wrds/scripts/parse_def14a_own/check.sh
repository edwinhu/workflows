#!/bin/bash
#
# check.sh — the grind loop's --check. Exits 0 ONLY when every gated metric in
# thresholds.json is cleared by the most recent scored parser output.
#
# It scores; it does not parse. The grid pass is run_baseline.sh, and the grind
# --gate waits for the marker that pass writes. A check that re-ran the grid
# would spend ten minutes of scheduler time every time the loop asks a question.
#
#   DEF14A_WORK   where the fetched shard output lives (default below)
#   GOLD_DIR      the gold sets (default /data/def14a_own/gold)
#
# Exit codes: 0 all metrics pass, 1 a metric is short, 2 no output to score OR
#             the parser output does not cover the ISS gold filings, the sample or
#             the regression set (score.py refuses to compute a gated rate over a
#             partial denominator), 3 the hash lock does not verify.
#
# TWELVE metrics gate as of 2026-10-01 — the keys under `minimums` (floors) plus
# the keys under `maximums` (ceilings) in thresholds.json: the five older floors,
# `sample_yield_worst_year_margin`, the two identical-row duplicate ceilings, and
# `regress_zero_row_recovered` / `regress_group_row_recovered` / `regress_lost_recovered` /
# `regress_lost_d_recovered`.
# This script never names them; score.py reads the gated set from the locked
# thresholds file.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${DEF14A_WORK:-/data/def14a_own/work}"
GOLD="${GOLD_DIR:-/data/def14a_own/gold}"

shopt -s nullglob
rows=("$WORK"/out/*.tsv.gz)
shopt -u nullglob
if (( ${#rows[@]} == 0 )); then
    echo "check: no parser output under $WORK/out — run run_baseline.sh first" >&2
    exit 2
fi

exec python3 "$HERE/scorer/score.py" \
    --rows "$WORK/out/*[0-9].tsv.gz" \
    --manifest "$WORK/out/*.manifest.tsv.gz" \
    --gold-dir "$GOLD" \
    --thresholds "$HERE/thresholds.json" \
    --lock "$HERE/lock.sha256" \
    --miss-report "$WORK/miss_dev.tsv" \
    --iss-miss-report "$WORK/miss_iss_dev.tsv" \
    --sample-report "$WORK/sample_by_year.tsv" \
    --regress-report "$WORK/regress_dev.tsv" \
    --json-out "$WORK/metrics_dev.json" \
    --check
