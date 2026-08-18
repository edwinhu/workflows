#!/usr/bin/env bash
# Print the slug of a persisted tuicr review session, so the agent can feed it to
# `tuicr review comments --session <slug>` / `tuicr review add --session <slug>`.
#
# usage:
#   resolve-session.sh            # newest session for the current repo (cwd)
#   resolve-session.sh 70         # newest session whose slug/anchor matches PR 70
#   resolve-session.sh --all      # newest session across every repo (ignores cwd)
#
# Sessions live at ~/.local/share/tuicr/reviews/sessions/*.json; `tuicr review list` enumerates
# them with updated_at. We pick the most-recently-updated match. Prints nothing (exit 1) if none.
set -euo pipefail

TUICR_BIN=$(command -v tuicr 2>/dev/null || true)
[ -z "$TUICR_BIN" ] && { echo "error: tuicr not found in PATH" >&2; exit 1; }

SCOPE=(--repo .)
FILTER=""
for a in "$@"; do
    case "$a" in
        --all) SCOPE=(--all) ;;
        *) FILTER="$a" ;;
    esac
done

JSON=$("$TUICR_BIN" review list "${SCOPE[@]}" 2>/dev/null || echo '[]')

printf '%s' "$JSON" | FILTER="$FILTER" python3 -c '
import json, os, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
f = os.environ.get("FILTER", "")
if f:
    rows = [r for r in rows if f in (r.get("slug","") + " " + str(r.get("anchor","")))]
rows.sort(key=lambda r: r.get("updated_at",""), reverse=True)
if rows:
    print(rows[0]["slug"])
    sys.exit(0)
sys.exit(1)
'
