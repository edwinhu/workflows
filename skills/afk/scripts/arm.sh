#!/usr/bin/env bash
# Arm the afk work hold for one session, until the next 09:00 local time.
#
#   arm.sh <session-id> [objective text…]
#
# Every refusal prints "... Not armed." on stdout and exits 0: the SKILL.md `!` line runs this, and a
# non-zero exit there drops the whole skill body. AFK_STRICT=1 restores the distinct codes for tests:
# 2 usage/bad session id, 3 a grind loop is live, 4 work-hold.sh refused.
# Never prints a success line it did not earn. Test seam: AFK_NOW=HH:MM replaces the clock.
set -uo pipefail

refuse() { echo "$2"; [ "${AFK_STRICT-}" = 1 ] && exit "$1"; exit 0; }

SID="${1-}"; shift || true
OBJECTIVE="$*"
case "$SID" in
  ''|-*) refuse 2 "usage: arm.sh <session-id> [objective text…]
afk: no usable session id (${SID:-empty}) — cannot arm a session-scoped hold. Not armed." ;;
esac

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
HOLD="$HERE/../../work/scripts/work-hold.sh"
[ -r "$HOLD" ] || refuse 2 "afk: work-hold.sh not found at $HOLD. Not armed."
export CLAUDE_CODE_SESSION_ID="$SID"
STATE="${TMPDIR:-/tmp}/work-hold-$SID.json"

# An afk hold already armed (on top or queued) arms nothing. Any other hold is borrowed: the afk hold
# queues BEHIND it, so the mandate is recorded and takes over when that hold releases (nevada
# e83fb488, 2026-10-08: nothing recorded it, and early-stop sent the model to AskUserQuestion).
BEHIND=""; AHEAD=""
if [ -f "$STATE" ]; then
  read -r has_afk AHEAD < <(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
hs = [s] + [q for q in (s.get("queued") or []) if isinstance(q, dict)]
afk = any(h.get("origin") in ("afk", "overnight") for h in hs)
print("1" if afk else "0", s.get("run") or s.get("goal") or s.get("check") or "?")
' "$STATE" 2>/dev/null || echo "0 ?")
  if [ "${has_afk:-0}" = 1 ]; then
    echo "afk: an afk hold is already armed for this session; arming nothing."
    bash "$HOLD" --status
    exit 0
  fi
  BEHIND=1
fi

# A grind loop this session launched and that is still running owns the objective; a hold beside it
# blocks the session's stop while the loop's gate waits (skills/grind/SKILL.md red flag).
for root in "${TMPDIR:-/tmp}" /tmp; do
  for f in "${root%/}/farm-events/$SID"/*.ndjson; do
    [ -f "$f" ] || continue
    grep -q '^grind: START' "$f" && ! grep -q '^grind: DONE' "$f" || continue
    pid="$(basename "$f" .ndjson)"
    if kill -0 "$pid" 2>/dev/null; then
      refuse 3 "afk: a grind loop this session launched is live (pid $pid). A hold beside a grind on the same objective deadlocks both, so no hold is armed. The hourly heartbeat cron still applies. Not armed."
    fi
  done
done

NOW="${AFK_NOW:-$(date +%H:%M)}"
cur=$(( 10#${NOW%%:*} * 60 + 10#${NOW##*:} ))
ceiling=$(( (540 - cur + 1440) % 1440 ))
[ "$ceiling" -gt 0 ] || ceiling=1440
# Between 05:00 and 09:00 with under an hour left, a 60-minute floor keeps the hold from expiring at once.
if [ "$cur" -ge 300 ] && [ "$ceiling" -lt 60 ]; then ceiling=60; fi
# Rounds count blocked Stops only; one Stop a minute for the longest ceiling (24 h) is 1440, so 1500
# never binds before the clock does.
ROUNDS=1500

GOAL="Afk mandate: ${OBJECTIVE:-everything queued before sign-off}. Met only when nothing obvious is left to do and a morning report is written."
if ! OUT="$(bash "$HOLD" --goal "$GOAL" --minutes "$ceiling" --rounds "$ROUNDS" --origin afk ${BEHIND:+--behind} 2>&1)"; then
  refuse 4 "$OUT
afk: work-hold.sh refused. Not armed."
fi
[ -f "$STATE" ] || refuse 4 "$OUT
afk: work-hold.sh exited 0 but wrote no state. Not armed."

until_at="$(date -d "+${ceiling} minutes" +%H:%M 2>/dev/null || echo 09:00)"
if [ -n "$BEHIND" ]; then
  echo "afk hold queued behind the armed $AHEAD; it takes over when that one releases (ceiling $until_at, $ROUNDS rounds)"
  bash "$HOLD" --status
  exit 0
fi
echo "afk hold armed until $until_at ($ROUNDS rounds); release: work-hold.sh --disarm"
