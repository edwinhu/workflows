#!/usr/bin/env bash
# Watch every farm-out run in this session. One line per milestone.
#
# Declared in monitors/monitors.json as `on-skill-invoke:farm-out`, so it starts
# the first time the skill is dispatched and runs for the session. It takes NO
# arguments — a plugin monitor's command is fixed — so it watches a conventional
# directory instead of a log path a caller passes.
#
# The directory is under TMPDIR, not the repo: this is session-scoped,
# high-frequency state and does not belong in anyone's working tree.
#
# WHY A SCRIPT AND NOT `tail -F`: silence has to be distinguishable from death. A
# tail is equally quiet whether a farm is thinking or was killed, and a watch that
# greps only success signatures says nothing in both cases. This reports the
# farm's own milestones AND notices a run whose process is gone without a DONE.
set -uo pipefail

DIR="${TMPDIR:-/tmp}/farm-events"
mkdir -p "$DIR" 2>/dev/null || exit 0

declare -A seen_lines=()
declare -A reported_gone=()

while :; do
  for f in "$DIR"/*.ndjson; do
    [ -e "$f" ] || continue
    pid=$(basename "$f" .ndjson)
    total=$(grep -c '' "$f" 2>/dev/null || echo 0)
    prev=${seen_lines[$f]:-0}
    if [ "$total" -gt "$prev" ]; then
      sed -n "$((prev + 1)),${total}p" "$f" 2>/dev/null
      seen_lines[$f]=$total
    fi
    # A finished run is one that wrote DONE. Anything else whose pid is gone died
    # mid-flight, which is the case a caller most needs told about.
    if ! grep -q ' DONE ' "$f" 2>/dev/null \
       && ! kill -0 "$pid" 2>/dev/null \
       && [ -z "${reported_gone[$f]:-}" ]; then
      echo "farm: GONE pid=$pid — exited with no DONE line; see $f"
      reported_gone[$f]=1
    fi
  done
  sleep 20
done
