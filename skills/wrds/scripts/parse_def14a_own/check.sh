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
# Exit codes: 0 all metrics pass, 1 a metric is short, 2 no output to score,
#             3 the hash lock does not verify.

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
    --json-out "$WORK/metrics_dev.json" \
    --check
