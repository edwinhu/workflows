#!/usr/bin/env bash
# CLI runner: delegate to a CLIProxyAPI wrapper in a separate process.
#
# THIS IS THE ONLY RUNNER. It replaced an Agent-SDK runner that shelled the
# wrapper ONLY for `--settings-json`, harvested its env, then reimplemented the
# client that wrapper already is. That runner was deleted 2026-08-23; work
# dispatch and re-dispatch both come here. Two reasons it went, both measured
# 2026-08-22:
#
#   * The SDK's `options.agent` applies an agent's tool restrictions and model
#     but NOT its system prompt. Asked whether it carried the DS constraints,
#     an SDK child under `agent: "ds"` answered "NOT PRESENT"; `claude-code -p
#     --agent ds` quoted the preload sentence back. So the SDK path silently
#     narrows the toolset and delivers none of the persona.
#   * An SDK child is a bare query() — no Agent tool, no Workflow tool. A
#     `-p` child is a full Claude Code session and has both, so a farmed run
#     can fan out further. FARM_OUT_CHILD=1 already exempts it from
#     main-thread-guard.
#
# Invoking the wrapper directly also deletes the env-harvesting layer: the
# wrapper sets its own environment. What is kept, because it is the only
# load-bearing logic in the SDK runner, is the anti-simulation clause and
# artifact verification.
#
#   farm.sh --tasks tasks.json --cwd /repo   # JSON array; one row or many, run in parallel.
#                                            # Each row is routed by scripts/lib/route.ts on its
#                                            # "kind" (or its own "provider"/"model"); a row with
#                                            # neither is refused and nothing runs. Every row names
#                                            # its "workflow" (or "none"; a persona implies one), and
#                                            # bin/workflow-check gates what the row touched. A row
#                                            # "schema" becomes --json-schema (see run_one);
#                                            # "sandbox": true runs the row's commands in a
#                                            # throwaway bubblewrap overlay (sandbox.sh).
#   farm.sh --tasks tasks.json --detach      # watcher alive: relaunch in the background and return
#                                            # at once, log path on stdout; else run in the foreground
#   farm.sh --workflow /abs/wf.js --args /abs/args.json --out /abs/result.json
#   farm.sh --provider claude|codex|gemini   # legacy whole-run override: that wrapper for every
#                                            # row, route.ts never consulted (--workflow needs it)
#   farm.sh --verdict <rowId> correct|wrong "<why>"   # label a finished row; runs nothing
#   farm.sh --no-cron                        # --workflow: skip the hourly heartbeat printout
#                                            # (--tasks never prints one)
#   WORK_LOOP_INTERVAL_MINUTES=30            # heartbeat period, whole minutes (default 60)
#   FARM_OUTCOMES=/path.jsonl                # outcome + verdict log (default below)
#
set -uo pipefail

declare -A WRAPPERS=( [claude]=claude-code [codex]=codex-code [gemini]=gemini-code )

# skills/farm-out/scripts/farm.sh -> the plugin root, four levels up. Resolved from this file, not
# CLAUDE_PLUGIN_ROOT, so a worktree's farm.sh runs that worktree's route.ts and watchdog.
PLUGIN_ROOT=$(dirname "$(dirname "$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")")")")
SANDBOX_SH="$PLUGIN_ROOT/skills/farm-out/scripts/sandbox.sh"

# One machine-wide, append-only JSONL: a `row` line per finished --tasks row, a `verdict` line per
# --verdict, and an automatic `wrong` verdict for a row that dropped its expect or ended GONE. It is the labelled dataset Jev is graded on, so it outlives the farm-events files
# and never holds prompt text.
OUTCOMES=${FARM_OUTCOMES:-${HOME:-}/.local/state/workflows/farm-outcomes.jsonl}

# Without this, a delegated run will report success it never observed.
ANTI_SIM='

You MUST actually perform this work with real tool calls. Do not simulate, summarize, or claim any completion you did not observe. If you cannot do it, say so explicitly with the exact error text and stop.'

# A child ends its turn into nothing. In an interactive session a progress report or an offer to
# continue is answered by the user; here the session simply exits with the deliverable unwritten,
# and the caller sees a run that "succeeded" and produced no artifact. Kept BYTE-IDENTICAL to the
# copies in farm-team.sh and grind.sh -- tests/child-standing-instruction.test.ts pins all three to
# one string, which is what keeps three copies from drifting apart. No apostrophes, no $ and no
# backticks in the text: it has to survive this single-quoted assignment, a quoted heredoc, and
# grind's UNQUOTED one.
CHILD_STANDING='

NOBODY IS WATCHING THIS RUN. There is no one to answer a question, accept an offer, or take a next step you merely name. Do not end your turn with a progress report, a summary that announces the next step instead of taking it, a list of decisions that do not block you, or an offer to continue. While the deliverable is unmet, taking the next step IS your turn. End your turn only when you are genuinely blocked, and then say exactly what blocks you.'

# Exit 2 is "you called me wrong" -- distinct from 1, "the delegation failed".
refuse() { printf '%s\n' "$*" >&2; exit 2; }

# THE ROW'S WORKFLOW. Every --tasks row is gated by one workflow's checks (bin/workflow-check), so every
# row names it: `"workflow": "<wf>"`, or `"workflow": "none"` said out loud. A persona implies one when
# the row names none: its name with `/` for `-` (writing-legal -> writing/legal) when the layout has that
# workflow, and none for a read-only persona (no Write, Edit or Bash), which writes nothing to gate.
# The layout is the only judge of a name: `workflow-check <wf> --list`, once per name per run.
declare -A WF_OK=() WF_WHY=()
wf_known() {
  if [ -z "${WF_OK[$1]+x}" ]; then
    local why
    if why=$(python3 "$PLUGIN_ROOT/bin/workflow-check" "$1" --list 2>&1 >/dev/null); then WF_OK[$1]=1
    else WF_OK[$1]=0; WF_WHY[$1]=${why:-workflow-check $1 --list failed}; fi
  fi
  [ "${WF_OK[$1]}" = 1 ]
}
# Sets ROW_WF to the workflow that gates row $1 (label $2, agent $3, "workflow" field $4), "" for none;
# refuses the run when the row names no workflow and its persona implies none, or names an unknown one.
row_workflow() {
  local i=$1 label=$2 persona="${3##*:}" w=$4 file="" readonly_persona=0
  ROW_WF=""
  if [[ "$persona" =~ ^[A-Za-z0-9_.-]+$ ]] && [ -f "$PLUGIN_ROOT/user-agents/$persona.md" ]; then
    file="$PLUGIN_ROOT/user-agents/$persona.md"
    grep -qs '^tools:.*\(Write\|Edit\|Bash\)' "$file" || readonly_persona=1
  fi
  if [ "$w" = none ]; then return 0; fi
  if [ -n "$w" ]; then
    wf_known "$w" || refuse "task $i ($label) workflow \"$w\" is not a workflow: ${WF_WHY[$w]}"
    # a read-only persona writes nothing; an mtime walk would blame it for a sibling row's files
    [ "$readonly_persona" = 1 ] || ROW_WF=$w
    return 0
  fi
  [ "$readonly_persona" = 1 ] && return 0
  if [ -n "$file" ] && wf_known "${persona//-//}"; then ROW_WF=${persona//-//}; return 0; fi
  refuse "task $i ($label) names no workflow: add \"workflow\": \"<wf>\" (a workflow under checks/, whose checks then gate the row's output) or \"workflow\": \"none\"${persona:+ — persona $persona implies none}"
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Append one line to $OUTCOMES in ONE write(2) on an O_APPEND descriptor. Rows finish in parallel
# and other farm.sh runs share the file; a shell redirect goes through a stdio buffer that splits a
# long line into several writes, which concurrent writers can interleave. The line arrives on
# stdin, never argv.
append_outcome() {
  mkdir -p -- "$(dirname -- "$OUTCOMES")" 2>/dev/null || return 1
  printf '%s\n' "$1" | python3 -c '
import os, sys
data = sys.stdin.buffer.read()
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
try:
    n = os.write(fd, data)
finally:
    os.close(fd)
sys.exit(0 if n == len(data) else 1)' "$OUTCOMES"
}

PROVIDER="" CWD=$PWD TASKS= WORKFLOW= ARGSFILE= OUT= CRON=1 BUDGET="" DETACH=0 ; EXPECT=()
VERDICT_MODE=0 VERDICT_ID= VERDICT= VERDICT_WHY=
ARGV=("$@")   # what a --detach relaunch passes on, minus --detach
while [ $# -gt 0 ]; do
  case "$1" in
    --detach)   DETACH=1; shift ;;
    --no-cron)  CRON=0; shift ;;
    --cron)     CRON=1; shift ;;   # accepted no-op alias -- the cron is the default
    --verdict)  [ $# -ge 4 ] || refuse "usage: farm.sh --verdict <rowId> correct|wrong \"<why>\""
                VERDICT_MODE=1 VERDICT_ID=$2 VERDICT=$3 VERDICT_WHY=$4; shift 4 ;;
    --provider) PROVIDER="${2:?--provider needs a value}"; shift 2 ;;
    --cwd)      CWD="${2:?--cwd needs a value}";           shift 2 ;;
    --tasks)    TASKS="${2:?--tasks needs a value}";       shift 2 ;;
    --budget)   BUDGET="${2:?--budget needs a value}";     shift 2 ;;
    --expect)   EXPECT+=("${2:?--expect needs a value}");  shift 2 ;;
    --workflow) WORKFLOW="${2:?--workflow needs a value}"; shift 2 ;;
    --args)     ARGSFILE="${2:?--args needs a value}";     shift 2 ;;
    --out)      OUT="${2:?--out needs a value}";           shift 2 ;;
    *) refuse "unknown argument: $1" ;;
  esac
