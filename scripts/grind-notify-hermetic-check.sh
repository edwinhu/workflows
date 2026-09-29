#!/usr/bin/env bash
# Decidable check: the grind suite must notify NOBODY.
#
# Run from inside a Claude Code session, `bun test skills/grind/scripts/` used to deliver dozens of
# real agent-msg notifications to that session, because grind.sh's DEFAULT notifier fires whenever a
# loop ends with an inherited CLAUDE_CODE_SESSION_ID and a reachable agent-msg/herdr on PATH.
#
# This runs the whole suite with a sentinel session id and a PATH whose FIRST entry holds recording
# shims named agent-msg and herdr. Each shim appends its argv to $RECORD. The check passes only when
# the suite passes AND no recorded call mentions the sentinel.
#
# Not a bun test: it runs the whole grind suite, which takes minutes, so it is a script the report
# quotes rather than something every `bun test` run pays for.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/grind-hermetic-check-XXXXXX")
trap 'rm -rf "$WORK"' EXIT

SENTINEL="sentinel-$RANDOM$RANDOM"
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

echo "== suite: bun test skills/grind/scripts/ (sentinel=$SENTINEL)"
(
  cd "$REPO" || exit 1
  PATH="$WORK/bin:$PATH" CLAUDE_CODE_SESSION_ID="$SENTINEL" \
    bun test skills/grind/scripts/ 2>&1 | tail -20
  exit "${PIPESTATUS[0]}"
)
suite_rc=$?

recorded=$(wc -l <"$RECORD" | tr -d ' ')
sentinel_hits=$(grep -c -- "$SENTINEL" "$RECORD" || true)

echo "== recorded notifier calls: $recorded (sentinel mentions: $sentinel_hits)"
[ "$recorded" -gt 0 ] && sed -n '1,10p' "$RECORD"

rc=0
[ "$suite_rc" -ne 0 ] && { echo "FAIL: suite exited $suite_rc"; rc=1; }
[ "$recorded" -ne 0 ] && { echo "FAIL: $recorded notifier call(s) escaped the suite"; rc=1; }
[ "$sentinel_hits" -ne 0 ] && { echo "FAIL: $sentinel_hits call(s) named the sentinel session"; rc=1; }
[ "$rc" -eq 0 ] && echo "PASS: suite green, 0 notifier calls recorded"
exit "$rc"
