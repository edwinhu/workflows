#!/usr/bin/env bash
# Self-send a "/goal ..." user-message into THIS Claude Code session.
#
# Delivery arrives as a user keypress in our own conversation, so the goal survives compaction.
# Transport is whichever one can reach us: `herdr agent prompt` into our own pane, whose
# `agent_prompted` event IS the submission receipt, else `agent-msg` if the session is
# Remote-Control. Submission is NOT verified by reading the input line back — that was tried and
# it cannot work, see the note at the herdr branch.
# Neither is guaranteed; a non-zero exit is informational, not fatal — craft's caller falls back to
# the plan hash as the standing gate text.
#
# Usage: goal-self-send.sh "/goal <text>" [--no-lint]   |   goal-self-send.sh "/goal clear"
#        goal-self-send.sh "/loop 30m <tick prompt>"   — the heartbeat; never linted
#
# THE GOAL IS LINTED BEFORE IT IS SENT. This is the one chokepoint every goal passes through, so it
# is where `skills/goal-and-loop` is enforced rather than merely available: a CRITICAL finding —
# a milestone verb, a clause only a human can close, turn counting, "done or blocked" — refuses the
# send with exit 8 and names the skill to read. Majors and minors warn and go through. Measured
# 2026-08-27/28: three sessions idled 14h43m overnight on goals with exactly these defects.
# `compose-goal.sh` output passes clean, so craft dispatches are untouched. `--no-lint` overrides.
#
# Exit codes (all verified by execution against a stubbed herdr/agent-msg):
#   0  submitted (input box cleared after Enter), or agent-msg accepted it as user input
#   2  argument is not "/goal <non-empty text>" or "/goal clear"        — nothing sent
#   3  no transport can reach this session                              — nothing sent
#   4  cannot identify/trust the target: no session id, >1 pane claims it, the claiming record is
#      not a claude id-session, or HERDR_PANE_ID disagrees with herdr  — nothing sent
#   5  a send was attempted and did not confirm: `agent prompt` returned no `agent_prompted`
#      event, the agent was `agent_blocked` (rejected BEFORE any input is sent), or agent-msg
#      send failed
#   6  (retired 2026-09-01 — was the input-box collision guard, which deadlocked on residue
#      it could not interpret and refused a valid `/goal clear`)
#   7  the only reachable transport cannot produce a slash command: agent-msg without
#      --as-user routes a PEER message, which the recipient enqueues with slash commands
#      disabled, so the goal would never be set                         — nothing sent
#   8  the goal carries a CRITICAL goal-lint finding                    — nothing sent
set -uo pipefail

CMD="${1-}"
NOLINT=0
for a in "$@"; do [ "$a" = "--no-lint" ] && NOLINT=1; done
case "$CMD" in
  "/goal clear") ;;
  "/goal "*) [[ -n "${CMD:6}" && "${CMD:6}" =~ [^[:space:]] ]] || { echo "goal-self-send: empty /goal body" >&2; exit 2; } ;;
  # A goal decides whether to continue; a loop guarantees something asks. This is the only transport
  # that can type into our own pane, so it is also the only way to raise the heartbeat. A /loop is
  # NOT a goal and is deliberately not linted: goal-lint would flag a tick prompt for having no
  # ceiling and no counter, which are properties of a stopping condition, not of a heartbeat.
  "/loop "*) [[ -n "${CMD:6}" && "${CMD:6}" =~ [^[:space:]] ]] || { echo "goal-self-send: empty /loop body" >&2; exit 2; } ;;
  *) echo "goal-self-send: argument must be '/goal <text>', '/goal clear' or '/loop <interval> <text>'" >&2; exit 2 ;;
esac

# ---- the goal-and-loop gate ------------------------------------------------------------------
# Nothing here reaches the network or the session; it reads the string. A missing bun or a missing
# lint is not a reason to block a send, so absence passes.
GW_LINT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../goal-and-loop/scripts" 2>/dev/null && pwd)/goal-lint.ts"
if [ "$NOLINT" = 0 ] && [ "$CMD" != "/goal clear" ] && [ "${CMD#/goal }" != "$CMD" ] && [ -f "$GW_LINT" ] && command -v bun >/dev/null 2>&1; then
  GW_OUT=$(bun "$GW_LINT" "${CMD:6}" 2>/dev/null); GW_CODE=$?
  if [ "$GW_CODE" = 1 ]; then
    if printf '%s' "$GW_OUT" | grep -q '^\[CRITICAL\]'; then
      printf '%s\n' "$GW_OUT" >&2
      cat >&2 <<EOF

goal-self-send: REFUSED — this goal carries a critical defect and nothing was sent.

A goal is the only thing between an unattended session and an idle terminal. Read
  $(cd "$(dirname "${BASH_SOURCE[0]}")/../../goal-and-loop" && pwd)/SKILL.md
rewrite the goal, and send it again. Override with --no-lint if you have a reason.
EOF
      exit 8
    fi
    printf '%s\n' "$GW_OUT" >&2
    echo "goal-self-send: sending anyway (no critical findings) — see skills/goal-and-loop/SKILL.md" >&2
  fi
fi

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
      # ENQUEUE; the SEND happens after this turn ends. `agent prompt` delivers text+Enter even
      # to a working agent, but Claude Code enqueues a prompt arriving mid-turn and does not parse
      # slash commands out of it — measured 2026-09-02, 4 of 4 inline sends recorded
      # promptSource="queued" with no `Goal set:` receipt, while the same line delivered to an idle
      # pane expanded normally. A self-send is always made from a working turn, so the send is
      # deferred to a detached drainer that waits for idle first. See goal-send-drain.sh.
      #
      # NO `--wait` anywhere: it waits for a turn to settle AFTER submitting, which is the wrong
      # end of the problem, and a self-send's own turn can satisfy it.
      Q="${TMPDIR:-/tmp}/herdr-goal-send-$SID.q"
      printf '%s\n' "$CMD" >> "$Q" || { echo "goal-self-send: cannot write queue $Q" >&2; exit 5; }
      DRAIN="$(dirname "${BASH_SOURCE[0]}")/goal-send-drain.sh"
      if [ ! -x "$DRAIN" ]; then
        echo "goal-self-send: drainer missing at $DRAIN" >&2; exit 5
      fi
      setsid nohup "$DRAIN" "$PANE" "$Q" >/dev/null 2>&1 &
      echo "goal-self-send: queued ${CMD%% *} for pane $PANE — sends when this turn ends"
      echo "goal-self-send: verify next turn with goal-verify.sh (a queued send is not a set goal)"
      exit 0
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
