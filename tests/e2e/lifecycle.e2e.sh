#!/usr/bin/env bash
# E2E: walk /writing through CLARIFY -> PLAN -> IMPLEMENT -> REVIEW and assert each transition.
#
# WHY THIS IS THE TEST THAT MATTERS
#   Every other suite asserts about FILES: that a router presents the beats, that a skill reaches
#   one, that a hook denies a synthetic payload. On 2026-08-06 all of them were green while a
#   `/writing` run did not follow the beats at all and enforcement was absent for an entire
#   implementation phase. Nothing that reads files can see that. This drives the real binary through
#   a real episode and checks that each beat actually happened.
#
# WHAT COUNTS AS EVIDENCE
#   Never the agent's narration. Each assertion reads state a HOOK wrote:
#     CLARIFY   -> .planning/.state/episode.json  phases.clarified   (episode-phase, on an OBSERVED
#                                                                     AskUserQuestion)
#     PLAN      -> .planning/.state/review.json   plan_hash          (approved-artifact-persist, on
#                                                                     an OBSERVED ExitPlanMode)
#     IMPLEMENT -> a delegated agent wrote the deliverable, and main chat did not
#     REVIEW    -> the run reaches a human-review surface
#   A model that claims it clarified without calling AskUserQuestion leaves no `phases.clarified`,
#   which is the entire point of keying on hook-written state.
#
# WHY IT MUST BE INTERACTIVE
#   CLARIFY blocks on AskUserQuestion and PLAN blocks on ExitPlanMode approval. A headless `-p` run
#   cannot answer either, so it cannot leave beat 1. Something has to press the keys, which is what
#   Herdr is for here.
#
# BINARY: `claude-code`, launched with `pane run` rather than `herdr agent start`, because
# `--kind claude` maps to the canonical `claude` executable with no override and plain `claude`
# exhausted a weekly subscription limit. Herdr still detects the wrapper as a `claude` agent.
#
# Run: WORKFLOWS_E2E=1 bash tests/e2e/lifecycle.e2e.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
REPO="$PWD"
. tests/e2e/lib.sh
require_optin
require_herdr

STEP_TIMEOUT="${E2E_STEP_TIMEOUT:-300000}"
WORK=$(mktemp -d /tmp/wf-life-XXXXXX)
AGENT=""; PANE=""

finish() {
  if [ "${E2E_KEEP:-}" = 1 ]; then
    [ -n "$PANE" ] && printf '  pane kept: %s\n' "$PANE"
  else
    [ -n "$PANE" ] && herdr pane close "$PANE" >/dev/null 2>&1
  fi
  unpin_plugin_build
  # E2E_KEEP=1 preserves the fixture. The first run of this file printed "transcript kept for
  # inspection" and then deleted it in this trap, so the PLAN failure it correctly found could not
  # be diagnosed at all. A message that contradicts the code is worse than no message.
  if [ "${E2E_KEEP:-}" = 1 ]; then
    printf '  fixture kept: %s\n' "$WORK"
  else
    rm -rf "$WORK"
  fi
}
trap finish EXIT

# --------------------------------------------------------------------------------------------
# Drive helpers. `agent_state` is read from Herdr rather than inferred from screen text, because
# screen text is a rendering of the TUI and the lifecycle state is what Herdr actually tracks.
# --------------------------------------------------------------------------------------------
agent_state() {
  herdr agent get "$AGENT" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["agent"]["agent_status"])' 2>/dev/null
}
screen() { herdr agent read "$AGENT" --source recent-unwrapped --lines 160 2>/dev/null; }

# Snapshot the screen and the planning state at each beat boundary. Without this the run reports
# WHICH beat failed and nothing about why, which is exactly where the first run left off.
dump() {
  # Two statements: bash expands ALL arguments to `local` before assigning any of them,
  # so `out="...$tag"` on the same line reads an unbound `tag` under `set -u`.
  local tag="$1"
  local out="$WORK/dump-$tag"
  screen > "$out.screen.txt" 2>/dev/null
  { echo "--- .planning tree"; find "$P/.planning" -type f 2>/dev/null | sed "s|$P/||"
    for f in "$P/.planning/.state/episode.json" "$P/.planning/.state/review.json"; do
      echo "--- $(basename "$f")"; cat "$f" 2>/dev/null || echo "(absent)"; echo
    done
    echo "--- outputs"; find "$P/outlines" "$P/drafts" -type f 2>/dev/null | sed "s|$P/||"
  } > "$out.state.txt" 2>&1
}

