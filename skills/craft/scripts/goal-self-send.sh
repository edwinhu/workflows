#!/usr/bin/env bash
# Self-send a "/goal ..." user-message into THIS Claude Code session.
#
# Delivery arrives as a user keypress in our own conversation, so the goal survives compaction.
# Transport is whichever one can reach us: herdr `pane send-text` + `send-keys` into our own pane
# (verified by reading the input line back), else `agent-msg` if the session is Remote-Control.
# Neither is guaranteed; a non-zero exit is informational, not fatal — craft's caller falls back to
# the plan hash as the standing gate text.
#
# Usage: goal-self-send.sh "/goal <text>"   |   goal-self-send.sh "/goal clear"
#
# Exit codes (all verified by execution against a stubbed herdr/agent-msg):
#   0  submitted (input box cleared after Enter), or agent-msg accepted it as user input
#   2  argument is not "/goal <non-empty text>" or "/goal clear"        — nothing sent
#   3  no transport can reach this session                              — nothing sent
#   4  cannot identify/trust the target: no session id, >1 pane claims it, the claiming record is
#      not a claude id-session, or HERDR_PANE_ID disagrees with herdr  — nothing sent
#   5  a send was attempted and failed: send-text failed, text never reached the box, the Enter was
#      never taken after three presses over ~5s, or agent-msg send failed
#   6  the pane's input box was already non-empty (user mid-type)       — nothing sent
#   7  the only reachable transport cannot produce a slash command: agent-msg without
#      --as-user routes a PEER message, which the recipient enqueues with slash commands
#      disabled, so the goal would never be set                         — nothing sent
set -uo pipefail

CMD="${1-}"
case "$CMD" in
  "/goal clear") ;;
  "/goal "*) [[ -n "${CMD:6}" && "${CMD:6}" =~ [^[:space:]] ]] || { echo "goal-self-send: empty /goal body" >&2; exit 2; } ;;
  *) echo "goal-self-send: argument must be '/goal <text>' or '/goal clear'" >&2; exit 2 ;;
esac

SID="${CLAUDE_CODE_SESSION_ID-}"
[[ -n "$SID" ]] || { echo "goal-self-send: CLAUDE_CODE_SESSION_ID unset — cannot identify this session" >&2; exit 4; }

