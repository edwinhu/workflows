#!/usr/bin/env bash
# Self-contained regression tests for teammate-idle-report-check.sh.
#
# Run directly (scripts/check-tests.sh globs only *.test.{ts,mjs,js} and *.py, so
# this suite is not auto-discovered):
#
#     tests/teammate-idle-report-check.test.sh
#
# Each case builds a throwaway session tree in mktemp -d matching the real layout
# the hook resolves against (lead transcript + <session>/subagents/<agent>.jsonl
# with a sibling .meta.json carrying the authoritative `name`), feeds the hook a
# TeammateIdle payload on stdin, and asserts the exit code.
#
# Exit 0 = hook allows idle (exempt / reported / fail-open). Exit 2 = hook nudges.
#
# XDG_CACHE_HOME is redirected per case so the MAX_NUDGES state file can never
# leak between cases or touch the real cache.

set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../hooks" && pwd)/teammate-idle-report-check.sh"
pass=0
fail=0

# --- fixture builders -------------------------------------------------------
# jq -n builds every JSONL line so quoting/escaping is never hand-rolled.

inbound() { # inbound <uuid> <text>   -- an inbound message: turn boundary
  jq -cn --arg u "$1" --arg c "$2" \
    '{type:"user", uuid:$u, isMeta:null, toolUseResult:null, message:{role:"user", content:$c}}'
}

inbound_array() { # inbound_array <uuid> <text>  -- structured/array content
  jq -cn --arg u "$1" --arg c "$2" \
    '{type:"user", uuid:$u, isMeta:null, toolUseResult:null,
      message:{role:"user", content:[{type:"text", text:$c}]}}'
}

tool_result() { # tool_result <uuid> <text>  -- NOT a boundary
  jq -cn --arg u "$1" --arg c "$2" \
    '{type:"user", uuid:$u, isMeta:null, toolUseResult:{stdout:$c},
      message:{role:"user", content:[{type:"tool_result", content:$c}]}}'
}

tool_result_str() { # tool_result_str <uuid> <text>  -- string-content tool result.
  # NOT observed in the wild (26146/26146 real tool results carry array content),
  # so this exists to keep the $e.toolUseResult == null guard load-bearing. Without
  # that guard this shape would be treated as an inbound message.
  jq -cn --arg u "$1" --arg c "$2" \
    '{type:"user", uuid:$u, isMeta:null, toolUseResult:{stdout:$c},
      message:{role:"user", content:$c}}'
}

meta_msg() { # meta_msg <uuid> <text>  -- system injection, NOT a boundary
  jq -cn --arg u "$1" --arg c "$2" \
    '{type:"user", uuid:$u, isMeta:true, toolUseResult:null, message:{role:"user", content:$c}}'
}

assistant_text() { # assistant_text <text>
  jq -cn --arg c "$1" \
    '{type:"assistant", message:{role:"assistant", content:[{type:"text", text:$c}]}}'
}

assistant_send() { # assistant_send  -- a SendMessage tool_use: the report
  jq -cn '{type:"assistant", message:{role:"assistant", content:[
     {type:"tool_use", name:"SendMessage", id:"toolu_test", input:{message:"my report"}}]}}'
}

assistant_malformed() { # an assistant entry whose content array holds scalars.
  # jq's `map(select(.type == ...))` cannot index a number, so this raises a jq
  # RUNTIME error (distinct from an unparseable line, which `fromjson?` absorbs).
  jq -cn '{type:"assistant", message:{role:"assistant", content:[1,2,3]}}'
}

corrupt_line() { printf 'this is not json at all\n'; }

# run_case <name> <expected_exit> <<< transcript-lines-on-stdin
run_case() {
  local name="$1" want="$2"
  local root lead sess agent
  root=$(mktemp -d) || { echo "mktemp failed"; exit 1; }
  sess="11111111-2222-3333-4444-555555555555"
  lead="$root/$sess.jsonl"
  : > "$lead"
  mkdir -p "$root/$sess/subagents"
  agent="$root/$sess/subagents/agent-atestmate-deadbeef"
  cat > "$agent.jsonl"
  printf '{"name":"testmate","agentType":"testmate"}\n' > "$agent.meta.json"

  local payload out rc
  payload=$(jq -cn --arg t "$lead" --arg s "$sess" \
    '{hook_event_name:"TeammateIdle", transcript_path:$t, session_id:$s, teammate_name:"testmate"}')

  out=$(printf '%s' "$payload" | XDG_CACHE_HOME="$root/cache" "$HOOK" 2>&1)
  rc=$?

  if [ "$rc" = "$want" ]; then
    printf 'PASS  %-58s exit=%s\n' "$name" "$rc"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-58s exit=%s want=%s\n' "$name" "$rc" "$want"
    [ -n "$out" ] && printf '        hook said: %s\n' "$(printf '%s' "$out" | head -1)"
    fail=$((fail + 1))
  fi
  rm -rf "$root"
}

