#!/usr/bin/env bash
# The ONE mechanical entry point for the workshop workflow. Its exit code IS the verdict.
#
# Three legs, none short-circuiting, so every leg reports on every run. They were three
# separate mechanicalChecks entries until 2026-09-15; a list of N independent commands
# loses one silently, and work re-runs a claimed mechanical pass in a shell, which is
# affordable for one command and not for three.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh).
#
# Usage: check.sh --plan <planPath> --project-dir <dir>
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage), or a leg that examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"
PLAN=""; PROJ="."
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1 (usage: --plan <planPath> --project-dir <dir>)" >&2; exit 2 ;;
  esac
done
[ -n "$PLAN" ] || { echo "check.sh: --plan is required — a deck gate with no plan checks nothing" >&2; exit 2; }

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

deck_leg() { uv run --with pypdf python3 "$HERE/workshop-deck.py" --plan "$PLAN" --project-dir "$PROJ" >&2; }
legcount_run workshop-deck deck_leg
report workshop-deck "$LEG_STATUS"

# The constraint runner is canonical and lives in the typst plugin. Absence is exit 2 from
# typst-constraints, never a shorter run that reports clean.
# The runner's JSON carries each module's `inspected` file count; their sum is what the leg examined.
constraints_leg() {
  local out s
  out="$(python3 "$RUNNER_DIR/workshop/run-constraints.py" presentation)"
  s=$?
  printf '%s\n' "$out" >&2
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
mods = [e for k in ("passed", "failed", "errors", "skipped") for e in d.get(k) or [] if isinstance(e, dict)]
n = d.get("inspected_total")
n = sum(int(e.get("inspected") or 0) for e in mods) if n is None else n
print("constraints: %d file inspection(s) examined by %d module(s)" % (n, len(mods)))' >&2
  return "$s"
}
if RUNNER_DIR="$(typst-constraints --dir 2>/dev/null)"; then
  legcount_run constraints constraints_leg
  report constraints "$LEG_STATUS"
else
  echo "check.sh: typst plugin not installed — NO Typst constraint ran, which is not a clean deck" >&2
  report constraints 2 "typst plugin absent"
fi

legcount_run probe-tests legcount_cmd probe-tests "$HERE" \
  "uv run --with pypdf --with pytest --with pytest-xdist python3 -m pytest -q '$HERE/workshop_deck_test.py'"
report probe-tests "$LEG_STATUS"

exit "$RC"
