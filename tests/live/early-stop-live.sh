#!/usr/bin/env bash
#
# LIVE test for hooks/early-stop.ts: one real `claude -p` main-chat session, one real Jev call, one
# real block, and the model carrying on afterwards. The unit suite (tests/early-stop.test.ts) proves
# the hook's logic against a mock Decisions server; this proves the thing that suite cannot — that the
# harness actually delivers a Stop payload the hook can read, and actually resumes the turn when the
# hook answers `{"decision":"block"}`.
#
# It passes on exactly two facts:
#   1. the audit log has a `block` line for THIS session, and
#   2. the session transcript has assistant activity timestamped after that block.
#
# CONTAINMENT. Everything the run produces lands under one `mktemp -d` scratch: `CLAUDE_CONFIG_DIR`
# puts the transcript and all session state there, and `TMPDIR` puts the hook's own audit log and
# per-turn counter there. Nothing is written outside the system temp directory, and the user's real
# `~/.claude` is neither read for settings nor written to.
#
# A fresh config dir also means no installed plugin, no user settings and no CLAUDE.md are loaded, so
# the ONLY Stop hook in the session is the one under test and the model is not pre-warned by the
# user's own anti-early-stop rule. The hook command is read out of hooks/hooks.json rather than
# retyped here, so a broken registration fails this test instead of hiding behind a duplicate.
#
# Env: EARLY_STOP_LIVE_MODEL, EARLY_STOP_LIVE_BUDGET, EARLY_STOP_LIVE_TIMEOUT, EARLY_STOP_LIVE_KEEP=1
# (leave the scratch on disk for inspection).

set -uo pipefail

REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd) || exit 1
HOOKS_JSON="$REPO/hooks/hooks.json"
HOOK_SRC="$REPO/hooks/early-stop.ts"

MODEL=${EARLY_STOP_LIVE_MODEL:-claude-haiku-4-5-20251001}
BUDGET=${EARLY_STOP_LIVE_BUDGET:-2}
RUN_TIMEOUT=${EARLY_STOP_LIVE_TIMEOUT:-300}

say() { printf '%s\n' "$*"; }
fail() {
  say ""
  say "FAIL: $*"
  [ -n "${SCRATCH:-}" ] && [ "${EARLY_STOP_LIVE_KEEP:-0}" = 1 ] && say "scratch kept: $SCRATCH"
  exit 1
}

for bin in claude bun jq mktemp timeout; do
  command -v "$bin" >/dev/null 2>&1 || fail "missing dependency: $bin"
done
[ -f "$HOOK_SRC" ] || fail "no hook to test: $HOOK_SRC"
[ -f "$HOOKS_JSON" ] || fail "no hook manifest: $HOOKS_JSON"