echo "== teammate-idle-report-check.sh =="
echo

# 1. THE BUG. Marker inline at the end of a dismissal sentence -- the way a lead
#    actually writes it. Must exempt.
run_case "marker inline in dismissal -> exempt" 0 <<EOF
$(inbound b1 "Kick off: audit the parser.")
$(assistant_send)
$(inbound b2 "Nothing further on #8. [NO REPORT NEEDED]")
$(assistant_text "Understood.")
EOF

# 2. Marker alone on its own line. Must exempt (worked before the fix too).
run_case "marker alone on its own line -> exempt" 0 <<EOF
$(inbound b1 "Kick off: audit the parser.")
$(assistant_send)
$(inbound b2 "Nothing further on #8.

[NO REPORT NEEDED]")
$(assistant_text "Understood.")
EOF

# 3. Marker mid-sentence, not at a line end.
run_case "marker mid-sentence -> exempt" 0 <<EOF
$(inbound b1 "Stand by. [NO REPORT NEEDED] -- I will ping you if #8 reopens.")
$(assistant_text "Standing by.")
EOF

# 4. Marker absent, nothing sent. Must nudge.
run_case "no marker, no SendMessage -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser and report back.")
$(assistant_text "Done, here is what I found.")
EOF

# 5. Report was sent this turn. Must allow regardless of marker.
run_case "SendMessage sent this turn -> allow" 0 <<EOF
$(inbound b1 "Audit the parser and report back.")
$(assistant_send)
EOF

# --- "marker in a NON-dismissal message" -- four distinct ways that happens ---

# 6. Marker in an EARLIER turn does not carry forward to this one.
run_case "marker in a previous turn only -> nudge" 2 <<EOF
$(inbound b1 "Stand down. [NO REPORT NEEDED]")
$(assistant_text "ok")
$(inbound b2 "New task: audit the lexer too.")
$(assistant_text "Looked at it.")
EOF

# 7. Backticked MENTION of the token in prose about the protocol. This is the
#    regression the whole-line rule was originally added to stop -- and it is
#    real: three such mentions appear in this user's live transcripts, e.g.
#    "The lead may include the exact string `[NO REPORT NEEDED]` in a dismissal
#    message." A naive substring test exempts that message. Must nudge.
run_case "backticked mention in prose -> nudge (not exempt)" 2 <<EOF
$(inbound b1 "Reminder on protocol: the lead may include the exact string \`[NO REPORT NEEDED]\` in a dismissal message. Now go audit the parser.")
$(assistant_text "Looked at it.")
EOF

# 8. Double-quoted mention. Same family.
run_case "quoted mention in prose -> nudge (not exempt)" 2 <<EOF
$(inbound b1 "Grep the hooks for \"[NO REPORT NEEDED]\" and tell me what you find.")
$(assistant_text "Looked at it.")
EOF

# 8b. Single-quoted mention.
run_case "single-quoted mention -> nudge (not exempt)" 2 <<EOF
$(inbound b1 "The token '[NO REPORT NEEDED]' is documented in the rules file. Go audit the parser.")
$(assistant_text "Looked at it.")
EOF

# 8c/8d. Smart-quoted mentions. Leads compose these in editors that autocorrect
#        straight quotes, so this is the likeliest mention spelling of all.
run_case "smart-double-quoted mention -> nudge (not exempt)" 2 <<EOF
$(inbound b1 "Look for “[NO REPORT NEEDED]” in the hook and tell me what you find.")
$(assistant_text "Looked at it.")
EOF

run_case "smart-single-quoted mention -> nudge (not exempt)" 2 <<EOF
$(inbound b1 "Look for ‘[NO REPORT NEEDED]’ in the hook and tell me what you find.")
$(assistant_text "Looked at it.")
EOF

