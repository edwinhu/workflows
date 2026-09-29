#!/usr/bin/env bash
# Watch every farm-out run in this session. One line per milestone.
#
# Declared in monitors/monitors.json as `always`, so it runs for the whole
# session — monitors are not restored on resume, and `on-skill-invoke` would
# leave the wake dead until the skill happened to run again. It takes NO
# arguments — a plugin monitor's command is fixed — so it watches a conventional
# directory instead of a log path a caller passes.
#
# The directory is under TMPDIR, not the repo, and is keyed by CLAUDE_CODE_SESSION_ID
# — TMPDIR alone is per-USER, so without that key every concurrent session's runs
# land in one directory and each monitor reports the others' milestones and kill -0's
# pids it does not own.
#
# WHY A SCRIPT AND NOT `tail -F`: silence has to be distinguishable from death. A
# tail is equally quiet whether a farm is thinking or was killed, and a watch that
# greps only success signatures says nothing in both cases. This reports the
# farm's own milestones AND notices a run whose process is gone without a DONE.
#
# AND IT MUST DIE WITH ITS SESSION: `always` means every session that ends abnormally
# leaks one of these. One ran 11 days reparented to init, polling a dead session's
# directory every 20s with nobody left to read a line of it.
set -uo pipefail

DIR="${TMPDIR:-/tmp}/farm-events${CLAUDE_CODE_SESSION_ID:+/$CLAUDE_CODE_SESSION_ID}"
mkdir -p "$DIR" 2>/dev/null || exit 0

POLL_SECONDS="${FARM_MONITOR_POLL_SECONDS:-20}"

# Field 4 of /proc/<pid>/stat is the ppid, but field 2 is the comm and may contain
# spaces and parens, so split after the LAST ") " rather than on whitespace.
parent_of() {
  local stat
  if stat=$(cat "/proc/$1/stat" 2>/dev/null); then
    stat=${stat##*') '}
    set -- $stat          # $1 state, $2 ppid
    printf '%s\n' "${2:-}"
  else
    ps -o ppid= -p "$1" 2>/dev/null | tr -d ' '
  fi
}

# The harness runs a monitor under a bash wrapper (its args carry .claude/shell-snapshots),
# so match on the EXECUTABLE, not a substring of the command line.
exe_basename() {
  local exe
  exe=$(readlink "/proc/$1/exe" 2>/dev/null)
  exe=${exe% (deleted)}
  [ -n "$exe" ] || exe=$(ps -o comm= -p "$1" 2>/dev/null)
  printf '%s\n' "${exe##*/}"
}

# The owning session is an ANCESTOR, not the parent.
find_owner() {
  local pid=$PPID depth=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$depth" -lt 64 ]; do
    if [ "$(exe_basename "$pid")" = claude ]; then printf '%s\n' "$pid"; return; fi
    pid=$(parent_of "$pid")
    depth=$((depth + 1))
  done
  # No claude in the chain (a hand-run monitor, a test harness): the direct parent is
  # the best available proxy for "whatever started us is still here".
  printf '%s\n' "$PPID"
}

OWNER_PID=$(find_owner)

declare -A seen_lines=()
declare -A reported_gone=()

while :; do
  # $PPID does not track reparenting, so read the live ppid: 1 means the harness is gone.
  kill -0 "$OWNER_PID" 2>/dev/null || exit 0
  [ "$(parent_of $$)" = 1 ] && exit 0
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
  sleep "$POLL_SECONDS"
done