# Answer whatever interactive surface is up. `blocked` means Herdr recognised an approval or
# question UI; `enter` accepts the highlighted choice, which is the documented default for both
# AskUserQuestion and the ExitPlanMode approval.
# Complete whatever interactive surface is up.
#
# A BARE `enter` IS NOT AN ANSWER, and this is what made the first four runs meaningless.
# `AskUserQuestion` renders a TABBED MULTI-SELECT:
#
#     <-  [x] Recommendation   [x] Exclusions   * Submit  ->
#     > 1. [x] Detailed cost modeling
#       2. [ ] Named-supplier selection
#
# `enter` TOGGLES the highlighted checkbox; it never submits. So the tool call never returned, the
# PostToolUse hook never fired, `phases.clarified` was never written, and the harness reported
# "the workflow did not actually clarify" about a workflow that was clarifying correctly and
# waiting for a submit that never came. Six rounds of "blocked" was the driver failing, not the
# workflow.
#
# `right` walks to the Submit tab, which shows "Ready to submit your answers? > 1. Submit answers".
# A plain single-select has no such tab, so the probe simply finds nothing and the first `enter`
# was already the answer.
# ---------------------------------------------------------------------------------------------
# WHICH DIALOG IS ON SCREEN. Two kinds reach this harness and they take DIFFERENT KEYS, so a
# single blind `enter` is not an answer — it is a guess that happened to be right for one of them.
#
# Herdr's own detection manifest already distinguishes them (`legacy_no_prompt_blocker`, priority
# 300, matches "would you like to" + a `❯` line and beats `osc_title_idle` at 250), so `blocked`
# IS reported for the plan dialog. What was missing is what to press once it is.
# ---------------------------------------------------------------------------------------------
dialog_kind() {
  case "$(screen)" in
    *"Would you like to proceed?"*|*"Ready to code?"*) echo plan ;;
    *"Submit answers"*|*"Review your answers"*)        echo ask ;;
    *"Do you want to proceed?"*)                       echo permission ;;
    *)                                                 echo none ;;
  esac
}

answer() {
  case "$(dialog_kind)" in
    plan)
      # OPTION 2, NOT THE DEFAULT. The highlighted option 1 is "Yes, clear context … and use auto
      # mode", which ENDS this session and starts a fresh one. The harness then drives a session it
      # never handshook, whose beat prompts arrive in a context that was just wiped — run 1 left
      # three session transcripts behind for exactly this reason. Option 2 approves and KEEPS the
      # session. The cleared-context path is not skipped by this choice; it is what
      # delegation-boundary.e2e.sh exists to cover, with a fixture built for it.
      log "  dialog: plan approval — selecting 'Yes, and use auto mode' (keeps the session)"
      herdr agent send-keys "$AGENT" down >/dev/null 2>&1; sleep 1
      herdr agent send-keys "$AGENT" enter >/dev/null 2>&1; sleep 8 ;;
    ask|permission|none)
      # `right` walks to the Submit tab, which shows "Ready to submit your answers? > 1. Submit
      # answers". A plain single-select has no such tab, so the probe finds nothing and the first
      # `enter` was already the answer.
      herdr agent send-keys "$AGENT" enter >/dev/null 2>&1
      sleep 2
      local i
      for i in 1 2 3 4; do
        case "$(screen)" in
          *"Submit answers"*) herdr agent send-keys "$AGENT" enter >/dev/null 2>&1; sleep 3; return 0 ;;
        esac
        herdr agent send-keys "$AGENT" right >/dev/null 2>&1
        sleep 2
      done
      sleep 2 ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# NEVER PROMPT INTO AN IN-FLIGHT TOOL CALL. THIS IS THE DEFECT THAT COST TWO FULL RUNS.
#
# MEASURED 2026-08-06, runs 1 and 2 — four ExitPlanMode calls, four rejections, zero receipts, and
# the harness reporting "the PLAN beat did not complete" about a beat it killed itself:
#
#     19:24:41.501  assistant  tool_use ExitPlanMode
#     19:24:42.304  user       "toolDenialKind": "user-rejected"   <- 0.8s later, carries a promptId
#
# Eight tenths of a second, and the record carries a `promptId` — no keypress was involved. Claude
# Code treats an arriving user message as an INTERRUPTION, so a step prompt sent while the model is
# mid-tool-call rejects that call. `settle` returned on `idle`, the harness immediately sent the
# next beat's prompt, and the model had already moved on to ExitPlanMode.
#
# So every prompt now goes through here: answer any dialog first, then require the agent to be idle
# and STILL idle a few seconds later. A single idle sample is a snapshot of a moving target; two
# agreeing samples with no dialog between them is the weakest claim that is actually safe.
# ---------------------------------------------------------------------------------------------
say() {
  local text="$1" i state
  for i in $(seq 1 40); do
    if [ "$(dialog_kind)" != none ]; then answer; continue; fi
    state=$(agent_state)
    case "$state" in
      idle|done)
        sleep 4
        [ "$(dialog_kind)" != none ] && continue
        [ "$(agent_state)" = "$state" ] && break ;;
      *) sleep 5 ;;
    esac
  done
  herdr agent prompt "$AGENT" "$text" --wait --timeout "$STEP_TIMEOUT" >/dev/null 2>&1
}