# 8e. Mention AND use in one message. The use wins.
run_case "mention plus a real use -> exempt" 0 <<EOF
$(inbound b1 "For reference the token is \`[NO REPORT NEEDED]\`, and I am using it now: [NO REPORT NEEDED]")
$(assistant_text "Understood.")
EOF

# 9. Marker inside a TOOL RESULT (the teammate grepping its own transcript).
#    Tool results are not boundaries, so this is never even inspected.
run_case "marker inside a tool result -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser.")
$(tool_result t1 "match: [NO REPORT NEEDED]")
$(assistant_text "Looked at it.")
EOF

# 9b. Same, but with STRING tool-result content. Only the toolUseResult guard
#     stops this one; the string-type guard does not.
run_case "marker in a string-content tool result -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser.")
$(tool_result_str t1 "match: [NO REPORT NEEDED]")
$(assistant_text "Looked at it.")
EOF

# 10. Marker in a system injection (isMeta). Not a boundary either.
run_case "marker in an isMeta injection -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser.")
$(meta_msg m1 "[NO REPORT NEEDED]")
$(assistant_text "Looked at it.")
EOF

# 11. Marker in the teammate's OWN assistant output. Self-exemption must fail.
run_case "marker in teammate's own output -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser.")
$(assistant_text "I will stand down now. [NO REPORT NEEDED]")
EOF

# --- structured / array inbound content -------------------------------------
# Measured over 1071 real subagent transcripts: every genuine inbound peer or
# lead message arrives with STRING content (853/853); the only array-content
# entries matching <teammate-message ...> are the 15 tool_results of agents
# grepping their own transcripts. So array content is not a delivery shape for
# dismissals today. It is still not a boundary, so a hypothetical array-content
# dismissal is invisible: the PRIOR boundary stands and its flags apply.
run_case "array-content dismissal is not a boundary -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser.")
$(inbound_array b2 "Nothing further. [NO REPORT NEEDED]")
$(assistant_text "Looked at it.")
EOF

# --- KNOWN LIMITS ------------------------------------------------------------
# These assert what the hook ACTUALLY does, not what would be ideal. They exist
# so the limitation is visible and a future change to it is a deliberate, failing
# -test-driven decision rather than an accident. Detecting either case properly
# needs a Markdown parser, which does not belong in a hook. Both fail toward
# "teammate goes idle without reporting", the mild direction.

