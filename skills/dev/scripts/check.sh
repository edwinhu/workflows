#!/usr/bin/env bash
# The ONE mechanical entry point for the dev workflow. Its exit code IS the verdict.
#
# Every leg here is the PROJECT's own command, which is why they are arguments: this skill
# cannot know what a given project runs. It can still be the single command craft reads,
# which is the whole of P10 — three separate mechanicalChecks entries lose one silently,
# and craft re-runs a claimed mechanical pass in a shell, affordable for one and not three.
#
# A command not passed reports "not declared" and passes. That is deliberate and visible:
# a project with no build step should say so once, here, rather than have the plan quietly
# omit a row that nobody can tell from a forgotten one.
#
# Usage: check.sh --project-dir <dir> [--test-cmd <cmd>] [--lint-cmd <cmd>] [--build-cmd <cmd>]
# Exit 0 = every declared leg passed. 1 = some leg failed. 2 = refusal.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

PROJ="."; TESTCMD=""; LINTCMD=""; BUILDCMD=""; DECLARED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    --test-cmd) TESTCMD="${2:-}"; shift 2 ;;
    --lint-cmd) LINTCMD="${2:-}"; shift 2 ;;
    --build-cmd) BUILDCMD="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -d "$PROJ" ] || { echo "check.sh: --project-dir $PROJ is not a directory" >&2; exit 2; }

FAILED=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -eq 0 ] || FAILED=1; }
leg() {
  local name="$1" cmd="$2"
  if [ -z "$cmd" ]; then report "$name" 0 "not declared"; return; fi
  DECLARED=$((DECLARED+1))
  ( cd "$PROJ" && eval "$cmd" ) >&2
  report "$name" $?
}

leg tests "$TESTCMD"
leg lint  "$LINTCMD"
leg build "$BUILDCMD"

# A run in which nothing was declared examined nothing, and must not read as a clean gate.
if [ "$DECLARED" -eq 0 ]; then
  echo "check.sh: no command was declared — this gate ran nothing, which is not a pass" >&2
  exit 2
fi
exit "$FAILED"
