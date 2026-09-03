#!/usr/bin/env bash
# Drain queued "/goal ..." and "/loop ..." lines into a Claude Code pane, one per idle window.
#
# Runs DETACHED, outside the turn that enqueued. That is the whole point: `herdr agent prompt`
# delivers text+Enter even to a working agent (documented), but Claude Code enqueues a prompt that
# arrives mid-turn and does NOT parse slash commands out of it — the line lands as literal text and
# no goal is ever set. Measured 2026-09-02: 4 of 4 inline self-sends recorded promptSource="queued"
# with no `Goal set:` receipt; the identical line delivered to an idle pane expanded normally.
# `agent wait` before each send is what makes the difference, so never send without it.
#
# One send per idle window, sequentially: a delivered "/goal" starts a turn, so the next line has to
# wait that turn out or it queues exactly as before.
#
# Usage: goal-send-drain.sh <pane-id> <queue-file>
set -uo pipefail
PANE="${1-}"; Q="${2-}"
[ -n "$PANE" ] && [ -n "$Q" ] || exit 2
LOG="$Q.log"
LOCK="$Q.lock"

# One drainer per queue. A second enqueue while this one is alive just appends.
exec 9>"$LOCK" || exit 2
flock -n 9 || exit 0

while :; do
  [ -s "$Q" ] || break
  CMD=$(head -n1 "$Q")
  # `--until done` as well as `--until idle`: per herdr's docs `done` is the same underlying idle
  # state for a tab that has not been refocused, which is every backgrounded session.
  herdr agent wait "$PANE" --until idle --until done --timeout "${GOAL_SEND_WAIT_MS:-900000}" \
    >>"$LOG" 2>&1 || { echo "drain: wait failed for $PANE, leaving queue intact" >>"$LOG"; exit 5; }
  # Idle means "not working", NOT "no human at the keyboard". Measured 2026-09-02: a send to a
  # FOCUSED pane interleaved with the user's own typing and corrupted their message. Give a focused
  # pane a grace window to become unfocused, then send anyway — a late goal beats no goal.
  for _ in $(seq 1 "${GOAL_SEND_FOCUS_TRIES:-12}"); do
    FOCUSED=$(herdr agent list 2>/dev/null | jq -r --arg p "$PANE" \
      '[.result.agents[]? | select(.pane_id == $p)][0].focused // false' 2>/dev/null)
    [ "$FOCUSED" = "true" ] || break
    sleep "${GOAL_SEND_FOCUS_SLEEP:-5}"
  done
  OUT=$(herdr agent prompt "$PANE" "$CMD" 2>&1)
  printf '%s\n' "$OUT" >>"$LOG"
  if printf '%s' "$OUT" | grep -q 'agent_prompted'; then
    # Pop only on a confirmed delivery, so a failure leaves the line for the next drainer.
    tail -n +2 "$Q" > "$Q.tmp" && mv "$Q.tmp" "$Q"
    echo "drain: sent ${CMD%% *} to $PANE at $(date +%T)" >>"$LOG"
  else
    echo "drain: NOT delivered (${CMD%% *}) — leaving queue intact" >>"$LOG"
    exit 5
  fi
  # The line we just sent starts a turn; do not race it with the next one.
  sleep 3
done
exit 0
