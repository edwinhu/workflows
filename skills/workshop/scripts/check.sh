#!/usr/bin/env bash
# The ONE mechanical entry point for the workshop workflow. Its exit code IS the verdict.
#
# Two legs, none short-circuiting, so every leg reports on every run:
#   workshop-gate  `bin/workflow-check workshop --constraints-only` over --project-dir: every constraint
#                  under checks/workshop/constraints/ in every plugin root on WORKFLOW_CHECKS_PATH --
#                  this plugin's workshop-deck.py (the computed deck rows) and the typst plugin's
#                  modules -- so a constraint dropped into that directory is run with no edit here.
#                  Its Jev rules are skipped: the plan's ruleChecks (`rule-check.ts --workflow
#                  workshop`) scores them, and a leg here would pay for them twice.
#   probe-tests    the deck probe's own contract suite.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh).
#
# Usage: check.sh --plan <planPath> --project-dir <dir> [--leg workshop-gate|probe-tests]
#   --leg runs ONE leg (a caller that exercises a single leg, as a test of the gate leg does, must not pay
#   for the other; the probe suite costs ~120 s CPU). Without it every leg runs, which is what a gate wants.
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage), or a leg that examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"
PLAN=""; PROJ="."; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --leg) ONLY="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1 (usage: --plan <planPath> --project-dir <dir> [--leg <leg>])" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a deck gate with no plan checks nothing" >&2; exit 2; }
[ -d "$PROJ" ] || { echo "check.sh: --project-dir is not a directory: $PROJ" >&2; exit 2; }
case "$ONLY" in ""|workshop-gate|probe-tests) ;; *) echo "check.sh: --leg must be workshop-gate or probe-tests, got $ONLY" >&2; exit 2 ;; esac
PROJ="$(cd "$PROJ" && pwd)"

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

# The runner starts every constraint with the interpreter it runs under, so that one carries what they
# import: workshop-deck reads PDFs (pypdf), the typst modules parse XML (lxml).
if [ -z "$ONLY" ] || [ "$ONLY" = workshop-gate ]; then
legcount_run workshop-gate uv run --with pypdf --with lxml \
  python3 "$HERE/../../../bin/workflow-check" workshop --constraints-only --project-dir "$PROJ" --plan "$PLAN"
report workshop-gate "$LEG_STATUS"
fi

if [ -z "$ONLY" ] || [ "$ONLY" = probe-tests ]; then
legcount_run probe-tests legcount_cmd probe-tests "$HERE" \
  "uv run --with pypdf --with pytest --with pytest-xdist python3 -m pytest -q '$HERE'/*_test.py"
report probe-tests "$LEG_STATUS"
fi

exit "$RC"
