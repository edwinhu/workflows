#!/usr/bin/env bash
# Decidable check: these suites must notify NOBODY and must write NO events into the caller's
# session event stream.
#
# Two leaks, one run, because both have the same cause -- a test that hands a child the ambient
# session identity:
#
#   1. NOTIFIER. grind.sh's DEFAULT notifier fires whenever a loop ends with an inherited
#      CLAUDE_CODE_SESSION_ID and a reachable agent-msg/herdr on PATH. Recorded here by a PATH whose
#      FIRST entry holds shims named agent-msg and herdr that append their argv to $RECORD.
#
#   2. EVENTS. farm.sh (EVENT_DIR) and grind.sh (events_start) both write START/ITER/DONE rows to
#      "$TMPDIR/farm-events/$CLAUDE_CODE_SESSION_ID/$$.ndjson". A test that passes the caller's own
#      TMPDIR *and* session id makes its throwaway loop indistinguishable from a real dispatch, and
#      the session's watcher mod wakes on it as a real run. Detected here by running
#      with the caller's REAL TMPDIR and a sentinel session id, then asserting that nothing appeared
#      -- and nothing grew -- under <real TMPDIR>/farm-events/<sentinel>.
#
# The event half MUST use the real TMPDIR: pointing the whole run at a scratch TMPDIR would make the
# leak invisible, which is exactly the bug being guarded against.
#
# Not a bun test: it runs whole suites, which takes minutes, so it is a script the report quotes
# rather than something every `bun test` run pays for.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REAL_TMPDIR="${TMPDIR:-/tmp}"
WORK=$(mktemp -d "$REAL_TMPDIR/grind-hermetic-check-XXXXXX")

SENTINEL="sentinel-$RANDOM$RANDOM"
WATCH="$REAL_TMPDIR/farm-events/$SENTINEL"
trap 'rm -rf "$WORK" "$WATCH"' EXIT

RECORD="$WORK/recorded.txt"
: >"$RECORD"

mkdir -p "$WORK/bin"
for name in agent-msg herdr; do
  cat >"$WORK/bin/$name" <<EOF
#!/usr/bin/env bash
printf '%s %s\n' "$name" "\$*" >> "$RECORD"
exit 0
EOF
  chmod +x "$WORK/bin/$name"
done

# The suites under audit: every one of them launches farm.sh or grind.sh.
TARGETS=(tests/child-standing-instruction.test.ts tests/early-stop.test.ts skills/grind/scripts/)

# name<TAB>lines for every file in the watch dir. Comparing two of these catches a NEW file and a
# file that GREW, which a bare file count would miss.
manifest() {
  local f
  shopt -s nullglob
  for f in "$WATCH"/*; do
    printf '%s\t%s\n' "$(basename -- "$f")" "$(wc -l <"$f" | tr -d ' ')"
  done | sort
}

mkdir -p "$WATCH"
# A pre-existing file, so "no file grows" is asserted over something and not vacuously true.
printf 'farm: PRE-EXISTING baseline row\n' >"$WATCH/baseline.ndjson"
manifest >"$WORK/before.txt"

echo "== suites: bun test ${TARGETS[*]}"
echo "== sentinel session: $SENTINEL"
echo "== watching for event leaks under: $WATCH"
(
  cd "$REPO" || exit 1
  PATH="$WORK/bin:$PATH" CLAUDE_CODE_SESSION_ID="$SENTINEL" TMPDIR="$REAL_TMPDIR" \
    bun test "${TARGETS[@]}" 2>&1 | tail -20
  exit "${PIPESTATUS[0]}"
)
suite_rc=$?

manifest >"$WORK/after.txt"

recorded=$(wc -l <"$RECORD" | tr -d ' ')
sentinel_hits=$(grep -c -- "$SENTINEL" "$RECORD" || true)

leaked_files=$(comm -13 <(cut -f1 "$WORK/before.txt") <(cut -f1 "$WORK/after.txt") | wc -l | tr -d ' ')
grown_files=$(comm -13 "$WORK/before.txt" "$WORK/after.txt" | cut -f1 |
  grep -Fxf <(cut -f1 "$WORK/before.txt") | wc -l | tr -d ' ')
leaked_lines=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  leaked_lines=$((leaked_lines + $(wc -l <"$WATCH/$f" | tr -d ' ')))
done < <(comm -13 <(cut -f1 "$WORK/before.txt") <(cut -f1 "$WORK/after.txt"))

echo "== recorded notifier calls: $recorded (sentinel mentions: $sentinel_hits)"
[ "$recorded" -gt 0 ] && sed -n '1,10p' "$RECORD"
echo "== leaked event files: $leaked_files ($leaked_lines line(s)); pre-existing files that grew: $grown_files"
if [ "$leaked_files" -gt 0 ]; then
  comm -13 <(cut -f1 "$WORK/before.txt") <(cut -f1 "$WORK/after.txt") | head -5 |
    while IFS= read -r f; do printf '   %s: ' "$f"; head -1 "$WATCH/$f"; done
fi

rc=0
[ "$suite_rc" -ne 0 ] && { echo "FAIL: suites exited $suite_rc"; rc=1; }
[ "$recorded" -ne 0 ] && { echo "FAIL: $recorded notifier call(s) escaped the suites"; rc=1; }
[ "$sentinel_hits" -ne 0 ] && { echo "FAIL: $sentinel_hits call(s) named the sentinel session"; rc=1; }
[ "$leaked_files" -ne 0 ] && { echo "FAIL: $leaked_files event file(s), $leaked_lines line(s), written to the caller's session stream"; rc=1; }
[ "$grown_files" -ne 0 ] && { echo "FAIL: $grown_files pre-existing event file(s) grew"; rc=1; }
[ "$rc" -eq 0 ] && echo "PASS: suites green, 0 notifier calls, 0 event rows in the caller's stream"
exit "$rc"