done
# A --workflow run is detached by its caller (work-dispatch.sh), which also owns its wake.
[ "$DETACH" = 0 ] || { [ -n "$TASKS" ] && [ -z "$WORKFLOW" ]; } || refuse "--detach needs --tasks"

# A verdict labels a row that already ran; it never runs anything. Only a row line can be judged,
# so an id with no row line is refused -- a label for a row nobody can find is noise in the holdout.
if [ "$VERDICT_MODE" = 1 ]; then
  [ -z "$TASKS$WORKFLOW$ARGSFILE$OUT$PROVIDER" ] && [ "${#EXPECT[@]}" -eq 0 ] \
    || refuse "--verdict stands alone: no --tasks, --workflow, --args, --out, --provider or --expect"
  case "$VERDICT" in correct|wrong) ;; *) refuse "--verdict: verdict must be correct or wrong, not '$VERDICT'" ;; esac
  [ -n "$VERDICT_WHY" ] || refuse "--verdict: give a reason, e.g. --verdict $VERDICT_ID $VERDICT \"the tests it claimed pass fail\""
  found=""
  if [ -f "$OUTCOMES" ]; then
    # grep -F first: the file only grows, and jq over every line of it per verdict is the slow part.
    found=$(grep -F -- "$VERDICT_ID" "$OUTCOMES" 2>/dev/null \
      | jq -Rr --arg id "$VERDICT_ID" 'fromjson? | select(type == "object" and .type == "row" and .rowId == $id) | .rowId' 2>/dev/null \
      | head -n 1)
  fi
  [ -n "$found" ] || refuse "--verdict: no row line with rowId '$VERDICT_ID' in $OUTCOMES"
  line=$(jq -cn --arg rowId "$VERDICT_ID" --arg verdict "$VERDICT" --arg why "$VERDICT_WHY" --arg ts "$(now_iso)" \
    '{type: "verdict", rowId: $rowId, verdict: $verdict, why: $why, ts: $ts}') \
    || { printf 'farm: could not build the verdict line\n' >&2; exit 1; }
  append_outcome "$line" || { printf 'farm: could not append to %s\n' "$OUTCOMES" >&2; exit 1; }
  printf 'farm: VERDICT %s %s\n' "$VERDICT_ID" "$VERDICT" >&2
  exit 0
fi

# All validation runs before the wrapper is touched: a refusal must not depend
# on the proxy being reachable.
#
# No --provider means 'route': each --tasks row gets its own provider and model from route.ts.
# --provider is the legacy whole-run override -- that wrapper for every row, route.ts never asked.
PROVIDER=${PROVIDER:-route}
WRAPPER=""
if [ "$PROVIDER" != route ]; then
  WRAPPER="${WRAPPERS[$PROVIDER]:-}"
  [ -n "$WRAPPER" ] || refuse "unknown provider $PROVIDER; use claude|codex|gemini, or omit --provider to route each row by its kind"
  command -v "$WRAPPER" >/dev/null || refuse "$WRAPPER not on PATH"
fi
[ -d "$CWD" ] || refuse "--cwd $CWD: no such directory"
# ONE task mode, not two. The only caller is a model reading the skill doc, so an inline
# --task saved nobody anything -- and a machine-written prompt passed as a shell argument
# has to survive quoting (backticks, nested quotes, $) that a JSON file sidesteps. One row
# or fifty, it is --tasks.
[ -n "$TASKS" ] || [ -n "$WORKFLOW" ] || refuse "need --tasks or --workflow"
[ -z "$TASKS" ] || [ -z "$WORKFLOW" ] || refuse "pick one of --tasks, --workflow"
[ "${#EXPECT[@]}" -eq 0 ] || [ -n "$WORKFLOW" ] \
  || refuse "--expect applies only to --workflow; a --tasks row carries its own \"expect\""
# No --agent flag: a persona is named per row ("agent"), which is also the only place it
# CAN be named -- a workflow picks its agents per leg instead. One way to say it.

if [ -n "$WORKFLOW" ]; then
  # route.ts routes ROWS; a workflow has none, and its legs pick their own agents and models.
  [ "$PROVIDER" != route ] \
    || refuse "--workflow needs --provider claude|codex|gemini: routing applies to --tasks rows"
  # A workflow's value is a structured return. Relaying it as prose puts a model in the
  # gate path, so the child writes the object to --out and we check the file.
  [ -n "$OUT" ] || refuse "--workflow requires --out <path>: the returned object is the result, not the summary"
  WORKFLOW=$(realpath -m "$WORKFLOW"); OUT=$(realpath -m "$OUT")
  # Cheaper to catch a typo'd path here than 20-60 minutes into a dispatched run.
  [ -f "$WORKFLOW" ] || refuse "--workflow $WORKFLOW: no such file"
  [ -d "$(dirname "$OUT")" ] || refuse "--out $OUT: directory does not exist"
  [ ! -d "$OUT" ] || refuse "--out $OUT is a directory"
  if [ -n "$ARGSFILE" ]; then
    jq -e 'type == "object"' "$ARGSFILE" >/dev/null 2>&1 \
      || refuse "--args $ARGSFILE must hold a JSON object"
  fi
  # A workflow picks its agents PER LEG -- `agent(prompt, {agentType: "ds"})` in the
  # script, or implementerAgentType / verifierAgentType / lens.agentType in a
  # work args file. One top-level persona is the wrong shape: the point is `ds` to
  # implement and `ds-reviewer` or `Explore` to judge. (A sealed persona also has no
  # Workflow tool, so it could not dispatch one anyway.)
  # (no --agent flag exists; a workflow names its agents per leg via agentType)
elif [ -n "$ARGSFILE" ] || [ -n "$OUT" ]; then
  refuse "--args and --out apply only to --workflow"
fi
[ -z "$TASKS" ] || [ -f "$TASKS" ] || refuse "--tasks $TASKS: no such file"
[ -z "$TASKS" ] || jq -e 'type == "array"' "$TASKS" >/dev/null 2>&1 \
  || refuse "--tasks $TASKS must hold a JSON array of tasks"

# Whether our CALLER is a farm child (no session to wake), read before the export below.
CALLER_IS_CHILD=${FARM_OUT_CHILD:-}
# Exempts our own children from the main-thread-guard PreToolUse hook, which
# would otherwise deny the delegation this script exists to perform.
export FARM_OUT_CHILD=1

