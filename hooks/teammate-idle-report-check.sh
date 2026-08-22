#!/usr/bin/env bash
# TeammateIdle hook: keep a teammate working if it is about to go idle without
# having sent a report this turn.
#
# ---------------------------------------------------------------------------
# WHY THIS RESOLVES ITS OWN TRANSCRIPT INSTEAD OF USING .transcript_path
#
# The TeammateIdle payload's .transcript_path is the TEAM LEAD's session
# transcript, NOT the idling teammate's. An earlier version of this hook trusted
# it and therefore asked "did the lead report to itself" -- false essentially
# always -- so it fired on every teammate idle. The payload also carries no
# .agent_id. It DOES carry .teammate_name, which is what makes this solvable.
#
# Resolution is by the authoritative `name` field in the sibling
# <transcript>.meta.json, NOT by parsing filenames. Verified over 1357 real
# subagent transcripts: the plausible-looking `agent-a<name>-<hash>.jsonl`
# pattern holds for only ~29% of them (unnamed agents are `agent-a<hash>.jsonl`,
# with no name in the filename at all), while 1349 have a meta.json and NO name
# collides within any single session directory.
# ---------------------------------------------------------------------------
#
# Signal: the teammate's own transcript records its tool_use blocks. A turn starts
# at the last inbound message -- a `type:"user"` entry whose .message.content is a
# STRING, with .isMeta falsey and no .toolUseResult (those two shapes are system
# injections and tool results, not inbound messages). If no SendMessage tool_use
# appears after that boundary, nothing was delivered.
#
# Exit 0 = allow idle. Exit 2 = block idle, stderr is fed back to the teammate.
#
# FAILS OPEN everywhere: missing field, unreadable/unresolvable transcript, zero
# or multiple name matches, or any internal error exits 0. Nudges are capped per
# (session, teammate, turn) so a teammate that refuses to send can never be
# wedged in an infinite loop. That cap is load-bearing, not decorative: it is the
# only thing that contained the earlier false-positive bug. Do not remove it.

set +e
set -u

MAX_NUDGES=2

exit_allow() { exit 0; }

command -v jq >/dev/null 2>&1 || exit_allow

payload=$(cat 2>/dev/null) || exit_allow
[ -n "$payload" ] || exit_allow

event=$(printf '%s' "$payload" | jq -r '.hook_event_name // ""' 2>/dev/null) || exit_allow
[ "$event" = "TeammateIdle" ] || exit_allow

lead_transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // ""' 2>/dev/null) || exit_allow
session=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null) || exit_allow
teammate=$(printf '%s' "$payload" | jq -r '.teammate_name // ""' 2>/dev/null) || exit_allow

# Without a name there is nothing to resolve. Never fall back to .transcript_path:
# that is the lead's, and using it is exactly the bug this design exists to avoid.
[ -n "$teammate" ] || exit_allow
[ -n "$lead_transcript" ] || exit_allow

base_dir=$(dirname "$lead_transcript" 2>/dev/null) || exit_allow
[ -n "$base_dir" ] && [ -d "$base_dir" ] || exit_allow

# The session directory sits beside the lead's transcript, named for the session.
subagents_dir=""
for candidate in "$base_dir/$session/subagents" \
                 "$base_dir/$(basename "$lead_transcript" .jsonl)/subagents"; do
  if [ -n "$candidate" ] && [ -d "$candidate" ]; then
    subagents_dir="$candidate"
    break
  fi
done
[ -n "$subagents_dir" ] || exit_allow

