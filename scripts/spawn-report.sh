#!/usr/bin/env bash
# spawn-report.sh -- a spawned child session's one way to report to the session that spawned it.
#
#   spawn-report.sh --session <parent session id> --tmpdir <parent TMPDIR> --label <child tab name> \
#     --outcome DONE|BLOCKED|ERROR --summary '<one line>' --report <absolute path of the full report>
#
# Writes one run, atomically, into the PARENT's stream <tmpdir>/farm-events/<session>/<$$>.ndjson:
#   spawn: START <label> cwd=<pwd> out=<report> t=<epoch s>
#   spawn: DONE <label> <outcome> summary=<summary>
# values percent-encoded by enc(). The parent's watcher (hooks/watch/watcher.ts) wakes the parent once
# with a line naming the summary and the report path, never the report text. The caller (agent-spawn's
# spawn.sh) supplies --session and --tmpdir from the parent's CLAUDE_CODE_SESSION_ID and TMPDIR.
# Prints the event file's path. Exit 2: bad usage, and nothing written.
set -uo pipefail

# Byte semantics for every check below, whatever the caller's locale.
export LC_ALL=C
# The child's own stream is never the destination, so nothing below may reach it.
unset TMPDIR CLAUDE_CODE_SESSION_ID session tmpdir label outcome summary report

usage() { printf 'spawn-report.sh: %s\n' "$1" >&2; exit 2; }
fail() { printf 'spawn-report.sh: %s\n' "$1" >&2; exit 1; }

# Byte-identical to farm.sh's enc(): one protocol.
enc() {
  local s=${1-}
  s=${s//%/%25}; s=${s// /%20}; s=${s//$'\t'/%09}; s=${s//=/%3D}
  printf '%s' "$s"
}

# C0, DEL, C1 and U+2028/U+2029 -- the set the watcher scrubs. enc() leaves them raw, and a line
# break would split the record into a forged line.
has_control() {
  case $1 in
    *[$'\001'-$'\037'$'\177']*|*$'\302'[$'\200'-$'\237']*|*$'\342\200'[$'\250'$'\251']*) return 0 ;;
  esac
  return 1
}

# Anything JavaScript's \s matches: the watcher reads a label as \S+, and one holding any of these
# leaves both lines unparsed, so the report would be lost without an error.
has_space() {
  case $1 in
    *' '*|*$'\302\240'*|*$'\341\232\200'*|*$'\342\200'[$'\200'-$'\212'$'\257']*|*$'\342\201\237'*|*$'\343\200\200'*|*$'\357\273\277'*) return 0 ;;
  esac
  has_control "$1"
}

while (( $# )); do
  case $1 in
    --session|--tmpdir|--label|--outcome|--summary|--report)
      (( $# >= 2 )) || usage "$1 needs a value"
      printf -v "${1#--}" '%s' "$2"
      shift 2 ;;
    *) usage "unknown argument $(printf '%q' "$1")" ;;
  esac
done
for f in session tmpdir label outcome summary report; do
  [ -n "${!f+x}" ] || usage "missing --$f"
done

[[ $session =~ ^[A-Za-z0-9_-]+$ ]] || usage "--session must match ^[A-Za-z0-9_-]+\$"
case $outcome in DONE|BLOCKED|ERROR) ;; *) usage "--outcome must be DONE, BLOCKED or ERROR" ;; esac
[ -n "$summary" ] || usage "--summary is empty"
has_control "$summary" && usage "--summary contains a control character"
chars=${summary//[$'\200'-$'\277']/}   # UTF-8 continuation bytes dropped: characters, not bytes
(( ${#chars} <= 300 )) || usage "--summary is over 300 characters"
[ -n "$label" ] || usage "--label is empty"
has_space "$label" && usage "--label contains whitespace or a control character"
[[ $report == /* ]] || usage "--report is not an absolute path"
has_control "$report" && usage "--report contains a control character"
[ -f "$report" ] || usage "--report is not a regular file"
[ -s "$report" ] || usage "--report is empty"
[ -d "$tmpdir" ] || usage "--tmpdir is not an existing directory"
has_control "$PWD" && usage "the working directory's path contains a control character"

dir=$tmpdir/farm-events/$session
file=$dir/$$.ndjson
start="spawn: START $(enc "$label") cwd=$(enc "$PWD") out=$(enc "$report") t=$(date +%s)"
end="spawn: DONE $(enc "$label") $outcome summary=$(enc "$summary")"

# Never START alone on disk: the watcher reads a START whose pid is dead and has no DONE as GONE.
mkdir -p "$dir" || fail "cannot create $dir"
if [ -e "$file" ]; then
  # pid reuse left an earlier run's file under this name: one write appends both lines together.
  printf '%s\n%s\n' "$start" "$end" >> "$file" || fail "cannot append to $file"
else
  tmp=$(mktemp "$dir/.spawn-report.XXXXXX") || fail "cannot create a temp file in $dir"
  if ! printf '%s\n%s\n' "$start" "$end" > "$tmp" || ! mv -f "$tmp" "$file"; then
    rm -f "$tmp"
    fail "cannot write $file"
  fi
fi
printf '%s\n' "$file"