# Rule 1: the model's own summary is not evidence. Check the artifact.
# Empty counts as missing -- a created-but-unwritten file is not a result. So does a file older
# than the row (mtime before its START t=): a repair row whose expect the previous row already wrote
# would otherwise pass with a child that did nothing. Same rule in farm-team.sh.
written_since() {  # <file> <epoch>
  local m
  [ -s "$1" ] || return 1
  m=$(stat -c %Y -- "$1" 2>/dev/null || stat -f %m -- "$1" 2>/dev/null) || return 1
  [ "$m" -ge "$2" ]
}
verify() {  # <row start epoch> <expect>...
  local missing=() abs t0=$1; shift
  for p in "$@"; do
    # An absent expect arrives as one "" ("${e[@]:-}"); resolved, it is $CWD itself, older than the row.
    [ -n "$p" ] || continue
    # Resolved against $CWD -- where the AGENT worked -- not ours. They are routinely different
    # (we are launched from wherever the caller sat, with --cwd pointing elsewhere), and a bare
    # test then checks a path that never existed and calls every artifact missing.
    case "$p" in /*) abs=$p ;; *) abs="$CWD/$p" ;; esac
    if [ ! -s "$abs" ]; then missing+=("$p")
    elif ! written_since "$abs" "$t0"; then missing+=("not written this run: $p")
    fi
  done
  printf '%s\n' "${missing[@]:-}"
}

# ---------------------------------------------------------------- the event stream
# Read by farm-alive.sh (work's liveness check) and the watcher mod (hooks/watch/watcher.ts). Keyed on $$ -- the shell
# that lives for the whole dispatch -- because those readers take the pid from the FILENAME and
# kill -0 it; a per-row subshell pid is dead the instant its row ends and every finished row
# would report GONE.
#
# enc() must stay byte-identical to farm-alive.sh's copy: the two are one protocol. Encoding
# space, tab, = and % is what stops a caller-supplied label spelling a second `out=` field
# inside an otherwise well-formed line and steering a checker at somebody else's run.
enc() {
  local s=${1-}
  s=${s//%/%25}; s=${s// /%20}; s=${s//$'\t'/%09}; s=${s//=/%3D}
  printf '%s' "$s"
}

EVENT_DIR="${TMPDIR:-/tmp}/farm-events${CLAUDE_CODE_SESSION_ID:+/$CLAUDE_CODE_SESSION_ID}"
mkdir -p "$EVENT_DIR" 2>/dev/null || true
EVENTS="$EVENT_DIR/$$.ndjson"

# Per-run budget cap and estimation (FARM_SESSION_BUDGET is a deprecated alias)
FARM_RUN_BUDGET=${FARM_RUN_BUDGET:-${FARM_SESSION_BUDGET:-20000000}}
FARM_TASK_BUDGET=${FARM_TASK_BUDGET:-4000000}
FARM_TASK_ESTIMATE=${FARM_TASK_ESTIMATE:-750000}

# Spend lives in the event files and nowhere else. A row's spend is its DONE/GONE/FAIL `W=` value (or a
# SPEND line, which is what eviction folds a pruned file down to); a `"tokensW"` result record is the same
# row's spend again and counts only when no W= line in its file carries that value. Per line, so one
# malformed line costs only itself; anything else mentioning tokensW is warned about, never dropped to zero.
# Prints the total, then the number of unparseable lines.
sum_spend() {
  local out
  out=$(jq -Rr 'sub("^farm: ";"") as $l
    | if ($l|test("^(DONE|GONE|FAIL|SPEND) .*\\bW=[0-9]")) then "D \(input_filename) \($l|capture("\\bW=(?<n>[0-9][0-9.eE+-]*)").n|tonumber? // 0)"
      elif ($l|contains("\"tokensW\":")) then
        ((try ($l|fromjson) catch null) as $j | if ($j|type)=="object" and (($j.tokensW?)|type)=="number" then "T \(input_filename) \($j.tokensW)" else "bad" end)
      else empty end' "$@" 2>/dev/null || true)
  printf '%s\n' "$out" | awk '$1=="D"{s+=$3; d[$2" "$3+0]=1} $1=="T"{t[++n]=$2" "$3+0; v[n]=$3} $1=="bad"{b++}
    END{for(i=1;i<=n;i++) if(!(t[i] in d)) s+=v[i]; printf "%.3f %d\n", s+0, b+0}'
}

session_tokens=0
if [ -d "$EVENT_DIR" ] && compgen -G "$EVENT_DIR/*.ndjson" >/dev/null; then
  read -r session_tokens bad_lines < <(sum_spend "$EVENT_DIR"/*.ndjson)
  session_tokens=$(printf '%.0f' "$session_tokens")
  if [ "${bad_lines:-0}" -gt 0 ]; then
    echo "farm: WARNING: $bad_lines unparseable tokensW line(s) in $EVENT_DIR skipped; session spend may be understated" >&2
  fi
fi

estimate=0
num_tasks=0
if [ -n "$TASKS" ]; then
  num_tasks=$(jq 'length' "$TASKS" 2>/dev/null || echo 0)
  for i in $(seq 0 $((num_tasks - 1))); do
    task_budget=$(jq -r ".[$i].budget // \"${BUDGET:-$FARM_TASK_BUDGET}\"" "$TASKS")
    task_estimate=$FARM_TASK_ESTIMATE
    [ "$task_estimate" -le "$task_budget" ] || task_estimate=$task_budget
    estimate=$((estimate + task_estimate))
  done
elif [ -n "$WORKFLOW" ]; then
  num_tasks=1
  estimate=$FARM_TASK_ESTIMATE
  task_budget=${BUDGET:-$FARM_TASK_BUDGET}
  [ "$estimate" -le "$task_budget" ] || estimate=$task_budget
fi

echo "Run estimate: $estimate tokensW for $num_tasks task(s) (cap $FARM_RUN_BUDGET per run)" >&2
echo "Session spend so far: $session_tokens tokensW (informational; not enforced)" >&2

if [ "${FARM_BUDGET_OVERRIDE:-0}" != "1" ]; then
  if [ "$estimate" -ge "$FARM_RUN_BUDGET" ]; then
    refuse "Run budget exceeded up front: $estimate (this run's estimate) >= ${FARM_RUN_BUDGET}. Set FARM_BUDGET_OVERRIDE=1 to bypass."
  fi
fi

emit() { printf 'farm: %s
' "$*" >>"$EVENTS" 2>/dev/null || true; }

# Nothing else ever deletes these, and farm-alive.sh greps every file in the directory on each
# poll -- so without eviction the cost of one liveness check grows with every dispatch ever run
# on this machine. Fold only files whose pid is gone AND that are old enough to be no run anyone
# is still waiting on: the file shrinks to one SPEND line (or goes, if it spent nothing), so the
# informational session-spend line still sees the spend after the run's record is pruned.
evict_stale_events() {
  local f pid total
  shopt -s nullglob
  for f in "$EVENT_DIR"/*.ndjson; do
    [ "$f" = "$EVENTS" ] && continue
    [ -n "$(find "$f" -mmin +60 -print -quit 2>/dev/null)" ] || continue
    pid=$(basename "$f" .ndjson)
    case "$pid" in ''|*[!0-9]*) rm -f -- "$f"; continue ;; esac
    kill -0 "$pid" 2>/dev/null && continue
    total=$(sum_spend "$f" | cut -d' ' -f1)
    if awk -v t="${total:-0}" 'BEGIN{exit !(t>0)}'; then
      [ "$(cat -- "$f" 2>/dev/null)" = "farm: SPEND W=$total" ] || { printf 'farm: SPEND W=%s\n' "$total" >"$f.tmp" && mv -f -- "$f.tmp" "$f"; }
    else
      rm -f -- "$f"
    fi
  done
}
evict_stale_events

# Both spellings, because the caller and we may name the same file differently and a checker
# that normalises on one side only reports a live run dead.
claim() {
  local label=$1 p=$2 c abs
  emit "CLAIM $(enc "$label") path=$(enc "$p") "
  # Canonicalise against $CWD, the directory the AGENT worked in. realpath resolves a relative
  # path against OURS, which is a different directory whenever --cwd points elsewhere -- so the
  # claimed path would name a file that never existed and a checker would never match it.
  case "$p" in /*) abs=$p ;; *) abs="$CWD/$p" ;; esac
  c=$(realpath -m -- "$abs" 2>/dev/null) || c=$abs
  [ "$c" = "$p" ] || emit "CLAIM $(enc "$label") path=$(enc "$c") "
}

# One delegated run. Emits a JSON object on stdout; the transcript goes to a
# temp file so tool_use events can be counted -- 0 tool calls on a work task is
# a fabrication smell, the same signal the old SDK runner read off its stream.
#
# provider picks the wrapper for THIS row (rows of one --tasks run may differ). meta is the row's
# outcome record minus what only the run can say; empty means record nothing (--workflow).
#
# schema, when set, is a compact JSON Schema object: the child gets it as --json-schema, the CLI
# validates the StructuredOutput call against it, and the validated value (the result event's
# .structured_output) is written to the row's ONE expect path unless the child wrote that file itself.
#
# sandbox=true: the child itself keeps the network (it has to reach the model), but every shell it
# spawns goes through CLAUDE_CODE_SHELL_PREFIX into ONE bubblewrap holder per row (sandbox.sh): the
# tree as it is now, uncommitted edits included, its data/ targets and $HOME as tmpfs-backed overlays,
# no network. Edit and Write are denied, the agent runs as a variant with Bash, and the holder dies
# with the row, taking every write with it. The expect file is still written here, outside.
run_one() {
  local label="$1" prompt="$2" agent="$3" model="$4" budget="$5" max_turns="$6" provider="$7" meta="$8" schema="$9" sandbox="${10}"; shift 10
  local expects=("$@") log err rc text calls models missing stderr_tail result orphaned failure
  local wrapper="${WRAPPERS[$provider]}"
  log=$(mktemp -t farm-out.XXXXXX.jsonl)
  err=$(mktemp -t farm-out.XXXXXX.err)

  # An expect path the child cannot see is a path it cannot write to. verify() then
  # reports the artifact missing for work that actually succeeded, and the deliverable is
  # left wherever the child guessed. Measured 2026-08-23: 5 dispatches, 4 reported missing,
  # all four from this; the one that landed was the one whose prompt had the literal path
  # pasted in by hand. So state the contract to the child, do not only check it afterwards.
  #
  # Filter empties first: the caller passes "${e[@]:-}", so an absent expect arrives as one
  # empty string rather than an empty array (same reason the missing[] fixup below exists).
  local -a real_expects=()
  local _e
  for _e in "${expects[@]:-}"; do [ -n "$_e" ] && real_expects+=("$_e"); done
  if [ -n "$schema" ] && [ "${#real_expects[@]}" -gt 0 ]; then
    prompt+="

Return your deliverable by calling the StructuredOutput tool with ONE object matching its schema. The runner writes that object to:
  ${real_expects[0]}"
  elif [ "${#real_expects[@]}" -gt 0 ]; then
    prompt+="

Write your deliverable to EXACTLY this path, literally as written, creating parent directories if needed. Do not choose a different location, and do not add a suffix, timestamp or extension:"
    for _e in "${real_expects[@]}"; do prompt+="
  ${_e}"
    done
  fi

  local sbx_tmp="" sbx_pid="" sbx_holder="" sbx_fail="" run_agent="$agent" agents_file=""
  if [ "$sandbox" = true ]; then
    prompt+="

Your Bash tool runs in a throwaway sandbox of this machine: the working tree exactly as it is now (uncommitted changes included), its data directories and \$HOME are overlays, so tests, check scripts and the plan's acceptance commands run against the real files, and everything they write vanishes when you finish. There is no network: ssh, qsub, curl and remote jobs fail there by design. Read, Grep and Glob see the real tree, not what your commands wrote; inspect those outputs with Bash."
    sbx_tmp=$(mktemp -d /tmp/farm-sandbox.XXXXXX)
    bash "$SANDBOX_SH" hold "$CWD" "$sbx_tmp" 3>"$log.sandbox" 2>"$log.sandbox.err" &
    sbx_holder=$!
    local _i
    for _i in $(seq 1 100); do
      sbx_pid=$(jq -r '."child-pid" // empty' "$log.sandbox" 2>/dev/null) && [ -n "$sbx_pid" ] && break
      kill -0 "$sbx_holder" 2>/dev/null || break
      sleep 0.05
    done
    [ -n "$sbx_pid" ] || sbx_fail="sandbox did not start: $(tail -3 "$log.sandbox.err" | tr '\n' ' ')"
    # The agent's own file never lists Bash; the row runs the variant sandbox.sh derives from it. An
    # agent with no file (a built-in such as Explore) runs as itself, behind the same tool denial.
    if [ -n "$agent" ] && [ -z "$sbx_fail" ]; then
      local bare=${agent#workflows:} cand
      for cand in "$CWD/.claude/agents/$bare.md" "${HOME:-}/.claude/agents/$bare.md" \
                  "$PLUGIN_ROOT/user-agents/$bare.md" "$PLUGIN_ROOT/agents/$bare.md"; do
        [ -f "$cand" ] || continue
        agents_file="$log.agents.json"
        if bash "$SANDBOX_SH" agent "$bare" "$cand" "$agents_file" 2>>"$log.sandbox.err"; then
          run_agent="$bare-sandboxed"
        else
          sbx_fail="could not derive a sandboxed variant of agent $agent from $cand"
        fi
        break
      done
    fi
  fi

  local t0
  t0=$(date +%s)
  emit "START $(enc "$label") cwd=$(enc "$CWD") out=$(enc "${OUT:-}") expect=${#real_expects[@]} t=$t0"
  for _e in "${real_expects[@]:-}"; do [ -n "$_e" ] && claim "$label" "$_e"; done
  [ -n "${OUT:-}" ] && claim "$label" "$OUT"

  # No --permission-mode: the runner inherits the user's default (auto), which keeps hard_deny --
  # the FERPA and licensed-data rules -- applying inside a dispatched run. The farmOutOnly policy
  # that used to fight this lives in main-thread-guard.sh now, and a hook can read FARM_OUT_CHILD.
  # The prompt goes on STDIN, never argv: Linux caps one argv string at 128 KiB (a 168 KB
  # prompt died "Argument list too long", exit 126).
  # Cross-provider guard: gemini and codex children are told not to call a model API themselves.
  local guard=""
  if [ "$provider" = "gemini" ] || [ "$provider" = "codex" ]; then
    guard="

Never call any model API (no requests to ANTHROPIC_BASE_URL or any /v1/ endpoint, no LLM-calling scripts); do the work yourself."
  fi
  local prompt_file
  prompt_file=$(mktemp -t farm-out.XXXXXX.prompt)
  printf '%s' "${prompt}${ANTI_SIM}${CHILD_STANDING}${guard}" > "$prompt_file"
  local -a cmd=("$wrapper" -p --output-format stream-json --verbose)
  [ -n "$run_agent" ] && cmd+=(--agent "$run_agent")
  if [ "$sandbox" = true ]; then
    [ -n "$agents_file" ] && cmd+=(--agents "$agents_file")
    cmd+=(--strict-mcp-config --disallowedTools "Edit,Write,NotebookEdit,MultiEdit")
  fi
  # Per-row model override. Absent leaves the wrapper's own default -- which is what every
  # existing caller gets, since no row carried one until now.
  [ -n "$model" ] && cmd+=(--model "$model")
  [ -n "$schema" ] && cmd+=(--json-schema "$schema")
  touch "$log.stamp"
  
  # Keep stderr: a provider that dies (proxy down, model rejected, auth stale) writes
  # there and nowhere else, and discarding it leaves only a bare exit code to debug.
  # exec: $! must be the wrapper itself, or the watchdog's SIGTERM stops a subshell and orphans it.
  # FARM_ROW_ID reaches the child and everything it starts, never us: it is how bgjobs.py finds a job
  # the child left running, even one that setsid took out of the process group.
  local row_id
  row_id=$(printf '%s' "$meta" | jq -r '.rowId // empty' 2>/dev/null)
  [ -n "$row_id" ] || row_id="wf-$$-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  # A sandbox that failed to start runs nothing: the row fails as a dead child, never unsandboxed.
  local -a pre=()
  if [ -n "$sbx_fail" ]; then
    pre=(bash -c 'printf "farm: %s\n" "$1" >&2; exit 125' sandbox "$sbx_fail"); cmd=()
  elif [ "$sandbox" = true ]; then
    pre=(env CLAUDE_CODE_SHELL_PREFIX="$SANDBOX_SH" FARM_SANDBOX_PID="$sbx_pid"
             TMPDIR="$sbx_tmp" CLAUDE_CODE_TMPDIR="$sbx_tmp")
  fi
  ( cd "$CWD" && export FARM_ROW_ID="$row_id" && exec ${pre[@]+"${pre[@]}"} ${cmd[@]+"${cmd[@]}"} ) < "$prompt_file" > "$log" 2>"$err" &
  local child_pid=$!
  
  local wd_out
  wd_out=$(python3 "$PLUGIN_ROOT/skills/farm-out/scripts/watchdog.py" "$child_pid" "$log" "${budget:-4000000}" "${max_turns:-250}")
  # Not `|| true`: that sets $? to true's 0, so every row read as exit 0 however its child died.
  wait "$child_pid" 2>/dev/null
  rc=$?
  
  local wd_tokens=$(printf '%s' "$wd_out" | jq -r '.tokensW // 0')
  local wd_turns=$(printf '%s' "$wd_out" | jq -r '.turns // 0')
  local wd_exceeded=$(printf '%s' "$wd_out" | jq -r '.budgetExceeded // false')
  
  local cross_provider=false
  if [ "$provider" = "gemini" ] || [ "$provider" = "codex" ]; then
    if find "$CWD" -newer "$log.stamp" -type f -exec grep -lE 'v1/messages|ANTHROPIC_AUTH_TOKEN' {} + 2>/dev/null | grep -q .; then
      cross_provider=true
      rc=1
    fi
  fi
  
  stderr_tail=$(rg -Nv "^mise " "$err" 2>/dev/null | tail -5)

  text=$(jq -rs '[.[] | select(.type=="result") | .result] | last // ""' "$log" 2>/dev/null)
  calls=$(jq -s '[.[] | select(.type=="assistant") | .message.content[]?
                 | select(.type=="tool_use")] | length' "$log" 2>/dev/null || echo 0)
  models=$(jq -sc '[.[] | select(.type=="assistant") | .message.model] | unique' "$log" 2>/dev/null || echo '[]')
  # GONE: the child's stream ended with no `result` event -- it was killed or died mid-turn.
  local gone=false
  jq -se 'any(.[]; .type == "result")' "$log" >/dev/null 2>&1 || gone=true
  # A child that ended its turn with a background job running (release-6381b: "Still waiting on the
  # canary.") fails here by name, whatever its artifacts say. bgjobs.py also stops any survivor.
  orphaned=$(python3 "$PLUGIN_ROOT/skills/farm-out/scripts/bgjobs.py" reap "$row_id" "$log" 2>/dev/null)
  printf '%s' "$orphaned" | jq -e 'type == "array"' >/dev/null 2>&1 || orphaned='[]'
  failure=$(printf '%s' "$orphaned" | jq -r 'if length > 0 then "ended with background job running: " + (map(.cmd) | join("; ")) else "" end')
  # After the reap, so a job left running inside the sandbox is still reported by name.
  if [ -n "$sbx_holder" ]; then
    kill "$sbx_holder" 2>/dev/null; wait "$sbx_holder" 2>/dev/null
    rm -rf -- "$sbx_tmp" "$log.sandbox" "$log.sandbox.err" "$log.agents.json"
    [ -n "$sbx_fail" ] && failure="${failure:+$failure; }$sbx_fail"
  fi
  # Only the structured value, never the prose reply: null (StructuredOutput never called, or never
  # with a schema-valid object) writes nothing, so the expect stays missing and the row fails. A file
  # left by an earlier row is replaced: only one the child wrote this run outranks the value.
  if [ -n "$schema" ] && [ "${#real_expects[@]}" -eq 1 ]; then
    local so target
    case "${real_expects[0]}" in /*) target=${real_expects[0]} ;; *) target="$CWD/${real_expects[0]}" ;; esac
    so=$(jq -s '[.[] | select(.type == "result") | .structured_output] | last | select(type == "object")' "$log" 2>/dev/null)
    if ! written_since "$target" "$t0" && [ -n "$so" ]; then
      mkdir -p -- "$(dirname -- "$target")" && printf '%s\n' "$so" >"$target"
    fi
  fi
  # Output gate: a row must leave work that passes its workflow's checks -- every constraint and every
  # Jev rule under checks/<wf>/ and its parents', run by bin/workflow-check over what the row touched.
  # The workflow is the row's (row_workflow: its field, else its persona's; "none" and a read-only persona
  # are not gated). Nothing else runs these on a farmed row (check.sh covers /work runs only), so a child
  # that followed a brief over the rules would ship unchecked. Exit 1 = findings, 2 = a check could not
  # run, and an unrun check is not a pass -- both fail the row, and the runner's report is the failure text.
  local gate_out="" gate_wf="${FARM_ROW_WORKFLOW:-}"
  if [ -n "$gate_wf" ]; then
    local -a gate_args=("$gate_wf" --cwd "$CWD" --stamp "$log.stamp" --log "$log")
    for _e in "${real_expects[@]:-}"; do [ -n "$_e" ] && gate_args+=(--expect "$_e"); done
    if ! gate_out=$(python3 "$PLUGIN_ROOT/bin/workflow-check" "${gate_args[@]}" 2>&1); then
      failure="${failure:+$failure; }$gate_wf constraint gate failed (workflow-check $gate_wf): $(printf '%s' "$gate_out" | head -n 40)"
    fi
  fi
  mapfile -t missing < <(verify "$t0" "${expects[@]:-}")
  # verify prints one blank line when nothing is missing; drop it.
  [ "${#missing[@]}" -eq 1 ] && [ -z "${missing[0]}" ] && missing=()
  rm -f "$log" "$log.stamp" "$err" "$prompt_file"

  # The same verdict the caller gets: exit 0 AND every promised artifact present. A run that
  # exits 0 having dropped its deliverable is a failure, and DONE-on-rc-alone would call it ok.
  if [ "$wd_exceeded" = "true" ]; then
    emit "DONE $(enc "$label") fail budget W=$wd_tokens/${budget:-4000000} toolCalls=${calls:-0}"
    printf '{"type":"result","tokensW":%s,"budgetExceeded":true}\n' "$wd_tokens" >>"$EVENTS" 2>/dev/null || true
  elif [ "$rc" -eq 0 ] && [ "${#missing[@]}" -eq 0 ] && [ -z "$failure" ]; then
    emit "DONE $(enc "$label") ok toolCalls=${calls:-0} W=$wd_tokens"
  else
    emit "DONE $(enc "$label") fail rc=$rc missing=${#missing[@]} orphaned=$(printf '%s' "$orphaned" | jq length) toolCalls=${calls:-0} W=$wd_tokens"
  fi

  result=$(jq -n --arg label "$label" --arg result "$text" --argjson toolCalls "${calls:-0}" \
        --argjson models "${models:-[]}" --argjson exit "$rc" \
        --arg stderr "$stderr_tail" \
        --argjson tokensW "$wd_tokens" --argjson budgetExceeded "$wd_exceeded" \
        --argjson crossProvider "$cross_provider" \
        --argjson orphaned "$orphaned" --arg failure "$failure" \
        --argjson missing "$(printf '%s\n' "${missing[@]:-}" | jq -Rsc 'split("\n") | map(select(length>0))')" \
    '{label:$label, ok: (($missing|length)==0 and $exit==0 and ($budgetExceeded | not) and ($crossProvider | not) and ($orphaned|length)==0 and ($failure|length)==0), exit:$exit,
      toolCalls:$toolCalls, models:$models, missing:$missing, orphaned:$orphaned, result:$result, tokensW:$tokensW, budgetExceeded:$budgetExceeded, crossProvider:$crossProvider}
     + (if ($failure|length) > 0 then {failure:$failure} else {} end)
     + (if $exit != 0 and ($stderr|length) > 0 then {stderr:$stderr} else {} end)')

  # The outcome line takes only the verdict fields: `result` is the child's own text and can quote
  # the prompt back, so it never reaches the outcomes file. The result goes in on stdin.
  if [ -n "$meta" ]; then
    local line
    if ! line=$(printf '%s' "$result" | jq -c --argjson m "$meta" --arg ts "$(now_iso)" --arg cwd "$CWD_ABS" \
        '. as $r | {type: "row", rowId: $m.rowId, ts: $ts, cwd: $cwd, label: $m.label, kind: $m.kind,
                    route: $m.route, promptSha256: $m.promptSha256, promptLength: $m.promptLength,
                    exit: $r.exit, ok: $r.ok, missing: $r.missing, orphaned: $r.orphaned, toolCalls: $r.toolCalls, models: $r.models}
                   + (if $r.failure then {failure: $r.failure} else {} end)') \
       || ! append_outcome "$line"; then
      printf 'farm: could not record the outcome of row %s in %s\n' "$(printf '%s' "$meta" | jq -r '.rowId')" "$OUTCOMES" >&2
    # An undelivered artifact or a child that never finished is wrong by observation, not judgement,
    # so it is labelled here. Everything else waits for a --verdict from someone who checked it.
    elif [ "${#missing[@]}" -gt 0 ] || [ "$gone" = true ] || [ -n "$failure" ]; then
      if ! line=$(printf '%s' "$result" | jq -c --argjson m "$meta" --arg ts "$(now_iso)" --argjson gone "$gone" \
          '. as $r | ([if ($r.missing|length) > 0 then "expect-missing" else empty end, if $gone then "gone" else empty end,
                      if ($r.orphaned|length) > 0 then "background-orphaned" else empty end,
                      (($r.failure // "") | capture("(^|; )(?<d>[A-Za-z0-9_./-]+) constraint gate")? | .d + "-constraints")]) as $c
           | {type: "verdict", rowId: $m.rowId, verdict: "wrong",
              why: ("auto [\($m.kind // "-")/\($m.route.model // ($r.models[0] // "-"))]: "
                    + ([if ($r.missing|length) > 0 then "expect missing: \($r.missing|join(", "))" else empty end,
                        if $gone then "GONE: child ended with no result (exit \($r.exit))" else empty end,
                        ($r.failure // empty)] | join("; "))),
              checks: $c, kind: $m.kind, model: ($m.route.model // $r.models[0]), ts: $ts, auto: true}') \
         || ! append_outcome "$line"; then
        printf 'farm: could not record the automatic verdict of row %s in %s\n' "$(printf '%s' "$meta" | jq -r '.rowId')" "$OUTCOMES" >&2
      fi
    fi
  fi
  printf '%s\n' "$result"
}

if [ -n "$TASKS" ]; then
  n=$(jq 'length' "$TASKS")
  # Three passes: validate every row, route every row, THEN run any. A refusal in row 9 must not
  # arrive after rows 0-8 are already spending, and a refused row never falls through to a default.
  declare -a ROW_W=() ROW_L=() ROW_P=() ROW_A=() ROW_M=() ROW_B=() ROW_S=() ROW_X=() ROW_PROV=() ROW_META=() ROW_ID=()
  RUN_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  RUN_RAND=$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n'); RUN_RAND=${RUN_RAND:-$RANDOM}
  # CDPATH empty: a relative --cwd matched through CDPATH makes cd print it, doubling the value.
  CWD_ABS=$(CDPATH='' cd -- "$CWD" && pwd) || CWD_ABS=$CWD
  lint_refused=0 lint_msgs=''
  for i in $(seq 0 $((n - 1))); do
    p=$(jq -r ".[$i].prompt" "$TASKS")
    [ "$p" != "null" ] || refuse "--tasks $TASKS: task $i has no string \"prompt\""
    l=$(jq -r ".[$i].label // \"task-$i\"" "$TASKS")
    a=$(jq -r ".[$i].agent // \"\"" "$TASKS"); [ "$a" = "null" ] && a=""
    m=$(jq -r ".[$i].model // \"\"" "$TASKS"); [ "$m" = "null" ] && m=""
    b=$(jq -r ".[$i].budget // \"$BUDGET\"" "$TASKS"); [ "$b" = "null" ] && b="$BUDGET"
    # enc() cannot save a newline: it would split the record, and a forged DONE line inside a
    # label is indistinguishable from a real verdict to every reader of this stream.
    #
    # Scoped to the fields that actually REACH the stream. Testing "$l$p$a" as one string
    # refused every multi-line prompt -- which is nearly every real brief -- and blamed the
    # label while doing it, sending the reader to inspect the wrong field. Measured
    # 2026-08-23: two live dispatches refused, both labels clean.
    case "$l" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        refuse "task $i label contains a control character; not allowed in the event stream" ;;
    esac
    case "$a" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        refuse "task $i agent contains a control character; not allowed in the event stream" ;;
    esac
    case "$m" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        refuse "task $i model contains a control character; not allowed in the event stream" ;;
    esac
    # Styling belongs to the child's rules (ds-rules A5/A6), never the brief: a brief that dictates
    # fonts, hex colours or an "X-style look" outranks them in the child's context and wins. Linted
    # here, with the rest of validation, so a refusal spends nothing. Row field "userStyle" (the
    # user's verbatim words) is the only override. Matcher: scripts/lib/brief-style-lint.ts.
    command -v bun >/dev/null || refuse "bun not on PATH: the brief style lint needs it"
    if ! lint_out=$(bun "$PLUGIN_ROOT/scripts/lib/brief-style-lint.ts" --row "$(jq -c ".[$i]" "$TASKS")" 2>&1); then
      lint_refused=$((lint_refused + 1)); lint_msgs+="farm: task $i ($l) refused by the brief style lint: $lint_out"$'\n'
    elif [ -n "$lint_out" ]; then
      printf 'farm: task %s (%s): %s\n' "$i" "$l" "$lint_out" >&2
    fi
    w=$(jq -r ".[$i].workflow // \"\"" "$TASKS"); [ "$w" = "null" ] && w=""
    case "$w" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        refuse "task $i workflow contains a control character; not allowed in the event stream" ;;
    esac
    row_workflow "$i" "$l" "$a" "$w"
    # "schema": a JSON Schema object, inline JSON text, or a path (relative paths against --cwd, like
    # expect). Resolved here so an unreadable one refuses the batch before any row spends.
    st=$(jq -r ".[$i].schema | type" "$TASKS")
    sch=""
    case "$st" in
      null) ;;
      object) sch=$(jq -c ".[$i].schema" "$TASKS") ;;
      string)
        sv=$(jq -r ".[$i].schema" "$TASKS")
        if [[ $sv == "{"* ]]; then
          sch=$(printf '%s' "$sv" | jq -ce 'select(type == "object")' 2>/dev/null) \
            || refuse "task $i: \"schema\" is not a JSON object"
        else
          case "$sv" in /*) sp=$sv ;; *) sp="$CWD/$sv" ;; esac
          sch=$(jq -ce 'select(type == "object")' "$sp" 2>/dev/null) \
            || refuse "task $i: \"schema\" $sv is not a readable file holding a JSON Schema object"
        fi ;;
      *) refuse "task $i: \"schema\" must be an object, inline JSON or a file path, not a $st" ;;
    esac
    if [ -n "$sch" ]; then
      ne=$(jq ".[$i].expect // [] | if type == \"array\" then length else 1 end" "$TASKS")
      [ "$ne" -le 1 ] || refuse "task $i: a \"schema\" row writes its structured value to ONE expect path, not $ne"
    fi
    # "sandbox": true or absent. Anything else is refused rather than read as one or the other.
    x=$(jq -r ".[$i].sandbox | if . == null then \"\" elif type == \"boolean\" then tostring else \"bad\" end" "$TASKS")
    [ "$x" != bad ] || refuse "task $i: \"sandbox\" must be true or false"
    if [ "$x" = true ]; then
      command -v bwrap >/dev/null && command -v nsenter >/dev/null \
        || refuse "task $i: \"sandbox\" needs bwrap and nsenter on PATH; refusing to run it unsandboxed"
    fi
    ROW_L[i]=$l ROW_P[i]=$p ROW_A[i]=$a ROW_M[i]=$m ROW_B[i]=$b ROW_S[i]=$sch ROW_X[i]=$x ROW_W[i]=$ROW_WF
    # Filesystem-safe and unique: run start, our pid, a random word, the row index.
    ROW_ID[i]="${RUN_STAMP}-$$-${RUN_RAND}-${i}"
  done
  [ "$lint_refused" -eq 0 ] || { printf '%s' "$lint_msgs" >&2; refuse "farm: $lint_refused of $n row(s) refused by the brief style lint; no row was run"; }

  # promptSha256/promptLength cover the RAW row prompt, read from the file rather than from $p
  # (command substitution strips trailing newlines). Length counts UTF-16 units, as route.ts's
  # Jev state does, so one row's two records agree.
  mapfile -t ROW_HASH < <(python3 -c '
import hashlib, json, sys
for r in json.load(open(sys.argv[1], encoding="utf-8")):
    p = r.get("prompt") if isinstance(r, dict) else None
    if not isinstance(p, str):
        p = "" if p is None else json.dumps(p, separators=(",", ":"))
    print(hashlib.sha256(p.encode("utf-8", "surrogatepass")).hexdigest(),
          len(p.encode("utf-16-le", "surrogatepass")) // 2)' "$TASKS")
  [ "${#ROW_HASH[@]}" -eq "$n" ] || refuse "--tasks $TASKS: could not hash the row prompts"

  rdir=$(mktemp -d -t farm-route.XXXXXX)
  if [ "$PROVIDER" = route ]; then
    command -v bun >/dev/null || { rm -rf -- "$rdir"; refuse "bun not on PATH: routing a row needs it (or pass --provider claude|codex|gemini)"; }
    ROUTE_TS="$PLUGIN_ROOT/scripts/lib/route.ts"
    [ -f "$ROUTE_TS" ] || { rm -rf -- "$rdir"; refuse "$ROUTE_TS: no such file"; }
    # In parallel: each route.ts makes at most one Jev call, capped at jev.timeoutSeconds, so the
    # routing pass costs one timeout, not one per row. The row reaches route.ts as ONE argv
    # element -- never through a shell string.
    declare -a RPID=()
    for i in $(seq 0 $((n - 1))); do
      bun "$ROUTE_TS" --row "$(jq -c ".[$i]" "$TASKS")" >"$rdir/$i.json" 2>"$rdir/$i.err" &
      RPID[i]=$!
    done
    refused=0 broken=0
    for i in $(seq 0 $((n - 1))); do
      wait "${RPID[i]}"; rrc=$?
      if [ "$rrc" -eq 0 ] && ! jq -e 'type == "object" and (.provider | type == "string")' "$rdir/$i.json" >/dev/null 2>&1; then
        printf 'route.ts exited 0 without a decision object\n' >>"$rdir/$i.err"; rrc=1
      fi
      case "$rrc" in
        0) ;;
        2) refused=$((refused + 1))
           { printf 'farm: task %s refused by route.ts:\n' "$i"; cat -- "$rdir/$i.err"; } >&2 ;;
        *) broken=$((broken + 1))
           { printf 'farm: route.ts failed on task %s (exit %s):\n' "$i" "$rrc"; cat -- "$rdir/$i.err"; } >&2 ;;
      esac
    done
    if [ "$refused" -gt 0 ]; then
      rm -rf -- "$rdir"; refuse "farm: $refused of $n row(s) refused; no row was run"
    fi
    if [ "$broken" -gt 0 ]; then
      rm -rf -- "$rdir"; printf 'farm: routing failed for %s of %s row(s); no row was run\n' "$broken" "$n" >&2; exit 1
    fi
  else
    # Legacy --provider: that wrapper for every row and the row's own model, exactly as before.
    for i in $(seq 0 $((n - 1))); do
      jq -c --argjson i "$i" --arg p "$PROVIDER" --arg m "${ROW_M[i]}" \
        '.[$i] | {provider: $p, model: (if $m == "" then null else $m end),
                  kind: ((if type == "object" then .kind else null end) | if type == "string" then . else null end),
                  candidate: null, source: "flag",
                  shadow: {unavailable: "--provider flag: route.ts was not consulted"}}' "$TASKS" >"$rdir/$i.json"
    done
  fi

  for i in $(seq 0 $((n - 1))); do
    prov=$(jq -r '.provider' "$rdir/$i.json")
    w="${WRAPPERS[$prov]:-}"
    [ -n "$w" ] || { rm -rf -- "$rdir"; refuse "task $i: provider '$prov' has no wrapper; use claude|codex|gemini"; }
    command -v "$w" >/dev/null || { rm -rf -- "$rdir"; refuse "$w not on PATH"; }
    mdl=$(jq -r '.model // ""' "$rdir/$i.json")
    case "$mdl" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        rm -rf -- "$rdir"; refuse "task $i: routed model contains a control character" ;;
    esac
    # Only Claude Code routes its shells through CLAUDE_CODE_SHELL_PREFIX; another wrapper's commands
    # would run unsandboxed on the real tree.
    [ "${ROW_X[i]}" != true ] || [ "$prov" = claude ] \
      || { rm -rf -- "$rdir"; refuse "task $i: \"sandbox\" needs provider claude (routed to $prov); refusing to run it unsandboxed"; }
    ROW_PROV[i]=$prov ROW_M[i]=$mdl
    read -r sha len <<<"${ROW_HASH[i]}"
    ROW_META[i]=$(jq -c --arg rowId "${ROW_ID[i]}" --arg label "${ROW_L[i]}" --arg sha "$sha" --argjson len "$len" \
      '{rowId: $rowId, label: $label, kind: .kind,
        route: {source: .source, provider: .provider, model: .model, candidate: .candidate},
        promptSha256: $sha, promptLength: $len}' "$rdir/$i.json") \
      || { rm -rf -- "$rdir"; refuse "task $i: could not read its routing decision"; }
  done
  rm -rf -- "$rdir"

  # --detach: hand the run to a relaunch of ourselves and return, so the watcher's wake on its DONE is
  # the run's ONE wake (a run_in_background caller is woken by the harness as well). Decided here, after
  # every refusal, so a refused run still fails in front of its caller; the relaunch re-validates and
  # re-routes, both cheap. It keeps CLAUDE_CODE_SESSION_ID and TMPDIR, so its events land where the
  # watcher reads, and the caller's own FARM_OUT_CHILD, so it runs exactly as a foreground call would.
  if [ "$DETACH" = 1 ]; then
    alive=0
    bash "$PLUGIN_ROOT/skills/work/scripts/farm-alive.sh" --watcher || alive=$?
    if [ "$alive" = 0 ]; then
      relaunch=()
      for a in "${ARGV[@]}"; do [ "$a" = --detach ] || relaunch+=("$a"); done
      dlog=$(mktemp "${TMPDIR:-/tmp}/farm-detach.XXXXXX") || { printf 'farm: --detach: could not create a log under %s\n' "${TMPDIR:-/tmp}" >&2; exit 1; }
      if [ -n "$CALLER_IS_CHILD" ]; then caller_env=(env FARM_OUT_CHILD="$CALLER_IS_CHILD"); else caller_env=(env -u FARM_OUT_CHILD); fi
      setsid nohup "${caller_env[@]}" bash "$PLUGIN_ROOT/skills/farm-out/scripts/farm.sh" "${relaunch[@]}" > "$dlog" 2>&1 < /dev/null &
      printf 'farm: detached; %s row(s) run in the background and the watcher wakes this session once, on the DONE. Log: %s\n' "$n" "$dlog"
      exit 0
    fi
    case "$alive" in
      2) why="no CLAUDE_CODE_SESSION_ID, so no session watcher can be named" ;;
      *) why="this session's watcher is not ticking (no fresh farm-events beacon), so only this command's own end reports the run" ;;
    esac
    printf 'farm: --detach ignored: %s; running in the foreground\n' "$why" >&2
  fi

  # Fan out. Each task writes its object to its own file so parallel writers
  # cannot interleave on stdout.
  dir=$(mktemp -d -t farm-out-fan.XXXXXX)
  for i in $(seq 0 $((n - 1))); do
    # The rowId is what --verdict takes; this line is where the caller learns it.
    printf 'farm: ROW %s %s\n' "${ROW_L[i]}" "${ROW_ID[i]}" >&2
    mapfile -t e < <(jq -r ".[$i].expect // [] | if type==\"array\" then .[] else . end" "$TASKS")
    FARM_ROW_WORKFLOW="${ROW_W[i]}" run_one "${ROW_L[i]}" "${ROW_P[i]}" "${ROW_A[i]}" "${ROW_M[i]}" "${ROW_B[i]}" "${FARM_MAX_TURNS:-250}" \
      "${ROW_PROV[i]}" "${ROW_META[i]}" "${ROW_S[i]}" "${ROW_X[i]}" "${e[@]:-}" > "$dir/$i.json" &
  done
  wait
  out=$(jq -s '.' "$dir"/*.json); rm -rf "$dir"
else
  # ------------------------------------------------------ the hourly heartbeat (--workflow only)
  #
  # THE WAKE is the watcher mod (hooks/watch/watcher.ts): it reads every run this session launches from
  # the farm-events stream and wakes the session on DONE and on a run that dies. THE CRON IS THE
  # BACKSTOP, on by default (--no-cron opts out): a cron fires in a resumed session even when no
  # session was running as the run finished. Same shape, interval knob and minute-7 offset as work-dispatch.sh, because it is one
  # heartbeat -- two env vars that can disagree about one cadence is a bug generator.
  #
  # --tasks prints nothing: a row is a STEP, the watcher mod already reports it, and an hourly clock
  # per row is a wake for nothing.
  #
  # PRINTED BEFORE THE RUN. --workflow has no foreground phase -- run_one blocks for the whole
  # 20-60 minutes -- so an instruction printed afterwards arrives when the thing it backstops is
  # already over. A caller that DETACHES us (setsid nohup ... > log) never sees it on either side;
  # that caller creates the cron itself at launch (farm-out/SKILL.md).
  # No watcher in this session (no fresh beacon): a cron is then the only wake. --no-cron stays the
  # caller's call -- work-round.sh passes it because work-dispatch.sh owns that run's one cron.
  watcher=0
  bash "${BASH_SOURCE[0]%/*}/../../work/scripts/farm-alive.sh" --watcher || watcher=$?
  if [ "$watcher" = 1 ] && [ "$CALLER_IS_CHILD" != 1 ]; then
    echo "⚠ wake: NO WATCHER IN THIS SESSION -- no fresh farm-events beacon, so Claude Code loaded no plugin mod here and only a cron wakes this session$([ "$CRON" = 1 ] || echo '; with --no-cron that cron must be the caller'\''s, or nothing wakes it'). Tell the user: /reload-plugins loads the mods."
  fi
  if [ "$CRON" = 1 ]; then
    cron_minutes=${WORK_LOOP_INTERVAL_MINUTES:-60}
    case "$cron_minutes" in ''|*[!0-9]*|0) cron_minutes=60 ;; esac
    # Minute 7 rather than 0 or 30: every fleet-wide "hourly" lands on the same instant otherwise.
    if [ "$cron_minutes" -lt 60 ]; then
      cron_expr="7-59/$cron_minutes * * * *"
    elif [ "$cron_minutes" -lt 120 ]; then
      cron_expr="7 * * * *"
    else
      cron_expr="7 */$(( cron_minutes / 60 )) * * *"
    fi
    # The run's own directory names it -- for a work dispatch that is the run id, which is what the
    # session needs to find its way back. The script name is the fallback when --out sits loose.
    cron_label=$(basename -- "$(dirname -- "$OUT")")
    case "$cron_label" in ''|.|/) cron_label=$(basename -- "$WORKFLOW" .js) ;; esac
    # A NUDGE, not the goal: everything else is already in the run dir and the args.
    cat <<CRONMSG

