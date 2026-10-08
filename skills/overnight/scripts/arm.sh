#!/usr/bin/env bash
# Arm the overnight work hold for one session, until the next 09:00 local time.
#
#   arm.sh <session-id> [objective text…]
#
# Exit 0 armed (or already armed), 2 usage/no session id, 3 refused because a grind loop is live,
# 4 work-hold.sh refused. Never prints a success line it did not earn.
# Test seam: OVERNIGHT_NOW=HH:MM replaces the clock.
set -uo pipefail

SID="${1-}"; shift || true
OBJECTIVE="$*"
[ -n "$SID" ] || { echo "overnight: no session id — cannot arm a session-scoped hold. Not armed." >&2; exit 2; }

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
HOLD="$HERE/../../work/scripts/work-hold.sh"
[ -r "$HOLD" ] || { echo "overnight: work-hold.sh not found at $HOLD. Not armed." >&2; exit 2; }
export CLAUDE_CODE_SESSION_ID="$SID"
STATE="${TMPDIR:-/tmp}/work-hold-$SID.json"

if [ -f "$STATE" ]; then
  echo "overnight: a hold is already armed for this session; arming nothing."
  bash "$HOLD" --status
  exit 0
fi

# A grind loop this session launched and that is still running owns the objective; a hold beside it
# blocks the session's stop while the loop's gate waits (skills/grind/SKILL.md red flag).
for root in "${TMPDIR:-/tmp}" /tmp; do
  for f in "${root%/}/farm-events/$SID"/*.ndjson; do
    [ -f "$f" ] || continue
    grep -q '^grind: START' "$f" && ! grep -q '^grind: DONE' "$f" || continue
    pid="$(basename "$f" .ndjson)"
    if kill -0 "$pid" 2>/dev/null; then
      echo "overnight: a grind loop this session launched is live (pid $pid). A hold beside a grind on the same objective deadlocks both, so no hold is armed. The hourly heartbeat cron still applies. Not armed." >&2
      exit 3
    fi
  done
done

NOW="${OVERNIGHT_NOW:-$(date +%H:%M)}"
cur=$(( 10#${NOW%%:*} * 60 + 10#${NOW##*:} ))
ceiling=$(( (540 - cur + 1440) % 1440 ))
[ "$ceiling" -gt 0 ] || ceiling=1440
# Between 05:00 and 09:00 with under an hour left, a 60-minute floor keeps the hold from expiring at once.
if [ "$cur" -ge 300 ] && [ "$ceiling" -lt 60 ]; then ceiling=60; fi
# Rounds count blocked Stops only; one Stop a minute for the longest ceiling (24 h) is 1440, so 1500
# never binds before the clock does.
ROUNDS=1500

GOAL="Overnight mandate: ${OBJECTIVE:-everything queued before sign-off}. Met only when nothing obvious is left to do and a morning report is written."
if ! OUT="$(bash "$HOLD" --goal "$GOAL" --minutes "$ceiling" --rounds "$ROUNDS" --origin overnight 2>&1)"; then
  printf '%s\n' "$OUT" >&2
  echo "overnight: work-hold.sh refused. Not armed." >&2
  exit 4
fi
[ -f "$STATE" ] || { printf '%s\n' "$OUT" >&2; echo "overnight: work-hold.sh exited 0 but wrote no state. Not armed." >&2; exit 4; }

until_at="$(date -d "+${ceiling} minutes" +%H:%M 2>/dev/null || echo 09:00)"
echo "overnight hold armed until $until_at ($ROUNDS rounds); release: work-hold.sh --disarm"
