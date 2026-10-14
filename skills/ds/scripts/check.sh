#!/usr/bin/env bash
# The ONE mechanical entry point for the ds workflow. Its exit code IS the verdict.
#
# Four legs, none short-circuiting. ds-gate is this plugin's: `bin/workflow-check ds --constraints-only`, which
# runs every constraint under checks/ds/constraints/ (ds-dq over the plan's Data Outputs among them), so a new
# constraint script is reached with no edit here. Its Jev rules are skipped: this plan's ruleChecks already
# scores them (`rule-check.ts --workflow ds`), and work reads that verdict, so a leg here would pay for it twice. The other two legs are the
# PROJECT's own commands, which a plan discovers and passes in -- that is why they are
# arguments rather than a fixed list:
# this skill cannot know what a given project runs, but it can still be the single command
# whose exit code `work` reads. A plan with no test or lint command passes --no-test-cmd /
# --no-lint-cmd; omitting both the command and the opt-out is exit 2, never a leg that ran nothing.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh); see dev/scripts/check.sh
# for the tests leg's --test-count-re.
#
# The ds-dq-tests leg runs the runner's own contract suite (ds_dq_test.py; DS_DQ_SUITE overrides the path), so an edit that
# breaks ds-dq's parse turns the gate red.
#
# Usage: check.sh --plan <planPath> --project-dir <dir> (--test-cmd <cmd> | --no-test-cmd) [--test-count-re <re>] (--lint-cmd <cmd> | --no-lint-cmd)
# Exit 0 = every declared leg passed. 1 = some leg failed. 2 = refusal, or a leg that examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"
PLAN=""; PROJ="."; TESTCMD=""; TESTRE=""; LINTCMD=""; NOTEST=0; NOLINT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --test-cmd) TESTCMD="${2:-}"; shift 2 ;;
    --test-count-re) TESTRE="${2:-}"; shift 2 ;;
    --lint-cmd) LINTCMD="${2:-}"; shift 2 ;;
    --no-test-cmd) NOTEST=1; shift ;;
    --no-lint-cmd) NOLINT=1; shift ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a data gate with no plan checks nothing" >&2; exit 2; }
[ -n "$TESTCMD" ] || [ "$NOTEST" = 1 ] || { echo "check.sh: pass --test-cmd or --no-test-cmd — an undeclared test leg would pass having run nothing" >&2; exit 2; }
[ -n "$LINTCMD" ] || [ "$NOLINT" = 1 ] || { echo "check.sh: pass --lint-cmd or --no-lint-cmd — an undeclared lint leg would pass having run nothing" >&2; exit 2; }

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

legcount_run ds-gate python3 "$HERE/../../../bin/workflow-check" ds --project-dir "$PROJ" --plan "$PLAN" --constraints-only
report ds-gate "$LEG_STATUS"

POLARS_PIN="$(sed -n 's/^POLARS_PIN = "\([0-9.]*\)".*/\1/p' "$HERE/../../../checks/ds/constraints/ds-dq.py")"
[ -n "$POLARS_PIN" ] || { echo "check.sh: POLARS_PIN not found in ds-dq.py" >&2; exit 2; }
echo "ds-dq-tests: polars==$POLARS_PIN" >&2
SUITE="${DS_DQ_SUITE:-$HERE/ds_dq_test.py}"
legcount_run ds-dq-tests legcount_cmd ds-dq-tests "$HERE" "uv run --with polars==$POLARS_PIN --with pytest python3 -m pytest -o addopts= -p no:cacheprovider \"$SUITE\" -q"
report ds-dq-tests "$LEG_STATUS"

if [ -n "$TESTCMD" ]; then legcount_run tests legcount_cmd tests "$PROJ" "$TESTCMD" "$TESTRE"; report tests "$LEG_STATUS"
else count_line tests 0 "command(s)" "— nothing in scope (declined by plan)" >&2; report tests 0 "declined by plan"; fi

if [ -n "$LINTCMD" ]; then legcount_run lint legcount_cmd lint "$PROJ" "$LINTCMD"; report lint "$LEG_STATUS"
else count_line lint 0 "command(s)" "— nothing in scope (declined by plan)" >&2; report lint 0 "declined by plan"; fi

exit "$RC"
