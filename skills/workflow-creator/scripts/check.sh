#!/usr/bin/env bash
# check.sh — the ONE mechanical entry point for a workflow skill. Its exit code IS the mechanical
# verdict: 0 only when every leg passed. A workflow declares this command and nothing else, because
# a list of N independent commands loses one silently and nothing reports a check it never knew
# about.
#
# Usage: check.sh --target <skill dir> [--agent <agent .md outside the skill dir>]
#
# Legs (all four run; none short-circuits, so one line is printed per leg every time):
#   wc-probe     the probe over --target (and --agent, which lives outside it)
#   parity       gate-vs-write-hook agreement — takes no target
#   node-check   `node --check` over <target>/*.js; PASSES when the target ships none
#   probe-tests  `bun test <target>/scripts/*.test.ts` — TARGET-relative, so pointing this at a
#                generated skill runs THAT skill's suite; a scripts/ dir with no test file FAILS
#
# stdout carries only the leg lines (the verdict); each leg's own output goes to stderr, so
# counting `^leg ` on stdout counts legs and nothing else.
#
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage, missing target).
set -uo pipefail  # deliberately not -e: every leg must run so every leg reports.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "usage: check.sh --target <skill dir> [--agent <agent .md>]" >&2
}

TARGET=""
AGENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || { echo "check.sh: --target requires a value" >&2; usage; exit 2; }
      TARGET="$2"; shift 2 ;;
    --agent)
      [ $# -ge 2 ] || { echo "check.sh: --agent requires a value" >&2; usage; exit 2; }
      AGENT="$2"; shift 2 ;;
    *)
      echo "check.sh: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$TARGET" ] || { echo "check.sh: --target is required" >&2; usage; exit 2; }
[ -d "$TARGET" ] || { echo "check.sh: --target is not a directory: $TARGET" >&2; exit 2; }
if [ -n "$AGENT" ] && [ ! -f "$AGENT" ]; then
  echo "check.sh: --agent is not a file: $AGENT" >&2
  exit 2
fi
TARGET="$(cd "$TARGET" && pwd)"

FAILED=0
# Every leg reports through here, so a leg that runs but whose status reaches no verdict is not
# expressible.
report() { # report <leg name> <exit code> [note]
  printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"
  [ "$2" -eq 0 ] || FAILED=1
}

# --- leg: wc-probe -----------------------------------------------------------------------------
if [ -n "$AGENT" ]; then
  bun "$SCRIPT_DIR/wc-probe.ts" --target "$TARGET" --agent "$AGENT" >&2
else
  bun "$SCRIPT_DIR/wc-probe.ts" --target "$TARGET" >&2
fi
report wc-probe $?

# --- leg: parity -------------------------------------------------------------------------------
bash "$SCRIPT_DIR/parity-check.sh" >&2
report parity $?

# --- leg: node-check ---------------------------------------------------------------------------
# A workflow that ships no .js is the normal case and passes; only a real syntax error fails.
node_rc=0
js_n=0
for f in "$TARGET"/*.js; do
  [ -e "$f" ] || continue
  js_n=$((js_n + 1))
  node --check "$f" >&2 || node_rc=1
done
if [ "$js_n" -eq 0 ]; then
  report node-check 0 "no .js under target"
else
  report node-check "$node_rc" "$js_n .js checked"
fi

# --- leg: probe-tests --------------------------------------------------------------------------
# Target-relative on purpose: this skill's own suite is not evidence about a generated skill.
if [ ! -d "$TARGET/scripts" ]; then
  report probe-tests 0 "target ships no scripts/"
else
  suite=()
  for f in "$TARGET"/scripts/*.test.ts; do
    [ -e "$f" ] || continue
    suite+=("$f")
  done
  if [ "${#suite[@]}" -eq 0 ]; then
    echo "check.sh: $TARGET/scripts exists but ships no *.test.ts — a scripts dir with no suite is untested machinery" >&2
    report probe-tests 1 "no *.test.ts under scripts/"
  else
    bun test "${suite[@]}" >&2
    report probe-tests $? "${#suite[@]} file(s)"
  fi
fi

exit "$FAILED"
