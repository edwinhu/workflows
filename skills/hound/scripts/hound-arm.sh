#!/usr/bin/env bash
# Arm the until Stop hook on THIS session: hold the turn until a command exits 0.
#
# No transport: a state file is written here and read by hooks/hound.ts on every Stop. Anything
# that has to be TYPED into the session instead needs the pane idle, and a session working
# back-to-back never goes idle, so it never lands.
#
#   hound-arm.sh '<check command>' [--rounds N] [--minutes M]
#   hound-arm.sh --status | --disarm
#
# Exit 0 armed, 2 usage or no session id.
set -uo pipefail

SID="${CLAUDE_CODE_SESSION_ID-}"
[ -n "$SID" ] || { echo "hound-arm: no CLAUDE_CODE_SESSION_ID — cannot arm a session-scoped hold" >&2; exit 2; }
STATE="${TMPDIR:-/tmp}/hound-$SID.json"

case "${1-}" in
  --status)
    [ -f "$STATE" ] || { echo "hound: not armed"; exit 0; }
    echo "hound: ARMED — $STATE"; cat "$STATE"; echo
    LOG="${STATE%.json}.releases.log"
    [ -s "$LOG" ] && { echo "  release attempts this session:"; sed "s/^/    /" "$LOG"; }
    exit 0 ;;
  --disarm)
    # RELEASE IS THE USER'S, NOT THE SESSION'S. The arm-time guards refuse a check that is already
    # green or cannot run, because a session will rationalise; then release was left to the same
    # judgment, and "this gate measures the wrong property" is equally available to a session that
    # simply finds the gate hard. Measured 2026-09-21: one session released itself twice in an
    # evening, each time with a reason it believed.
    #
    # An env flag would not hold -- a session runs this in a shell and can set one. A confirmation
    # read from /dev/tty can only be answered by a human at a terminal, so this fails closed for an
    # agent and stays one keystroke for the user. Every attempt is logged either way.
    LOG="${STATE%.json}.releases.log"
    if [ ! -f "$STATE" ]; then echo "hound: not armed"; exit 0; fi
    if [ ! -r /dev/tty ] || [ ! -t 0 ] && ! { exec 3</dev/tty; } 2>/dev/null; then
      printf '%s\trefused (no tty)\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
      echo "hound-arm: --disarm needs the USER to confirm at a terminal, and there is none here." >&2
      echo "  The hold is not yours to release: ask the user, or arm a different check instead." >&2
      echo "  A gate that measures the wrong property is replaced by arming the right one, not by stopping." >&2
      exit 2
    fi
    exec 3</dev/tty
    printf 'hound: release the hold on `%s`? [y/N] ' "$(jq -r .check "$STATE" 2>/dev/null)" > /dev/tty
    read -r ans <&3 || ans=""
    exec 3<&-
    case "$ans" in
      y|Y|yes|YES)
        printf '%s\treleased by user\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        rm -f "$STATE"; echo "hound: disarmed (user confirmed)"; exit 0 ;;
      *)
        printf '%s\tdeclined\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        echo "hound: still armed"; exit 2 ;;
    esac ;;
  "" | -*)
    echo "usage: hound-arm.sh '<check command>' [--rounds N] [--minutes M] | --status | --disarm" >&2
    exit 2 ;;
esac

CHECK="$1"; shift
ROUNDS=8; MINUTES=720
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds)  ROUNDS="${2-}"; shift 2 ;;
    --minutes) MINUTES="${2-}"; shift 2 ;;
    *) echo "hound-arm: unknown flag $1" >&2; exit 2 ;;
  esac
done

# REFUSE A CHECK THAT ALREADY PASSES. Arming on a met objective holds nothing and teaches the
# session that the hold is noise; arming on one that cannot RUN (exit 2, 127) would hold it
# forever on a broken command.
OUT=$(bash -lc "$CHECK" 2>&1); RC=$?
if [ "$RC" -eq 0 ]; then
  echo "hound-arm: that check ALREADY exits 0 — nothing to hold. Not armed." >&2; exit 2
fi
if [ "$RC" -gt 1 ]; then
  echo "hound-arm: that check exits $RC, which is could-not-run rather than a verdict." >&2
  printf '%s\n' "$OUT" | tail -3 >&2
  echo "hound-arm: fix the command first. Not armed." >&2; exit 2
fi

python3 - "$STATE" "$CHECK" "$ROUNDS" "$MINUTES" <<'PY'
import json, sys, time
path, check, rounds, minutes = sys.argv[1:5]
json.dump({"check": check, "startedAt": int(time.time()),
           "ceilingMinutes": int(minutes), "maxRounds": int(rounds), "rounds": 0},
          open(path, "w"))
PY
# LINT THE CHECK AS A SPECIFICATION, not just as a runtime fact. The two refusals above are
# behavioural (green, or could-not-run); these are the rules SKILL.md states and nothing enforced
# until 2026-09-21, when two gates passed arm-time validation and were still mis-specified.
# A critical refuses; anything else is printed and armed anyway, because "the gate measures the
# wrong property" is judgment and stays the session's problem.
LINT="$(dirname "$(readlink -f "$0")")/hold-lint.ts"
if [ -r "$LINT" ] && command -v bun >/dev/null 2>&1; then
  LINT_OUT=$(bun "$LINT" "$CHECK" 2>&1); LINT_RC=$?
  if [ "$LINT_RC" -eq 1 ]; then
    printf '%s\n' "$LINT_OUT"
    if printf '%s' "$LINT_OUT" | grep -q "^CRITICAL"; then
      echo "hound-arm: fix the critical finding(s) above first. Not armed." >&2
      exit 2
    fi
  fi
fi

echo "hound: ARMED on \`$CHECK\` (currently exits $RC)"
echo "  ceiling: $ROUNDS rounds or $MINUTES minutes, whichever first"
printf '%s\tarmed\t%s\n' "$(date -Is)" "$(cat "$STATE")" >> "${STATE%.json}.releases.log"
echo "  state:   $STATE"
echo "  release: --disarm, which requires the USER to confirm at a terminal"