# A token alone on a line inside a fenced code block reads as a use. v2 exempted
# this too, so it is not a regression.
run_case "KNOWN LIMIT: token in a fenced code block -> exempts" 0 <<EOF
$(inbound b1 "Here is the hook contract:

\`\`\`
[NO REPORT NEEDED]
\`\`\`

Now go audit the parser.")
$(assistant_text "Looked at it.")
EOF

# A quoted/forwarded dismissal behind a blockquote marker also reads as a use.
run_case "KNOWN LIMIT: token behind a > blockquote -> exempts" 0 <<EOF
$(inbound b1 "The lead said to you earlier:

> Nothing further. [NO REPORT NEEDED]

I disagree -- please keep going and audit the parser.")
$(assistant_text "Looked at it.")
EOF

# --- fail-open ---------------------------------------------------------------
# A hook that cannot resolve a transcript must never block a teammate.

echo
root=$(mktemp -d)
for name in "empty payload" "wrong event" "no teammate_name" "unresolvable transcript path"; do
  case "$name" in
    "empty payload")  p="" ;;
    "wrong event")    p='{"hook_event_name":"Stop"}' ;;
    "no teammate_name") p='{"hook_event_name":"TeammateIdle","transcript_path":"/nope/x.jsonl","session_id":"s"}' ;;
    "unresolvable transcript path") p='{"hook_event_name":"TeammateIdle","transcript_path":"/nope/x.jsonl","session_id":"s","teammate_name":"testmate"}' ;;
  esac
  printf '%s' "$p" | XDG_CACHE_HOME="$root/cache" "$HOOK" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = 0 ]; then
    printf 'PASS  %-58s exit=0\n' "fail-open: $name"; pass=$((pass + 1))
  else
    printf 'FAIL  %-58s exit=%s want=0\n' "fail-open: $name" "$rc"; fail=$((fail + 1))
  fi
done
rm -rf "$root"

# Transcript with no inbound boundary at all (awk exits 1) must also fail open.
run_case "fail-open: transcript with no boundary" 0 <<EOF
$(assistant_text "orphaned output")
EOF

# A jq RUNTIME error mid-stream must not lose the entries after it. jq reports
# the error and continues, so the SendMessage that FOLLOWS the bad entry is still
# seen and the teammate is correctly allowed to idle.
run_case "jq runtime error mid-stream: later entries still read" 0 <<EOF
$(inbound b1 "Audit the parser and report back.")
$(assistant_malformed)
$(assistant_send)
EOF

# Same error, but on the LAST line, where jq's exit status becomes 5 instead of
# 0. Enforcement must still apply: nothing was reported, so this must nudge.
# THIS IS THE CASE THAT FORBIDS `set -o pipefail` on the jq|awk pipeline -- with
# it, the 5 propagates to `|| exit_allow` and the hook silently stops enforcing.
run_case "jq error on last line must NOT disable enforcement" 2 <<EOF
$(inbound b1 "Audit the parser and report back.")
$(assistant_text "Looked at it.")
$(assistant_malformed)
EOF

# An unparseable LINE is different: `fromjson?` absorbs it by design, so the rest
# of the transcript is still read and enforcement still applies.
run_case "one corrupt line does not blind the check -> nudge" 2 <<EOF
$(inbound b1 "Audit the parser and report back.")
$(corrupt_line)
$(assistant_text "Looked at it.")
EOF

# --- nudge cap ---------------------------------------------------------------
# MAX_NUDGES=2 for one (session, teammate, boundary). The third idle allows.
echo
root=$(mktemp -d)
sess="99999999-8888-7777-6666-555555555555"
lead="$root/$sess.jsonl"; : > "$lead"
mkdir -p "$root/$sess/subagents"
agent="$root/$sess/subagents/agent-atestmate-cafe"
{ inbound b1 "Audit the parser."; assistant_text "Looked at it."; } > "$agent.jsonl"
printf '{"name":"testmate"}\n' > "$agent.meta.json"
payload=$(jq -cn --arg t "$lead" --arg s "$sess" \
  '{hook_event_name:"TeammateIdle", transcript_path:$t, session_id:$s, teammate_name:"testmate"}')
codes=""
for i in 1 2 3; do
  printf '%s' "$payload" | XDG_CACHE_HOME="$root/cache" "$HOOK" >/dev/null 2>&1
  codes="$codes$?"
done
if [ "$codes" = "220" ]; then
  printf 'PASS  %-58s codes=%s\n' "nudge cap: 2 nudges then give up" "$codes"; pass=$((pass + 1))
else
  printf 'FAIL  %-58s codes=%s want=220\n' "nudge cap: 2 nudges then give up" "$codes"; fail=$((fail + 1))
fi
rm -rf "$root"

# --- unwritable state file ---------------------------------------------------
# If the counter cannot be persisted the cap cannot hold, so an uncapped nudge
# becomes an INFINITE loop: every idle recomputes count=1 and blocks again. The
# dir is made to exist but be unwritable, so `mkdir -p` succeeds and only the
# write fails. Must fail open rather than wedge the teammate.
echo
root=$(mktemp -d)
sess="77777777-6666-5555-4444-333333333333"
lead="$root/$sess.jsonl"; : > "$lead"
mkdir -p "$root/$sess/subagents"
agent="$root/$sess/subagents/agent-atestmate-beef"
{ inbound b1 "Audit the parser."; assistant_text "Looked at it."; } > "$agent.jsonl"
printf '{"name":"testmate"}\n' > "$agent.meta.json"
payload=$(jq -cn --arg t "$lead" --arg s "$sess" \
  '{hook_event_name:"TeammateIdle", transcript_path:$t, session_id:$s, teammate_name:"testmate"}')
mkdir -p "$root/cache/claude-teammate-idle"
chmod 500 "$root/cache/claude-teammate-idle"
codes=""
for i in 1 2 3 4 5 6; do
  printf '%s' "$payload" | XDG_CACHE_HOME="$root/cache" "$HOOK" >/dev/null 2>&1
  codes="$codes$?"
done
chmod 700 "$root/cache/claude-teammate-idle"
case "$codes" in
  *2222*) printf 'FAIL  %-58s codes=%s (uncapped: infinite nudge loop)\n' \
            "unwritable state file must not wedge the teammate" "$codes"; fail=$((fail + 1)) ;;
  *)      printf 'PASS  %-58s codes=%s\n' \
            "unwritable state file must not wedge the teammate" "$codes"; pass=$((pass + 1)) ;;
esac
rm -rf "$root"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