# When the agent is idle but still waiting on something only a person can supply, a keypress cannot
# help — it needs words. `settle` calls this after two unproductive rounds.
nudge() {
  say "references/notes.md is the complete and only source for this memo, and it is sufficient. Do not ask for more sources. Proceed with the beat you are on, using what is there."
}

# Wait for the agent to settle, answering any prompt it raises, up to `$2` rounds. Returns 0 once
# it is idle/done with no prompt outstanding.
settle() {
  local label="$1" rounds="${2:-8}" i state
  for i in $(seq 1 "$rounds"); do
    herdr agent wait "$AGENT" --timeout "$STEP_TIMEOUT" >/dev/null 2>&1
    state=$(agent_state)
    case "$state" in
      blocked) log "$label: agent blocked on a prompt (round $i) — answering"; answer ;;
      idle|done)
        # A DIALOG IS ANSWERED BEFORE ANYTHING ELSE IS CONSIDERED. A dialog can be on screen while
        # Herdr's title-based detection still reads idle, and text submitted into one REJECTS the
        # tool call underneath it — the harness would then report the beat it just killed.
        if [ "$(dialog_kind)" != none ]; then
          log "$label: dialog open while idle — answering with keys, not words"; answer; continue
        fi
        # An agent that goes idle without advancing the beat is usually waiting on something a
        # keypress cannot supply. Nudge once, then accept the state.
        if [ "$i" -le 2 ] && [ -n "${NEED_NUDGE:-}" ]; then
          log "$label: idle but beat not advanced — nudging with text"; nudge; NEED_NUDGE=""; continue
        fi
        return 0 ;;
      *) sleep 5 ;;
    esac
  done
  return 1
}

json_has() { # <file> <python-expr over `d`>  -> 0 if truthy
  python3 -c "
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(1)
sys.exit(0 if ($2) else 1)" "$1" "$2" 2>/dev/null
}

# --------------------------------------------------------------------------------------------
echo "setup: governed project with the working-tree build pinned"
# --------------------------------------------------------------------------------------------
P="$WORK/proj"
mkdir -p "$P"
pin_plugin_build "$REPO" || { echo "could not pin the plugin build" >&2; exit 2; }
seed_project "$P" --no-episode          # a FRESH episode: /writing must create it, not inherit it
rm -f "$P/.planning/.state/review.json" # nothing approved yet; PLAN has to produce it
mkdir -p "$P/references" "$P/outlines" "$P/drafts"
cat > "$P/references/notes.md" <<'NOTES'
# Widget adoption, 2025 — research notes

## Measured adoption
- Q1 2025 installed base: 41,200 units (internal telemetry export, 2025-04-02).
- Q4 2025 installed base: 57,900 units (same export, 2026-01-08). Growth of 40.5%.
- Adoption concentrated in mid-market accounts (50-500 seats): 78% of net new units.

## Reliability
- Mean time between failures rose from 1,840h (2024) to 2,610h (2025) after the v3 bearing change.
- Field returns fell from 3.1% to 1.4% of shipped units over the same period.

## Cost
- Unit cost fell from $88 to $71, driven by the switch to a single-source magnet supplier.
- That single-source dependency is the main identified supply risk; no second source qualified.

## Open question
- Enterprise (500+ seat) adoption was flat. No instrumented explanation; sales anecdote only.
NOTES
log "project: $P"

PANE=$(herdr pane split --current --direction right --cwd "$P" --no-focus \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
sleep 2
herdr pane run "$PANE" "$E2E_BIN --permission-mode acceptEdits" >/dev/null 2>&1
sleep 25
AGENT="$PANE"   # agent commands accept the hosting pane ID
[ "$(agent_state)" = "idle" ] || { echo "agent did not come up in $PANE" >&2; exit 2; }
herdr agent prompt "$AGENT" 'Reply with exactly: HANDSHAKE_OK' --wait --timeout 120000 >/dev/null 2>&1
HS=$(screen)
case "$HS" in
  *HANDSHAKE_OK*) ok "a real $E2E_BIN session is running AND its screen is readable" ;;
  "") echo "FATAL: the agent screen reads empty — the harness cannot observe this session." >&2
      echo "       Every downstream verdict would describe an agent nobody can see." >&2
      exit 2 ;;
  *)  echo "FATAL: handshake not echoed; the session is not accepting prompts." >&2
      printf '%s\n' "$HS" | tail -20 >&2
      exit 2 ;;