# The command line the plugin really registers, with ${CLAUDE_PLUGIN_ROOT} resolved to this checkout.
HOOK_CMD=$(jq -r --arg root "$REPO" '
  .hooks.Stop[]?.hooks[]? | select((.command // "") | test("early-stop\\.ts"))
  | .command | gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root)' "$HOOKS_JSON" | head -1)
[ -n "$HOOK_CMD" ] || fail "early-stop.ts is not registered under Stop in $HOOKS_JSON"
HOOK_TIMEOUT=$(jq -r '
  [.hooks.Stop[]?.hooks[]? | select((.command // "") | test("early-stop\\.ts")) | .timeout // 20][0]' "$HOOKS_JSON")

SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/early-stop-live.XXXXXX") || fail "cannot create a scratch dir"
cleanup() { [ "${EARLY_STOP_LIVE_KEEP:-0}" = 1 ] || rm -rf "$SCRATCH"; }
trap cleanup EXIT

WORK="$SCRATCH/work"
CFG="$SCRATCH/cfg"
LOG="$SCRATCH/early-stop.log"
mkdir -p "$WORK" "$CFG" || fail "cannot populate $SCRATCH"

# Three tiny files so the listing in step 1 has something to report and the announced-but-not-taken
# step in step 2 is real work the model can actually do once the hook sends it back.
printf 'alpha\nbeta\n' >"$WORK/one.txt"
printf 'gamma\n' >"$WORK/two.txt"
printf 'delta\nepsilon\nzeta\n' >"$WORK/three.txt"

jq -n --arg cmd "$HOOK_CMD" --argjson to "${HOOK_TIMEOUT:-20}" \
  '{hooks: {Stop: [{matcher: "*", hooks: [{type: "command", command: $cmd, timeout: $to}]}]}}' \
  >"$SCRATCH/settings.json" || fail "cannot write the session settings"

SID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null)
[ -n "$SID" ] || fail "cannot mint a session uuid"

# The deliverable is the line counts, and the prompt never releases the model from owing them — it
# only asks for the listing first and for a summary shaped like early-stop pattern (1), an announced
# next step. Telling it instead to "stop and wait" would hand it a legitimate reason to end the turn,
# which is the one thing that must not be true here.
PROMPT='Your task: report the name and the line count of every file in the current directory.

Do it in two steps. Step 1: run `ls -1` to get the names. Step 2: pause there and write a short
summary that reports the names and announces that counting the lines is the next step you will take.
End the summary — and your turn — with that announcement rather than with the counts.'

say "session:  $SID"
say "scratch:  $SCRATCH"
say "hook:     $HOOK_CMD (timeout ${HOOK_TIMEOUT:-20}s)"
say "model:    $MODEL"
say ""

# FARM_OUT_CHILD / GRIND_ITERATION are unset explicitly, not assumed absent: this test is itself
# routinely run from inside a farm-out child, where inheriting either one would make the hook allow
# immediately and the test would prove nothing. The ANTHROPIC_DEFAULT_*_MODEL vars are dropped
# because a `[1m]` long-context alias makes the API answer 400 before a turn ever ends.
(
  cd "$WORK" || exit 1
  env -u FARM_OUT_CHILD -u GRIND_ITERATION \
      -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_BRIDGE_SESSION_ID \
      -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_OPUS_MODEL \
      TMPDIR="$SCRATCH" CLAUDE_CONFIG_DIR="$CFG" \
      timeout "$RUN_TIMEOUT" claude -p "$PROMPT" \
        --session-id "$SID" \
        --settings "$SCRATCH/settings.json" \
        --model "$MODEL" \
        --allowedTools "Bash(ls:*),Bash(wc:*),Read,Glob" \
        --permission-prompts none \
        --max-budget-usd "$BUDGET" \
        --output-format json \
        </dev/null >"$SCRATCH/result.json" 2>"$SCRATCH/stderr.txt"
)
RUN_RC=$?
say "claude exit: $RUN_RC"
RESULT=$(jq -r '.result // ""' "$SCRATCH/result.json" 2>/dev/null)
IS_ERROR=$(jq -r '.is_error // false' "$SCRATCH/result.json" 2>/dev/null)
NUM_TURNS=$(jq -r '.num_turns // 0' "$SCRATCH/result.json" 2>/dev/null)
say "is_error: $IS_ERROR   num_turns: $NUM_TURNS"
[ "$IS_ERROR" = true ] && say "api result: $RESULT"

# ---- fact 1: the audit log recorded a block for THIS session -------------------------------------
say ""
say "--- $LOG ---"
if [ -f "$LOG" ]; then cat "$LOG"; else say "(absent)"; fi
say "---"

[ -f "$LOG" ] || fail "the hook never wrote an audit line (was it invoked at all?)"
BLOCK_LINE=$(awk -F'\t' -v s="$SID" '$2 == s && $5 == "block" { print; exit }' "$LOG")
if [ -z "$BLOCK_LINE" ]; then
  SESSION_LINES=$(awk -F'\t' -v s="$SID" '$2 == s' "$LOG")
  say ""
  say "lines for this session:"
  say "${SESSION_LINES:-(none — the hook did not run for this session)}"
  fail "no block line for session $SID (the hook allowed the stop; the note above says why)"
fi
BLOCK_TS=$(printf '%s' "$BLOCK_LINE" | cut -f1)
BLOCK_P=$(printf '%s' "$BLOCK_LINE" | cut -f4)
say ""
say "blocked at $BLOCK_TS (judge p=${BLOCK_P}%)"

# ---- fact 2: the transcript kept going after that block ------------------------------------------
TRANSCRIPT=$(find "$CFG/projects" -type f -name "$SID.jsonl" 2>/dev/null | head -1)
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || fail "no transcript for $SID under $CFG/projects"

# Entry timestamps and the audit timestamp are both ISO-8601 UTC with milliseconds, so a string
# comparison is a chronological one.
POST_COUNT=$(jq -r --arg ts "$BLOCK_TS" \
  'select(.type == "assistant" and ((.timestamp // "") > $ts)) | .uuid // "?"' \
  "$TRANSCRIPT" 2>/dev/null | wc -l)

say ""
say "--- assistant activity after the block ($POST_COUNT entries) ---"
jq -r --arg ts "$BLOCK_TS" '
  select(.type == "assistant" and ((.timestamp // "") > $ts))
  | .message.content[]?
  | if .type == "tool_use" then "  [tool_use] \(.name) \(.input | tostring | .[0:120])"
    elif .type == "text" then "  [text] \(.text | .[0:400])"
    else empty end' "$TRANSCRIPT" 2>/dev/null
say "---"

[ "$POST_COUNT" -gt 0 ] || fail "the transcript has no assistant activity after the block — the session stopped anyway"

# Evidence that the block's reason was actually delivered to the model, not merely logged. Reported,
# not gated: the two facts above are what the acceptance turns on.
REASON=$(bun --print "(await import('$HOOK_SRC')).BLOCK_REASON" 2>/dev/null | head -1)
if [ -n "$REASON" ] && grep -qF "${REASON:0:80}" "$TRANSCRIPT" 2>/dev/null; then
  say ""
  say "block reason was delivered into the transcript."
fi

say ""
say "PASS: session $SID was blocked at ${BLOCK_P}% and produced $POST_COUNT assistant entries afterwards."
exit 0
