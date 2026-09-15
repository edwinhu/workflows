#!/usr/bin/env bash
# The ONE mechanical entry point for the workshop workflow. Its exit code IS the verdict.
#
# Three legs, none short-circuiting, so every leg reports on every run. They were three
# separate mechanicalChecks entries until 2026-09-15; a list of N independent commands
# loses one silently, and craft re-runs a claimed mechanical pass in a shell, which is
# affordable for one command and not for three.
#
# Usage: check.sh --plan <planPath> --project-dir <dir>
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage).
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN=""; PROJ="."
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1 (usage: --plan <planPath> --project-dir <dir>)" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a deck gate with no plan checks nothing" >&2; exit 2; }

FAILED=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -eq 0 ] || FAILED=1; }

uv run --with pypdf python3 "$HERE/workshop-deck.py" --plan "$PLAN" --project-dir "$PROJ" >&2
report workshop-deck $?

# The constraint runner is canonical and lives in the typst plugin. Absence is exit 2 from
# typst-constraints, never a shorter run that reports clean.
if RUNNER_DIR="$(typst-constraints --dir 2>/dev/null)"; then
  python3 "$RUNNER_DIR/workshop/run-constraints.py" presentation >&2
  report constraints $?
else
  echo "check.sh: typst plugin not installed — NO Typst constraint ran, which is not a clean deck" >&2
  report constraints 2 "typst plugin absent"
fi

uv run --with pypdf --with pytest python3 -m pytest -q "$HERE/workshop_deck_test.py" >&2
report probe-tests $?

exit "$FAILED"
