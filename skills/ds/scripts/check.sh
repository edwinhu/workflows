#!/usr/bin/env bash
# The ONE mechanical entry point for the ds workflow. Its exit code IS the verdict.
#
# Three legs, none short-circuiting. Two of them are the PROJECT's own commands, which a
# plan discovers and passes in -- that is why they are arguments rather than a fixed list:
# this skill cannot know what a given project runs, but it can still be the single command
# whose exit code craft reads. A plan that has no test or lint command omits the flag and
# the leg reports "not declared" rather than silently not existing.
#
# Usage: check.sh --plan <planPath> --project-dir <dir> [--test-cmd <cmd>] [--lint-cmd <cmd>]
# Exit 0 = every declared leg passed. 1 = some leg failed. 2 = refusal (bad usage).
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN=""; PROJ="."; TESTCMD=""; LINTCMD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --test-cmd) TESTCMD="${2:-}"; shift 2 ;;
    --lint-cmd) LINTCMD="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a data gate with no plan checks nothing" >&2; exit 2; }

FAILED=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -eq 0 ] || FAILED=1; }

uv run --with polars python3 "$HERE/ds-dq.py" --plan "$PLAN" --project-dir "$PROJ" >&2
report ds-dq $?

if [ -n "$TESTCMD" ]; then ( cd "$PROJ" && eval "$TESTCMD" ) >&2; report tests $?
else report tests 0 "not declared"; fi

if [ -n "$LINTCMD" ]; then ( cd "$PROJ" && eval "$LINTCMD" ) >&2; report lint $?
else report lint 0 "not declared"; fi

exit "$FAILED"