esac

# --------------------------------------------------------------------------------------------
echo
echo "1. CLARIFY — /writing must ASK before it looks"
# --------------------------------------------------------------------------------------------
say \
  'Use the workflows:writing skill. Write a two-page internal decision memo on widget adoption in 2025 for our leadership team, recommending whether to qualify a second magnet supplier. The single complete source is references/notes.md; do not seek other sources and do not ask for more. Audience: internal leadership. Purpose: assess and recommend. Deliverable: markdown. Follow the workflow exactly.'
NEED_NUDGE=1; settle "CLARIFY" 6

dump clarify
EP="$P/.planning/.state/episode.json"
if json_has "$EP" 'd.get("phases",{}).get("clarified")'; then
  ok "episode.json records phases.clarified — a hook OBSERVED AskUserQuestion"
else
  bad "no phases.clarified: the workflow did not actually clarify (or never called AskUserQuestion)"
fi
json_has "$EP" 'd.get("workflow")=="writing"' \
  && ok "the episode is bound to workflow=writing" \
  || bad "episode.json does not name the writing workflow"

# --------------------------------------------------------------------------------------------
echo
echo "2. PLAN — approval must produce a hash-bound receipt"
# --------------------------------------------------------------------------------------------
say \
  'Proceed to the PLAN beat now. Produce the required plan grammar and take it through native Plan mode to approval.'
NEED_NUDGE=1; settle "PLAN" 10

dump plan
RJ="$P/.planning/.state/review.json"
if json_has "$RJ" 'len(str(d.get("plan_hash","")))==64'; then
  ok "review.json holds a 64-hex plan_hash — approved-artifact-persist bound the exact bytes"
else
  bad "no hash-bound receipt: the PLAN beat did not complete"
fi
json_has "$RJ" 'd.get("workflow")=="writing"' \
  && ok "the receipt names workflow=writing" \
  || bad "the receipt does not name the writing workflow"

PLAN_OK=0
json_has "$RJ" 'len(str(d.get("plan_hash","")))==64' && PLAN_OK=1

# --------------------------------------------------------------------------------------------
echo
echo "3. IMPLEMENT — the doer is a delegated agent, never main chat"
# --------------------------------------------------------------------------------------------
if [ "$PLAN_OK" = 0 ]; then
  skip "IMPLEMENT cannot be judged: no approved plan exists to implement"
  skip "REVIEW cannot be judged: nothing was implemented"
  echo
  [ "${E2E_KEEP:-}" = 1 ] || log "re-run with E2E_KEEP=1 to preserve the fixture for diagnosis"
  summary
fi
say \
  'Proceed to the IMPLEMENT beat and produce the drafts the approved plan declares.'
NEED_NUDGE=1; settle "IMPLEMENT" 12

dump implement
SCREEN=$(screen)
if [ -n "$(find "$P/drafts" "$P/outlines" -type f 2>/dev/null | head -1)" ]; then
  ok "the plan's declared outputs exist on disk"
else
  bad "no outline or draft was produced"
fi
# The guard is registered plugin-wide as of v5.139.0, so a main-chat write attempt is refused and
# the refusal is visible. Its ABSENCE is not proof of delegation, so this is reported, not asserted.
case "$SCREEN" in
  *"DELEGATION VIOLATION"*) log "IMPLEMENT: main chat attempted a write and was refused (expected)" ;;
  *) log "IMPLEMENT: no delegation refusal observed" ;;
esac

# --------------------------------------------------------------------------------------------
echo
echo "4. REVIEW — verification is not acceptance"
# --------------------------------------------------------------------------------------------
say \
  'Proceed through the VERIFY and REVIEW beats.'
NEED_NUDGE=1; settle "REVIEW" 10

SCREEN=$(screen)
# `*review*` matched anything — the word appears all over a Claude Code screen, so the original
# assertion passed on a run where NOTHING had been implemented. Require the beat's own terminal
# decision vocabulary instead.
case "$SCREEN" in
  *"ACCEPT"*|*"REJECT:"*|*"human review"*|*"Review Surfaces"*)
     ok "the run reaches a human-review surface with the beat's decision vocabulary" ;;
  *) bad "no review surface reached" ;;
esac

echo
[ "${E2E_KEEP:-}" = 1 ] || log "re-run with E2E_KEEP=1 to preserve the fixture for diagnosis"
summary
