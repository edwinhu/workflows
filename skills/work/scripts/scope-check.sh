#!/usr/bin/env bash
# scope-check.sh — fail when a path THIS run changed is under no task's writablePaths or scaffoldPaths.
#
#   scope-check.sh --plan PLAN [--project-dir DIR]
#
# The changed set is checks/_lib/changed.py's: the tree $WORK_RUN_BASELINE (work-checks.sh exports it to
# mechanical checks) against now, else the working tree against HEAD plus untracked files. Containment is
# work-dispatch.sh --covers / --scaffold, so this leg and the dispatch guard cannot disagree. `.planning/`
# and the plan file itself are the run's own bookkeeping, not scope.
# Exit 0 = every changed path is declared. 1 = stray path(s), each named. 2 = plan, baseline or git unreadable.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/leg-counts.sh"
PLAN=""; PROJ="."
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:-}"; shift 2 ;;
    --project-dir) PROJ="${2:-}"; shift 2 ;;
    *) echo "scope-check: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -f "$PLAN" ] || { echo "scope-check: --plan ${PLAN:-<missing>} is not a readable file" >&2; exit 2; }
[ -d "$PROJ" ] || { echo "scope-check: --project-dir $PROJ is not a directory" >&2; exit 2; }
PROJ="$(cd "$PROJ" && pwd -P)"; PLAN="$(cd "$(dirname "$PLAN")" && pwd -P)/$(basename "$PLAN")"

CHANGED="$(CHECKS_LIB="$HERE/../../../checks/_lib" python3 -I - "$PROJ" <<'PY'
import os, sys
sys.path.insert(0, os.environ['CHECKS_LIB'])
import changed
names = changed.changed_files(sys.argv[1])
if names is None:
    sys.exit(2)
print('\n'.join(names))
PY
)" || { echo "scope-check: cannot compute the changed-file set in $PROJ (not a git tree, or the baseline is unreadable)" >&2; exit 2; }

N=0; STRAY=()
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  abs="$PROJ/$rel"
  case "$rel" in .planning/*) continue ;; esac
  [ "$abs" = "$PLAN" ] && continue
  N=$((N + 1))
  bash "$HERE/work-dispatch.sh" --covers "$PLAN" "$abs"; c=$?
  [ "$c" -eq 0 ] && continue
  [ "$c" -eq 2 ] && { echo "scope-check: $PLAN has no readable work:dispatch block or no writablePaths — scope is undecidable" >&2; exit 2; }
  bash "$HERE/work-dispatch.sh" --scaffold "$PLAN" "$abs"; s=$?
  [ "$s" -eq 0 ] && continue
  [ "$s" -eq 2 ] && { echo "scope-check: $PLAN scaffoldPaths unreadable" >&2; exit 2; }
  STRAY+=("$rel")
done <<< "$CHANGED"

if [ "$N" -eq 0 ]; then
  count_line scope 0 "path(s)" "— nothing in scope (no file changed this run)"
else
  count_line scope "$N" "path(s)"
fi
if [ "${#STRAY[@]}" -gt 0 ]; then
  echo "scope-check: ${#STRAY[@]} changed path(s) under no task's writablePaths or scaffoldPaths:"
  printf '  %s\n' "${STRAY[@]}"
  exit 1
fi
