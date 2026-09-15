#!/usr/bin/env bash
# Is the dispatch that will write $1 (a result.json path) still running?
#
# Keys on the RUN, not the runner: $TMPDIR/farm-events/<pid>.ndjson is written by the runner's
# emitter, its START line carries out=<the --out path>, its CLAIM lines carry every artifact the
# run promised, and the FILENAME is the pid. setsid forks, so the caller's $! is not the runner's
# $$ — the event file is the only honest link between a run and its pid. Exit 0 iff some run
# claiming $1 is alive.
#
# Normalisation is symmetric by construction: the emitter writes both the caller's spelling and
# its realpath -m form, and we look for either spelling of our own argument. Normalising on one
# side only reports a live run dead whenever the two sides spell the same file differently.
set -uo pipefail

out=${1:-}
[ -n "$out" ] || { echo "usage: farm-alive.sh <result.json path>" >&2; exit 2; }

dir="${TMPDIR:-/tmp}/farm-events"
[ -d "$dir" ] || exit 1

# Values in the event stream are percent-encoded by farm.sh's enc() over exactly space, tab, `=`
# and `%`, so a caller-supplied label cannot spell a second `out=` field inside a well-formed line
# and point us at somebody else's run. Encode our own argument identically -- the two functions are
# one protocol, and matching a raw path against an encoded stream silently reports every live run
# dead once a path contains one of those bytes.
enc() {
  local s=${1-}
  s=${s//%/%25}; s=${s// /%20}; s=${s//$'\t'/%09}; s=${s//=/%3D}
  printf '%s' "$s"
}

canon=$(realpath -m -- "$out" 2>/dev/null) || canon=$out
e_out=$(enc "$out")
pats=(-e " out=$e_out " -e " path=$e_out ")
if [ "$canon" != "$out" ]; then
  e_canon=$(enc "$canon")
  pats+=(-e " out=$e_canon " -e " path=$e_canon ")
fi

shopt -s nullglob
for f in "$dir"/*.ndjson; do
  grep -qF "${pats[@]}" -- "$f" 2>/dev/null || continue
  pid=$(basename "$f" .ndjson)
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$pid" 2>/dev/null && exit 0
done
exit 1
