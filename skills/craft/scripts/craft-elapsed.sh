#!/usr/bin/env bash
# How long has this craft run been going, and is it past the goal's wall-clock ceiling?
#
#   craft-elapsed.sh <run-dir> [max-hours]
#
# Prints one line the Stop-hook judge can read as evidence, and exits 0 when the ceiling is reached
# so a caller can branch on it too.
#
# Rounds are not time. Measured 2026-08-19 (mail-bridge): rounds took 3h+ each, so a `rounds >= 4`
# escape sat twelve hours out while nobody was awake to close the human half of the goal. The run
# was working the whole time and still could not stop.
#
# The clock lives HERE, not in the goal text: a Stop-hook judge reading a transcript cannot
# subtract timestamps reliably, but it can read one printed line that already says CEILING REACHED.
set -euo pipefail

RUN_DIR=${1:?usage: craft-elapsed.sh <run-dir> [max-hours]}
MAX_HOURS=${2:-${CRAFT_GOAL_MAX_HOURS:-8}}
case "$MAX_HOURS" in ''|*[!0-9]*) echo "max-hours must be a whole number, got: $MAX_HOURS" >&2; exit 2 ;; esac
[ -d "$RUN_DIR" ] || { echo "no such run dir: $RUN_DIR" >&2; exit 2; }

# args.json is written at dispatch and rewritten on a re-dispatch, so it dates the CURRENT round.
# The run dir itself is created once and is the honest start of the whole run.
start_epoch=$(stat -c %Y "$RUN_DIR" 2>/dev/null || stat -f %B "$RUN_DIR")
now_epoch=$(date +%s)
elapsed_min=$(( (now_epoch - start_epoch) / 60 ))
[ "$elapsed_min" -lt 0 ] && elapsed_min=0   # a dir mtime in the future is a clock skew, not a run
elapsed_h=$(( elapsed_min / 60 ))
rounds_on_disk=$(find "$RUN_DIR" -maxdepth 1 -name 'result-round*.json' | wc -l)

printf 'craft run %s: %dh%02dm elapsed, %s completed round(s) on disk, ceiling %dh\n' \
  "$(basename "$RUN_DIR")" "$elapsed_h" "$(( elapsed_min % 60 ))" "$rounds_on_disk" "$MAX_HOURS"

if [ "$elapsed_h" -ge "$MAX_HOURS" ]; then
  printf 'CEILING REACHED — the goal is satisfied by elapsed time; stop and report where the run got to.\n'
  exit 0
fi
printf 'under the ceiling — the goal is not satisfied by time yet.\n'
exit 1
