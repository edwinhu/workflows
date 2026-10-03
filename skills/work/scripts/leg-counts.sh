# leg-counts.sh — the NON-VACUITY convention for a check.sh, sourced (leg_counts.py has the rule).
#
# Every gating leg prints `<leg>: N <unit> examined[ detail]`: N is what it read, not what it was handed.
# legcount_run fails a leg that printed no count line for itself, or a bare zero, as COULD-NOT-CHECK (2).
# Sourced by the dev, ds, writing and workshop check.sh here and, through scripts/checks/leg-counts.sh,
# by the teaching plugin's notes, slides and exams check.sh.
LEG_COUNTS_PY="${LEG_COUNTS_PY:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/leg_counts.py}"

# legcount_run LEG CMD... — run one leg, replay its stdout and stderr, and leave its verdict in
# LEG_STATUS: the command's own exit, raised to 2 when it printed no count line for LEG or a bare zero.
legcount_run() {
  local leg="$1"; shift
  local o e
  o="$(mktemp "${TMPDIR:-/tmp}/leg-o.XXXXXX")"; e="$(mktemp "${TMPDIR:-/tmp}/leg-e.XXXXXX")"
  "$@" >"$o" 2>"$e"
  LEG_STATUS=$?
  cat "$o"; cat "$e" >&2
  if [ "$LEG_STATUS" -lt 2 ] && ! python3 "$LEG_COUNTS_PY" audit --leg "$leg" "$o" "$e"; then
    LEG_STATUS=2
  fi
  rm -f "$o" "$e"
}

# legcount_cmd LEG DIR CMD [COUNT_RE] — a project's own command as a leg: its output on stderr, then
# its count line. A `tests` or `*-tests` leg counts the tests its runner reports (or COUNT_RE's groups); any other
# leg is one command whose exit and output are the evidence. Exit 0, or 1 for any failure: 2 is the
# audit's, never the project command's.
legcount_cmd() {
  local leg="$1" dir="$2" cmd="$3" re="${4:-}" out s got
  out="$(mktemp "${TMPDIR:-/tmp}/leg-c.XXXXXX")"
  ( cd "$dir" && eval "$cmd" ) >"$out" 2>&1
  s=$?
  cat "$out" >&2
  if [ "$leg" = tests ] || [ "${leg%-tests}" != "$leg" ]; then
    got="$(python3 "$LEG_COUNTS_PY" tests ${re:+--re "$re"} "$out")"
    if [ -n "$got" ]; then
      count_line "$leg" "${got%% *}" "test(s)" "(${got#* })" >&2
    else
      echo "$leg: no test-runner summary in the output, so what ran is unknown — pass --test-count-re" >&2
    fi
  else
    count_line "$leg" 1 "command(s)" "(exit $s)" >&2
  fi
  rm -f "$out"
  [ "$s" -eq 0 ]
}

# count_line LEG N UNIT [DETAIL] — the count line a leg wrapper computed itself.
count_line() { printf '%s: %s %s examined%s\n' "$1" "$2" "$3" "${4:+ $4}"; }

# line_total FILE... — the lines of the files that exist (a missing one is the leg's own COULD-NOT-RUN).
line_total() { local n=0 f; for f in "$@"; do [ -f "$f" ] && n=$((n + $(wc -l < "$f"))); done; echo "$n"; }
