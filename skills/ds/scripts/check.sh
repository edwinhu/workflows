#!/usr/bin/env bash
# The ONE mechanical entry point for the ds workflow. Its exit code IS the verdict.
#
# Three legs, none short-circuiting. Two of them are the PROJECT's own commands, which a
# plan discovers and passes in -- that is why they are arguments rather than a fixed list:
# this skill cannot know what a given project runs, but it can still be the single command
# whose exit code `work` reads. A plan that has no test or lint command omits the flag and
# the leg reports "not declared" rather than silently not existing.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh); see dev/scripts/check.sh
# for the tests leg's --test-count-re.
#
# Usage: check.sh --plan <planPath> --project-dir <dir> [--test-cmd <cmd>] [--test-count-re <re>] [--lint-cmd <cmd>]
# Exit 0 = every declared leg passed. 1 = some leg failed. 2 = refusal, or a leg that examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"
PLAN=""; PROJ="."; TESTCMD=""; TESTRE=""; LINTCMD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --test-cmd) TESTCMD="${2:-}"; shift 2 ;;
    --test-count-re) TESTRE="${2:-}"; shift 2 ;;
    --lint-cmd) LINTCMD="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a data gate with no plan checks nothing" >&2; exit 2; }

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

ds_dq_leg() { uv run --with polars python3 "$HERE/ds-dq.py" --plan "$PLAN" --project-dir "$PROJ" >&2; }
legcount_run ds-dq ds_dq_leg
report ds-dq "$LEG_STATUS"

if [ -n "$TESTCMD" ]; then legcount_run tests legcount_cmd tests "$PROJ" "$TESTCMD" "$TESTRE"; report tests "$LEG_STATUS"
else count_line tests 0 "command(s)" "— nothing in scope (not declared)" >&2; report tests 0 "not declared"; fi

if [ -n "$LINTCMD" ]; then legcount_run lint legcount_cmd lint "$PROJ" "$LINTCMD"; report lint "$LEG_STATUS"
else count_line lint 0 "command(s)" "— nothing in scope (not declared)" >&2; report lint 0 "not declared"; fi

exit "$RC"
