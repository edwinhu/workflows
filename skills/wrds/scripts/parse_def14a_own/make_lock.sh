#!/bin/bash
#
# make_lock.sh — write lock.sha256 over the ruler: the scorer, the thresholds and
# the four gold files. score.py verifies it before it scores anything, so a loop
# that edits the scorer or widens a threshold is caught rather than believed.
#
# Run this ONLY when the gold sets or the scoring definition change on purpose,
# never from inside a grind iteration.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLD="${GOLD_DIR:-/data/def14a_own/gold}"
{
  echo "# lock.sha256 — verified by scorer/score.py before every scoring run."
  echo "# Regenerate with make_lock.sh; never edit by hand, never from a grind iteration."
  for f in scorer/score.py thresholds.json; do
    printf '%s  %s\n' "$(sha256sum "$HERE/$f" | cut -d' ' -f1)" "$f"
  done
  for f in gold_blockw.tsv.gz gold_factset.tsv.gz gold_factset_firmyear.tsv.gz holdout.tsv; do
    printf '%s  gold/%s\n' "$(sha256sum "$GOLD/$f" | cut -d' ' -f1)" "$f"
  done
} > "$HERE/lock.sha256"
cat "$HERE/lock.sha256"
