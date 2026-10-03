#!/usr/bin/env bash
# The ONE mechanical entry point for the dev workflow. Its exit code IS the verdict.
#
# Every leg here is the PROJECT's own command, which is why they are arguments: this skill
# cannot know what a given project runs. It can still be the single command `work` reads,
# which is the whole of P10 — three separate mechanicalChecks entries lose one silently,
# and work re-runs a claimed mechanical pass in a shell, affordable for one and not three.
#
# A command not passed reports "not declared" and passes. That is deliberate and visible:
# a project with no build step should say so once, here, rather than have the plan quietly
# omit a row that nobody can tell from a forgotten one.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh). The tests leg counts the
# tests the runner reports; a runner whose summary is not recognised needs --test-count-re, a regex
# whose groups are summed, or the leg cannot say it ran anything and is COULD-NOT-CHECK.
#
# Usage: check.sh --project-dir <dir> [--test-cmd <cmd>] [--test-count-re <re>] [--lint-cmd <cmd>] [--build-cmd <cmd>]
# Exit 0 = every declared leg passed. 1 = some leg failed. 2 = refusal, or a leg that examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"

PROJ="."; TESTCMD=""; TESTRE=""; LINTCMD=""; BUILDCMD=""; DECLARED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --test-cmd) TESTCMD="${2:-}"; shift 2 ;;
    --test-count-re) TESTRE="${2:-}"; shift 2 ;;
    --lint-cmd) LINTCMD="${2:-}"; shift 2 ;;
    --build-cmd) BUILDCMD="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -d "$PROJ" ] || { echo "check.sh: --project-dir $PROJ is not a directory" >&2; exit 2; }

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }
leg() {
  local name="$1" cmd="$2"
  if [ -z "$cmd" ]; then
    count_line "$name" 0 "command(s)" "— nothing in scope (not declared)" >&2
    report "$name" 0 "not declared"; return
  fi
  DECLARED=$((DECLARED+1))
  legcount_run "$name" legcount_cmd "$name" "$PROJ" "$cmd" "$([ "$name" = tests ] && printf '%s' "$TESTRE")"
  report "$name" "$LEG_STATUS"
}

leg tests "$TESTCMD"
leg lint  "$LINTCMD"
leg build "$BUILDCMD"

# Always runs, never counts as declared: it reads the diff, not a project command.
SCAN_NOTE=""
scan_leg() {
  python3 "$HERE/diff-scan.py" "$PROJ"
  case $? in 0) return 0 ;; 3) SCAN_NOTE="not a git repo"; return 0 ;; 2) return 2 ;; *) return 1 ;; esac
}
legcount_run scan scan_leg
case $LEG_STATUS in
  0) report scan 0 "$SCAN_NOTE" ;;
  1) report scan 1 "focused/skipped test, TLS off or secret in added lines; 'scan: allow' exempts a line" ;;
  *) report scan "$LEG_STATUS" ;;
esac

# A run in which nothing was declared examined nothing, and must not read as a clean gate.
if [ "$DECLARED" -eq 0 ]; then
  echo "check.sh: no command was declared — this gate ran nothing, which is not a pass" >&2
  exit 2
fi
exit "$RC"