# Resolve by authoritative meta.json name. Exactly one match, or fail open.
transcript=""
match_count=0
for meta in "$subagents_dir"/*.meta.json; do
  [ -f "$meta" ] || continue
  name=$(jq -r '.name // empty' "$meta" 2>/dev/null) || continue
  [ "$name" = "$teammate" ] || continue
  match_count=$((match_count + 1))
  transcript="${meta%.meta.json}.jsonl"
done

[ "$match_count" -eq 1 ] || exit_allow
[ -n "$transcript" ] && [ -r "$transcript" ] || exit_allow

# The dismissal token counts as a USE when it appears unwrapped, and as a MENTION
# when a quoting delimiter sits flush against it. Passed via --arg because the
# class contains a single quote, which cannot appear inside the single-quoted jq
# program. Smart quotes are included: leads compose these messages in editors that
# autocorrect. Verified that Oniguruma handles the multi-byte lookbehind.
standdown_re="(?<![\`\"'‘’“”])\\[NO REPORT NEEDED\\](?![\`\"'‘’“”])"

# Walk the transcript: reset on each turn boundary, remember whether SendMessage
# was called after the most recent one. `fromjson? // empty` skips unparseable
# lines instead of aborting -- one corrupt line must not blind the whole check.
#
# DELIBERATELY NO `set -o pipefail` here. A reviewer flagged its absence as a
# fail-open defect, reasoning that a jq runtime error would truncate the stream
# and let awk summarise a partial view. Measured on jq 1.8.2: that is not what
# happens. jq REPORTS a runtime error on one input and CONTINUES with the next,
# so no entry is lost and the summary is correct -- the bad input simply
# contributes nothing, exactly as `fromjson?` treats an unparseable line.
#
# Worse, adding pipefail would introduce the very failure it was meant to
# prevent. jq exits 0 when the erroring input is mid-stream but 5 when it is the
# LAST one. Under pipefail that 5 propagates to `|| exit_allow`, so a transcript
# whose final entry has an odd shape would SILENTLY DISABLE enforcement for that
# teammate. Silent non-enforcement is the failure family this hook exists to
# close. Without pipefail the same transcript is read correctly and enforced.
# See the two "jq runtime error" cases in the sibling .test.sh.
result=$(
  jq -R -r --arg re "$standdown_re" '
    (fromjson? // empty) as $e
    | if ($e.type == "user")
        and (($e.message.content | type) == "string")
        and (($e.isMeta // false) | not)
        and ($e.toolUseResult == null)
      then "B\t" + ($e.uuid // "unknown") + "\t"
           + (if ($e.message.content | test($re)) then "1" else "0" end)
      elif ($e.type == "assistant")
        and ((($e.message.content // []) | type) == "array")
        and ((($e.message.content // [])
               | map(select(.type == "tool_use" and .name == "SendMessage"))
               | length) > 0)
      then "S\t"
      else empty
      end
  ' "$transcript" 2>/dev/null |
  awk -F'\t' '
    $1 == "B" { boundary = $2; standdown = $3; sent = 0; next }
    $1 == "S" { sent = 1 }
    END { if (boundary == "") exit 1; print boundary "\t" sent "\t" standdown }
  '
) || exit_allow

[ -n "$result" ] || exit_allow

IFS=$'\t' read -r boundary sent standdown <<< "$result"

[ "$sent" = "1" ] && exit_allow

# Explicit dismissal by the lead. A LITERAL token test on the last inbound
# message only -- the token must appear somewhere in the message and must NOT be
# wrapped in backticks or double quotes. No regex over natural language, no
# stand-down phrasing detection, no "turn had no tool calls" inference.
#
# THE HISTORY HERE MATTERS; DO NOT COLLAPSE IT BACK TO EITHER EXTREME.
#
# v1 was a bare `index` substring test. It exempted any message that merely
# DISCUSSED the token -- documentation prose with it backticked inline -- and
# that actually happened: the message authorizing this feature quoted the token
# and exempted its own recipient.
#
# v2 overcorrected to WHOLE-LINE equality: split on newlines, trim, require a
# line to EQUAL the token. That killed the false exemption but broke the
# documented contract in .claude/rules/agent-teams.md ("include the literal
# string ... in the dismissal message"), which every reader takes as a
# substring. Measured over this user's live subagent transcripts, the token
# appears in 19 inbound lead messages: 7 alone on a line (v2 worked), 9 inline
# at the end of a dismissal sentence -- "Nothing further needed. [NO REPORT
# NEEDED]" -- which v2 SILENTLY IGNORED, nudging a correctly-dismissed teammate
# into filing an empty report, and 3 mentions. Inline is what a lead actually
# writes, so v2 failed on the common case and failed silently.
#
# v3 (this) distinguishes USE from MENTION by delimiter instead of by position:
# substring anywhere, but not when adjacent to a backtick or a double quote. All
# 9 wild inline uses match; all 3 wild mentions are backticked and do not. The
# regression v2 existed to prevent is still prevented -- see the
# "backticked mention" and "quoted mention" cases in the sibling .test.sh, which
# fail under a naive substring test and pass under this one.
#
# KNOWN LIMITS OF v3, accepted deliberately rather than overlooked:
#
#   - A token alone on a line inside a ``` fence, or after a "> " blockquote
#     marker, still exempts. Distinguishing those needs a Markdown parser, which
#     does not belong in a hook. Note v2 exempted the fenced case too, so this is
#     not a regression, and the failure mode is mild: a teammate goes idle
#     without reporting. The reverse error -- nudging a correctly-dismissed
#     teammate -- is the one that pressures an agent into inventing a report, and
#     it is the one this hook is being fixed to stop.
#   - Any INBOUND message can dismiss, not just the lead's. Peer messages reach a
#     teammate through the same channel and are indistinguishable here without
#     parsing the <teammate-message teammate_id="..."> envelope. Tightening this
#     would couple the hook to an undocumented wire format; left as is.
#   - This is not a security boundary. A teammate with shell access can edit its
#     own transcript or the cache. The hook is a guardrail against forgetting to
#     report, not an adversary-resistant control.
#
# A rejected alternative, for the record: requiring the token to be the LAST
# non-whitespace content of the message. It sounds stricter and immune to the
# quoting problem, but it scores 0/16 against the real corpus -- inbound messages
# arrive wrapped in a <teammate-message ...> envelope, so a closing tag always
# follows the token and nothing is ever terminal. It would reject every genuine
# dismissal ever sent.
#
# The token appearing in an earlier turn does not carry forward: each boundary
# resets the flag, so a token that once appeared in a transcript cannot silently
# disable enforcement for the rest of the session. A token inside a tool result
# is never seen at all, because tool results are not boundaries.
[ "$standdown" = "1" ] && exit_allow

# No report this turn. Nudge, but only up to MAX_NUDGES for this exact turn.
state_dir="${XDG_CACHE_HOME:-$HOME/.cache}/claude-teammate-idle"
mkdir -p "$state_dir" 2>/dev/null || exit_allow
key=$(printf '%s|%s' "${session:-nosession}" "$teammate" | tr -c 'A-Za-z0-9._-' '_')
state_file="$state_dir/$key"

prev_boundary=""
prev_count=0
if [ -r "$state_file" ]; then
  read -r prev_boundary prev_count < "$state_file" 2>/dev/null
  case "${prev_count:-}" in (''|*[!0-9]*) prev_count=0 ;; esac
fi

if [ "$prev_boundary" = "$boundary" ]; then
  count=$((prev_count + 1))
else
  count=1
fi

# If the counter cannot be persisted the cap cannot hold, and an uncapped nudge
# is an infinite loop: every idle recomputes count=1 and blocks again. Measured --
# with the state dir present but unwritable, six consecutive idles returned
# 2,2,2,2,2,2 instead of 2,2,0,0,0,0. Fail open rather than wedge the teammate.
printf '%s %s\n' "$boundary" "$count" > "$state_file" 2>/dev/null || exit_allow

if [ "$count" -gt "$MAX_NUDGES" ]; then
  # Give up rather than loop forever.
  exit_allow
fi

cat >&2 <<'EOF'
You are about to go idle without having called SendMessage this turn.

Your plain text output is not visible to anyone -- SendMessage to the lead is the
ONLY way to deliver a result. An idle notification carries no findings.

Send your report now. It must state what you did AND what you did not do, name any
skipped steps explicitly, and include verbatim command output for any verification
claim. Partial progress reported honestly is a good answer; silence is not.

If you were blocked or have nothing but a blocker, send that -- it is still a report.
EOF
exit 2
