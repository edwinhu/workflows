#!/usr/bin/env bash
# Drain queued "/goal ..." and "/loop ..." lines into a Claude Code pane, one per idle window.
#
# Runs DETACHED, outside the turn that enqueued, because a prompt arriving mid-turn is enqueued by
# Claude Code and lands as literal text. `agent wait` before each send is therefore mandatory.
#
# TRANSPORT IS `pane send-text` + `send-keys enter`, NOT `agent prompt`. Measured 2026-09-03:
# `agent prompt` honors the terminal's live bracketed-paste mode (its own docs say so), and Claude
# Code does not run a slash command out of a paste — it inserts the text and submits it as an
# ordinary message. In one session three consecutive `agent prompt` sends to a confirmed-idle pane
# all landed literal, including a 94-character /loop, while /loop lines the user typed minutes
# later executed normally. Length is not the variable: a 2,373-char goal has executed and a
# 182-char one has not. A 679-char goal sent by send-text+enter executed with a `Goal set:` receipt.
#
# `agent prompt` was adopted because its `agent_prompted` event was a delivery receipt and the old
# screen-scrape readback was not. That reasoning was right about the readback and wrong about what
# needed proving: delivery is not execution. Confirmation now reads the TRANSCRIPT for the
# `<command-name>` record Claude Code writes only when it actually parses the command.
#
# Usage: goal-send-drain.sh <pane-id> <queue-file>
set -uo pipefail
PANE="${1-}"; Q="${2-}"
[ -n "$PANE" ] && [ -n "$Q" ] || exit 2
LOG="$Q.log"; LOCK="$Q.lock"
SID=$(basename "$Q" .q); SID="${SID#herdr-goal-send-}"

exec 9>"$LOCK" || exit 2
flock -n 9 || exit 0

# Did Claude Code actually PARSE the command? Only an executed slash command writes a
# <command-name> record; a literal paste is stored as the raw text and writes nothing.
confirmed() {
  local kind="$1" since="$2"
  local file; file=$(find "$HOME/.claude/projects" -maxdepth 2 -name "$SID.jsonl" -print -quit 2>/dev/null)
  [ -n "$file" ] || return 1
  GC_FILE="$file" GC_KIND="$kind" GC_SINCE="$since" python3 - <<'PY'
import json, os, sys, datetime
f, kind, since = os.environ["GC_FILE"], os.environ["GC_KIND"], float(os.environ["GC_SINCE"])
marker = f"<command-name>/{kind}</command-name>"
for line in open(f, errors="replace"):
    try: d = json.loads(line)
    except Exception: continue
    c = d.get("content") if isinstance(d.get("content"), str) else d.get("message", {}).get("content")
    if not isinstance(c, str) or marker not in c: continue
    ts = d.get("timestamp")
    if not ts: continue
    try: t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception: continue
    if t >= since - 5: sys.exit(0)
sys.exit(1)
PY
}

while :; do
  [ -s "$Q" ] || break
  CMD=$(head -n1 "$Q")
  KIND=$(printf '%s' "${CMD%% *}" | tr -d '/')
  # `agent wait` returning idle does not mean the pane is STILL idle when Enter lands -- a session
  # with a background job can start working in between, and then the line is queued as literal
  # text. Measured 2026-09-03 on nport-join. So a /goal is re-attempted: setting the same goal
  # twice is idempotent. A /loop is NOT -- two lines mean two crons -- so it gets one attempt.
  ATTEMPTS=1
  [ "$KIND" = "goal" ] && ATTEMPTS="${GOAL_SEND_ATTEMPTS:-4}"
  OK=0
  for attempt in $(seq 1 "$ATTEMPTS"); do
    herdr agent wait "$PANE" --until idle --until done --timeout "${GOAL_SEND_WAIT_MS:-900000}" \
      >>"$LOG" 2>&1 || { echo "drain: wait failed for $PANE" >>"$LOG"; break; }

    # Idle means "not working", NOT "no human at the keyboard": a send to a FOCUSED pane
    # interleaves with the user's own typing. Grace window, then send anyway.
    for _ in $(seq 1 "${GOAL_SEND_FOCUS_TRIES:-12}"); do
      FOCUSED=$(herdr agent list 2>/dev/null | jq -r --arg p "$PANE" \
        '[.result.agents[]? | select(.pane_id == $p)][0].focused // false' 2>/dev/null)
      [ "$FOCUSED" = "true" ] || break
      sleep "${GOAL_SEND_FOCUS_SLEEP:-5}"
    done
    SENT_AT=$(date +%s)
    # CHUNKED, and the chunk size is not arbitrary. Claude Code turns a single inserted string
    # into a "[Pasted text #N]" block when it exceeds 800 characters (`kre=800` in the bundle) or
    # ~2 lines, and its slash parser requires the input to literally start with "/" -- a paste
    # placeholder never does. Sub-threshold inserts concatenate in the input box exactly like
    # typing, which is why a goal the user TYPES works at any length and a 1,346-char one sent in
    # one call never parses. Keep chunks well under 800.
    i=0; n="${GOAL_SEND_CHUNK:-600}"
    while [ "$i" -lt "${#CMD}" ]; do
      herdr pane send-text "$PANE" "${CMD:$i:$n}" >>"$LOG" 2>&1 \
        || { echo "drain: send-text failed" >>"$LOG"; exit 5; }
      i=$((i + n))
      sleep 0.3
    done
    sleep 1
    herdr pane send-keys "$PANE" enter >>"$LOG" 2>&1 || { echo "drain: send-keys failed" >>"$LOG"; exit 5; }

    # The record is written when the turn the command starts is flushed, so allow real time.
    for _ in $(seq 1 "${GOAL_SEND_CONFIRM_TRIES:-30}"); do
      if confirmed "$KIND" "$SENT_AT"; then OK=1; break; fi
      sleep "${GOAL_SEND_CONFIRM_SLEEP:-5}"
    done
    [ "$OK" = 1 ] && break
    echo "drain: /$KIND attempt $attempt of $ATTEMPTS did not confirm" >>"$LOG"
  done

  # Pop either way. A resend is not safe to guess at — two /loop lines mean two crons — and
  # goal-verify.sh is the check that tells the session the truth on its next turn.
  tail -n +2 "$Q" > "$Q.tmp" && mv "$Q.tmp" "$Q"
  if [ "$OK" = 1 ]; then
    echo "drain: /$KIND EXECUTED on $PANE at $(date +%T)" >>"$LOG"
  else
    echo "drain: /$KIND UNCONFIRMED on $PANE at $(date +%T) — it may have landed as literal text" >>"$LOG"
    printf '%s\n' "$CMD" >> "$Q.unconfirmed"
  fi
  sleep 3
done
exit 0
