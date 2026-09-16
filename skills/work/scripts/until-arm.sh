#!/usr/bin/env bash
# Arm the until Stop hook on THIS session: hold the turn until a command exits 0.
#
# This is the half of until that needs no transport. `goal-self-send.sh` queues a
# /goal and a drainer types it when the pane goes idle — and a session working back-to-back
# never goes idle, so the goal never lands. Writing a state file has no such window.
#
#   until-arm.sh '<check command>' [--rounds N] [--minutes M]
#   until-arm.sh --status | --disarm
#
# Exit 0 armed, 2 usage or no session id.
set -uo pipefail

SID="${CLAUDE_CODE_SESSION_ID-}"
[ -n "$SID" ] || { echo "until-arm: no CLAUDE_CODE_SESSION_ID — cannot arm a session-scoped hold" >&2; exit 2; }
STATE="${TMPDIR:-/tmp}/until-$SID.json"

case "${1-}" in
  --status)
    [ -f "$STATE" ] || { echo "until: not armed"; exit 0; }
    echo "until: ARMED — $STATE"; cat "$STATE"; echo; exit 0 ;;
  --disarm)
    rm -f "$STATE"; echo "until: disarmed"; exit 0 ;;
  "" | -*)
    echo "usage: until-arm.sh '<check command>' [--rounds N] [--minutes M] | --status | --disarm" >&2
    exit 2 ;;
esac

CHECK="$1"; shift
ROUNDS=8; MINUTES=720
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds)  ROUNDS="${2-}"; shift 2 ;;
    --minutes) MINUTES="${2-}"; shift 2 ;;
    *) echo "until-arm: unknown flag $1" >&2; exit 2 ;;
  esac
done

# REFUSE A CHECK THAT ALREADY PASSES. Arming on a met objective holds nothing and teaches the
# session that the hold is noise; arming on one that cannot RUN (exit 2, 127) would hold it
# forever on a broken command.
OUT=$(bash -lc "$CHECK" 2>&1); RC=$?
if [ "$RC" -eq 0 ]; then
  echo "until-arm: that check ALREADY exits 0 — nothing to hold. Not armed." >&2; exit 2
fi
if [ "$RC" -gt 1 ]; then
  echo "until-arm: that check exits $RC, which is could-not-run rather than a verdict." >&2
  printf '%s\n' "$OUT" | tail -3 >&2
  echo "until-arm: fix the command first. Not armed." >&2; exit 2
fi

python3 - "$STATE" "$CHECK" "$ROUNDS" "$MINUTES" <<'PY'
import json, sys, time
path, check, rounds, minutes = sys.argv[1:5]
json.dump({"check": check, "startedAt": int(time.time()),
           "ceilingMinutes": int(minutes), "maxRounds": int(rounds), "rounds": 0},
          open(path, "w"))
PY
echo "until: ARMED on \`$CHECK\` (currently exits $RC)"
echo "  ceiling: $ROUNDS rounds or $MINUTES minutes, whichever first"
echo "  state:   $STATE   (rm it, or --disarm, to release)"