======================================================================
REQUIRED, THIS TURN: ARM THE HEARTBEAT POLL WITH THE CronCreate TOOL.
The watcher mod (/farm) is the primary wake; this cron is the backstop --
it fires even when no session was running as the run finished.
CronCreate is a model tool -- no shell, including this one, can call it.
Call it now, before your next action, with exactly:

  cron:      $cron_expr
  recurring: true
  durable:   false
  prompt:    and? (farm $cron_label)

Then say which job id it returned. If CronCreate is unavailable, say so
in one line rather than proceeding as though the poll were armed.
======================================================================
CRONMSG
  else
    echo "wake: --no-cron, so this run asks for no heartbeat cron -- the watcher mod wakes this session when it finishes or dies (/farm lists it). The hourly backstop is the caller's: work-dispatch.sh prints its own; a bare farm.sh call has none unless --no-cron is dropped."
  fi

  # The child calls the Workflow tool; we never run the script ourselves. The long
  # instruction is not padding: Workflow returns a task id IMMEDIATELY and keeps running
  # in the background, so a child that ends its turn there takes the whole run down.
  # Args never pass through the child model: retyped args garbled above ~30 KB (a 93 KB set
  # arrived as a string, a 32.8 KB one failed to parse). A script has no file access, so the
  # args ride as a JSON string literal in a generated wrapper that hands them to the real
  # script through workflow() -- the child calls the wrapper with no args at all.
  wf_script=$WORKFLOW wf_wrapper=""
  if [ -n "$ARGSFILE" ]; then
    wf_wrapper=$(mktemp -t farm-out.XXXXXX.workflow.js)
    { printf 'export const meta = { name: %s, description: %s }\n' \
        "$(basename -- "$WORKFLOW" .js | jq -Rj tojson)" "$(printf 'farm.sh: %s with args from %s' "$WORKFLOW" "$ARGSFILE" | jq -Rsj tojson)"
      printf 'return await workflow({ scriptPath: %s }, JSON.parse(%s))\n' \
        "$(printf '%s' "$WORKFLOW" | jq -Rsj tojson)" "$(jq -Rsj tojson < "$ARGSFILE")"
    } > "$wf_wrapper"
    wf_script=$wf_wrapper
  fi
  out=$(run_one workflow "Call the Workflow tool with scriptPath $wf_script and no args. Do not write your own script and do not pass any args.

CRITICAL — Workflow returns IMMEDIATELY with a task id and then keeps running in the background. If you end your turn at that point the session exits and the entire run is destroyed. You MUST NOT end your turn until the workflow has actually returned. It may take 20-60 minutes.
After calling Workflow, stay alive by polling: run \`sleep 120\` via Bash, then check whether it finished (ToolSearch for \"select:TaskList,TaskGet,TaskOutput\" and use those, or read the workflow transcript directory named in the Workflow result). Repeat for as long as it takes. Never emit a final text message while the workflow is still running.

When it returns, write the SCRIPT'S OWN RETURN VALUE to $OUT as a single JSON document using the Write tool — verbatim, no commentary, no summarising. The Workflow tool wraps it: the tool result is an envelope {summary, agentCount, logs, totalTokens, result, …} and the script's return value is the object under its \`result\` key. Write THAT object, unwrapped, as the whole document. Do not write the envelope, and do not add a \`result\` key of your own. If Workflow throws, write {\"error\": \"<exact error text>\"} to that same path. Do not retry with invented arguments." "" "" "$BUDGET" "${FARM_MAX_TURNS:-250}" "$PROVIDER" "" "" "" "${EXPECT[@]:-}" "$OUT")
  [ -z "$wf_wrapper" ] || rm -f -- "$wf_wrapper"
  # Non-empty is not structured: a child that wrote its summary would pass the artifact
  # check and hand prose to the caller as the workflow's return value.
  if printf '%s' "$out" | jq -e '.ok' >/dev/null 2>&1; then
    if ! jq -e 'type == "object"' "$OUT" >/dev/null 2>&1; then
      out=$(printf '%s' "$out" | jq --arg p "$OUT" '.ok=false | .missing=[$p + " (not a JSON object)"]')
    fi
  fi
fi

printf '%s\n' "$out"
failed=$(printf '%s' "$out" | jq -r 'if type=="array" then . else [.] end
                                     | map(select(.ok|not) | "\(.label) " + ([if (.missing|length) > 0 then "missing \(.missing|join(", "))" else empty end,
                                                                         (.failure // empty)] | if length > 0 then join("; ") else "failed" end))
                                     | join("; ")')
if [ -n "$failed" ]; then
  printf '\nUNVERIFIED: %s\n' "$failed" >&2
  exit 1
fi