# ---- transport 1: herdr (works for any pane-hosted session, RC or not) ----------------------
if command -v herdr >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  LIST=$(herdr agent list 2>/dev/null) || LIST=""
  if [[ -n "$LIST" ]]; then
    # Only records CLAIMING our session id are examined. A neighbouring pane mid-launch legitimately
    # has no agent_session, and must not make our own send fail closed.
    CLAIMS=$(printf '%s' "$LIST" | jq -r --arg sid "$SID" \
      '[.result.agents[]? | select((.agent_session.value // "") == $sid)] | length' 2>/dev/null || echo 0)
    if [[ "$CLAIMS" -gt 1 ]]; then
      echo "goal-self-send: $CLAIMS panes claim session $SID — ambiguous, refusing to send" >&2
      exit 4
    fi
    if [[ "$CLAIMS" -eq 1 ]]; then
      PANE=$(printf '%s' "$LIST" | jq -r --arg sid "$SID" \
        '[.result.agents[]? | select((.agent_session.value // "") == $sid)][0]
         | select(.agent == "claude" and .agent_session.kind == "id") | .pane_id // empty' 2>/dev/null)
      if [[ -z "$PANE" ]]; then
        echo "goal-self-send: record for $SID is malformed or not a claude session — refusing to send" >&2
        exit 4
      fi
      # HERDR_PANE_ID is exported into every descendant of the launching pane, so when it exists it
      # is an independent second witness. Disagreement is unsafe, not "try the other transport" —
      # the fallback would reach the same contested session by another road.
      if [[ -n "${HERDR_PANE_ID-}" && "$PANE" != "$HERDR_PANE_ID" ]]; then
        echo "goal-self-send: herdr says $SID is on pane $PANE but we occupy ${HERDR_PANE_ID} — refusing to send" >&2
        exit 4
      fi
      # `agent prompt` fuses paste-and-Enter, and that fusion is where the documented race lives:
      # Claude Code collapses a bracketed paste and the trailing Enter gets swallowed, leaving the
      # text in the input box. Its own `--wait` cannot catch that for a SELF-send — per `herdr agent
      # prompt --help`, agent_prompt_stalled only fires when "submission starts from a non-working
      # state" (a self-send never does), and --wait "does not track turns: if the agent is already
      # working, that active turn's completion may match", so --until working is true on evaluation
      # and --until idle blocks on the very turn making this call, indefinitely without --timeout.
      #
      # So: decompose into send-text + send-keys and check the input box ourselves. "Was it
      # PROCESSED" is unanswerable from here (it needs our turn to end), but "was it SUBMITTED" is
      # answerable immediately — a submitted message leaves the input line and queues, a swallowed
      # Enter leaves the text sitting there. Retrying just the Enter is idempotent.
      #
      # Read the LAST `❯` line: `--source visible` includes the transcript, where echoed user
      # messages also start with `❯`. The input box is the bottom-most one.
      input_line() {
        herdr pane read "$PANE" --source visible 2>/dev/null | grep '^❯' | tail -1 | sed 's/^❯[[:space:]]*//'
      }

      # Pre-flight: never type into an input box that already has something in it. This is the
      # collision guard — if the user is mid-message, our paste would merge with their line and the
      # Enter would submit their half-written text as ours.
      if [[ -n "$(input_line)" ]]; then
        echo "goal-self-send: input box on $PANE is not empty (user may be typing) — refusing to send" >&2
        exit 6
      fi

      herdr pane send-text "$PANE" "$CMD" >/dev/null 2>&1 || {
        echo "goal-self-send: herdr pane send-text failed for $PANE" >&2; exit 5; }

      # A landed paste makes the box non-empty — literally, or as a collapsed `[Pasted text #1]`.
      sleep 0.15
      if [[ -z "$(input_line)" ]]; then
        echo "goal-self-send: text never reached the input box on $PANE" >&2
        exit 5
      fi

      # Poll generously and re-press RARELY. Measured: a ~230-char goal took longer than 1.15s for
      # the box to clear, so a tight loop reports a false "unsubmitted" on a message that landed —
      # and every iteration that re-pressed Enter risked submitting it twice. The box clearing is a
      # render, not an ack: absence of clearing is weak evidence early and strong evidence late.
      herdr pane send-keys "$PANE" Enter >/dev/null 2>&1
      for i in $(seq 1 20); do
        sleep 0.25
        if [[ -z "$(input_line)" ]]; then
          echo "goal-self-send: delivered via herdr (pane $PANE)"
          exit 0
        fi
        # Re-press only at ~2s and ~4s: by then a still-full box means the Enter was genuinely
        # swallowed rather than the TUI being slow.
        if [[ "$i" == "8" || "$i" == "16" ]]; then
          herdr pane send-keys "$PANE" Enter >/dev/null 2>&1
        fi
      done

      # Enter was genuinely swallowed. LEAVE THE BOX AS WE FOUND IT — the pre-flight above
      # proved it was empty before we typed, so everything in it now is ours and clearing is
      # safe. Skipping this is a deadlock, not an inconvenience: our own stale text makes the
      # box non-empty, the collision guard then refuses every future send with exit 6, and craft
      # cannot self-send again until a human clears the box by hand. Observed 2026-08-23.
      #
      # `ctrl+u` is the spelling herdr accepts; `ctrl-u` and `C-u` are rejected outright.
      herdr pane send-keys "$PANE" ctrl+u >/dev/null 2>&1
      sleep 0.3
      if [[ -n "$(input_line)" ]]; then
        herdr pane send-keys "$PANE" ctrl+u >/dev/null 2>&1
        sleep 0.3
      fi
      if [[ -z "$(input_line)" ]]; then
        echo "goal-self-send: Enter was swallowed; text withdrawn from the input box on $PANE — the goal is NOT set, submit it by hand: $CMD" >&2
      else
        echo "goal-self-send: text is sitting unsubmitted in the input box on $PANE and could not be withdrawn — press Enter to set the goal, or clear the box before the next send" >&2
      fi
      exit 5
    fi
  fi
fi

# ---- transport 2: agent-msg (Remote-Control sessions only) ----------------------------------
# Only --as-user works here. A default agent-msg send arrives classified as a peer message:
# the body is wrapped in "Another Claude session sent a message" framing and enqueued with
# skipSlashCommands, so "/goal …" lands as inert text and the goal is silently never set.
if command -v agent-msg >/dev/null 2>&1; then
  if agent-msg resolve "$SID" >/dev/null 2>&1; then
    if ! agent-msg --help 2>&1 | grep -q -- '--as-user'; then
      echo "goal-self-send: this agent-msg has no --as-user, and a peer-routed '/goal' is never executed — print the '/goal …' line for the user to submit" >&2
      exit 7
    fi
    if agent-msg send --as-user "$SID" "$CMD" >/dev/null 2>&1; then
      echo "goal-self-send: delivered via agent-msg (--as-user)"
      exit 0
    fi
    echo "goal-self-send: agent-msg send failed (session may have dropped RC)" >&2
    exit 5
  fi
fi

echo "goal-self-send: no transport can reach this session (not a herdr pane, not Remote-Control) — set the goal manually" >&2
exit 3
