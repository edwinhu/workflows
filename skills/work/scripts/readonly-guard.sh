#!/usr/bin/env bash
# readonly-guard.sh ARGS — did a readOnly run change its project tree?
#
#   readonly-guard.sh <run-dir>/args.json
#
# work-dispatch.sh snapshots a readOnly run's tree into args.readOnlyBaseline (objects kept in
# <run-dir>/readonly-objects, so nothing is written under the project's .git). This snapshots again and
# diffs. Instruction ("modify nothing") is not a guard; the auditor personas hold Bash.
#
# exit 0  clean, or nothing to compare: not a readOnly run, or no readOnlyBaseline (not a git project)
# exit 1  one or more paths added/modified/deleted; each is printed as `readOnly run changed <path>`
# exit 2  a baseline is recorded but cannot be read
#
# Ignored by design: __pycache__/, .pytest_cache/, .planning/ (audit scratch and reviews), .work/ and the run
# dir itself when it lives inside the project. Gitignored files never enter either snapshot.
set -uo pipefail
ARGS=${1:-}
[ -f "$ARGS" ] || { echo "readonly-guard: no such args file: ${ARGS:-<none>}" >&2; exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RUN=$(cd "$(dirname "$ARGS")" && pwd)

fields=$(python3 - "$ARGS" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
if a.get("readOnly") is not True or not a.get("readOnlyBaseline"):
    print("skip"); sys.exit()
print(a["readOnlyBaseline"]); print(a.get("projectDir") or "")
PY
) || { echo "readonly-guard: cannot parse $ARGS" >&2; exit 2; }
[ "$fields" = skip ] && exit 0
base=$(sed -n 1p <<<"$fields"); proj=$(sed -n 2p <<<"$fields")
objs="$RUN/readonly-objects"
[[ "$base" =~ ^[0-9a-f]{40,64}$ ]] && [ -d "$objs" ] && [ -d "$proj" ] \
  || { echo "readonly-guard: unreadable baseline (readOnlyBaseline=$base objects=$objs projectDir=$proj)" >&2; exit 2; }

now=$(bash "$HERE/tree-snapshot.sh" --objects "$objs" "$proj") && [ -n "$now" ] \
  || { echo "readonly-guard: cannot snapshot $proj" >&2; exit 2; }
top=$(git -C "$proj" rev-parse --show-toplevel) || exit 2
prefix=$(git -C "$proj" rev-parse --show-prefix)
export GIT_ALTERNATE_OBJECT_DIRECTORIES="$(git -C "$top" rev-parse --path-format=absolute --git-path objects)" GIT_OBJECT_DIRECTORY="$objs"
rel_run=""
case "$RUN/" in "$top/"*) rel_run=${RUN#"$top/"} ;; esac
list=$(mktemp "${TMPDIR:-/tmp}/readonly-guard.XXXXXX") || exit 2
trap 'rm -f "$list"' EXIT
git -C "$top" diff-tree -r --name-only --no-renames -z "$base" "$now" >"$list" \
  || { echo "readonly-guard: cannot diff baseline $base against the tree" >&2; exit 2; }
found=0
while IFS= read -r -d '' p; do
  [[ "$p" == "$prefix"* ]] || continue
  r=${p#"$prefix"}
  case "/$r" in */__pycache__/*|*/.pytest_cache/*|/.planning/*|/.work/*) continue ;; esac
  [ -n "$rel_run" ] && [[ "$p" == "$rel_run"/* || "$p" == "$rel_run" ]] && continue
  echo "readOnly run changed $r"; found=1
done <"$list"
exit $found
