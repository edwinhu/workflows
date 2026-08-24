#!/usr/bin/env bash
# CLI runner: delegate to a CLIProxyAPI wrapper in a separate process.
#
# THIS IS THE ONLY RUNNER. It replaced an Agent-SDK runner that shelled the
# wrapper ONLY for `--settings-json`, harvested its env, then reimplemented the
# client that wrapper already is. That runner was deleted 2026-08-23; craft
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
#   farm.sh --tasks tasks.json --cwd /repo   # JSON array; one row or many, run in parallel
#   farm.sh --workflow /abs/wf.js --args /abs/args.json --out /abs/result.json
#   farm.sh --provider claude|codex|gemini
#
set -uo pipefail

declare -A WRAPPERS=( [claude]=claude-code [codex]=codex-code [gemini]=gemini-code )

# Without this, a delegated run will report success it never observed.
ANTI_SIM='

You MUST actually perform this work with real tool calls. Do not simulate, summarize, or claim any completion you did not observe. If you cannot do it, say so explicitly with the exact error text and stop.'

# Exit 2 is "you called me wrong" -- distinct from 1, "the delegation failed".
refuse() { printf '%s\n' "$*" >&2; exit 2; }

PROVIDER=claude CWD=$PWD TASKS= WORKFLOW= ARGSFILE= OUT= ; EXPECT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --provider) PROVIDER="${2:?--provider needs a value}"; shift 2 ;;
    --cwd)      CWD="${2:?--cwd needs a value}";           shift 2 ;;
    --tasks)    TASKS="${2:?--tasks needs a value}";       shift 2 ;;
    --expect)   EXPECT+=("${2:?--expect needs a value}");  shift 2 ;;
    --workflow) WORKFLOW="${2:?--workflow needs a value}"; shift 2 ;;
    --args)     ARGSFILE="${2:?--args needs a value}";     shift 2 ;;
    --out)      OUT="${2:?--out needs a value}";           shift 2 ;;
    *) refuse "unknown argument: $1" ;;
  esac
done

# All validation runs before the wrapper is touched: a refusal must not depend
# on the proxy being reachable.
WRAPPER="${WRAPPERS[$PROVIDER]:-}"
[ -n "$WRAPPER" ] || refuse "unknown provider $PROVIDER; use claude|codex|gemini"
command -v "$WRAPPER" >/dev/null || refuse "$WRAPPER not on PATH"
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
  # script, or implementerAgentType / verifierAgentType / reviewLenses[].agentType in a
  # craft args file. One top-level persona is the wrong shape: the point is `ds` to
  # implement and `ds-reviewer` or `Explore` to judge. (A sealed persona also has no
  # Workflow tool, so it could not dispatch one anyway.)
  # (no --agent flag exists; a workflow names its agents per leg via agentType)
elif [ -n "$ARGSFILE" ] || [ -n "$OUT" ]; then
  refuse "--args and --out apply only to --workflow"
fi
[ -z "$TASKS" ] || [ -f "$TASKS" ] || refuse "--tasks $TASKS: no such file"
[ -z "$TASKS" ] || jq -e 'type == "array"' "$TASKS" >/dev/null 2>&1 \
  || refuse "--tasks $TASKS must hold a JSON array of tasks"

# Exempts our own children from the main-thread-guard PreToolUse hook, which
# would otherwise deny the delegation this script exists to perform.
export FARM_OUT_CHILD=1

# Rule 1: the model's own summary is not evidence. Check the artifact.
# Empty counts as missing -- a created-but-unwritten file is not a result.
verify() {
  local missing=() abs
  for p in "$@"; do
    # Resolved against $CWD -- where the AGENT worked -- not ours. They are routinely different
    # (we are launched from wherever the caller sat, with --cwd pointing elsewhere), and a bare
    # test then checks a path that never existed and calls every artifact missing.
    case "$p" in /*) abs=$p ;; *) abs="$CWD/$p" ;; esac
    [ -s "$abs" ] || missing+=("$p")
  done
  printf '%s\n' "${missing[@]:-}"
}

# ---------------------------------------------------------------- the event stream
# Read by farm-alive.sh (craft's liveness check) and farm-monitor.sh. Keyed on $$ -- the shell
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

EVENT_DIR="${TMPDIR:-/tmp}/farm-events"
mkdir -p "$EVENT_DIR" 2>/dev/null || true
EVENTS="$EVENT_DIR/$$.ndjson"
emit() { printf 'farm: %s\n' "$*" >>"$EVENTS" 2>/dev/null || true; }

# Nothing else ever deletes these, and farm-alive.sh greps every file in the directory on each
# poll -- so without eviction the cost of one liveness check grows with every dispatch ever run
# on this machine. Drop only files whose pid is gone AND that are old enough to be no run anyone
# is still waiting on.
evict_stale_events() {
  local f pid
  shopt -s nullglob
  for f in "$EVENT_DIR"/*.ndjson; do
    [ "$f" = "$EVENTS" ] && continue
    [ -n "$(find "$f" -mmin +60 -print -quit 2>/dev/null)" ] || continue
    pid=$(basename "$f" .ndjson)
    case "$pid" in ''|*[!0-9]*) rm -f -- "$f"; continue ;; esac
    kill -0 "$pid" 2>/dev/null || rm -f -- "$f"
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
run_one() {
  local label="$1" prompt="$2" agent="$3"; shift 3
  local expects=("$@") log err rc text calls models missing stderr_tail
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
  if [ "${#real_expects[@]}" -gt 0 ]; then
    prompt+="

Write your deliverable to EXACTLY this path, literally as written, creating parent directories if needed. Do not choose a different location, and do not add a suffix, timestamp or extension:"
    for _e in "${real_expects[@]}"; do prompt+="
  ${_e}"
    done
  fi

  emit "START $(enc "$label") cwd=$(enc "$CWD") out=$(enc "${OUT:-}") expect=${#real_expects[@]}"
  for _e in "${real_expects[@]:-}"; do [ -n "$_e" ] && claim "$label" "$_e"; done
  [ -n "${OUT:-}" ] && claim "$label" "$OUT"

  local -a cmd=("$WRAPPER" -p "${prompt}${ANTI_SIM}" --output-format stream-json --verbose)
  [ -n "$agent" ] && cmd+=(--agent "$agent")
  # Keep stderr: a provider that dies (proxy down, model rejected, auth stale) writes
  # there and nowhere else, and discarding it leaves only a bare exit code to debug.
  ( cd "$CWD" && "${cmd[@]}" ) > "$log" 2>"$err"
  rc=$?
  stderr_tail=$(rg -Nv "^mise " "$err" 2>/dev/null | tail -5)

  text=$(jq -rs '[.[] | select(.type=="result") | .result] | last // ""' "$log" 2>/dev/null)
  calls=$(jq -s '[.[] | select(.type=="assistant") | .message.content[]?
                 | select(.type=="tool_use")] | length' "$log" 2>/dev/null || echo 0)
  models=$(jq -sc '[.[] | select(.type=="assistant") | .message.model] | unique' "$log" 2>/dev/null || echo '[]')
  mapfile -t missing < <(verify "${expects[@]:-}")
  # verify prints one blank line when nothing is missing; drop it.
  [ "${#missing[@]}" -eq 1 ] && [ -z "${missing[0]}" ] && missing=()
  rm -f "$log" "$err"

  # The same verdict the caller gets: exit 0 AND every promised artifact present. A run that
  # exits 0 having dropped its deliverable is a failure, and DONE-on-rc-alone would call it ok.
  if [ "$rc" -eq 0 ] && [ "${#missing[@]}" -eq 0 ]; then
    emit "DONE $(enc "$label") ok toolCalls=${calls:-0}"
  else
    emit "DONE $(enc "$label") fail rc=$rc missing=${#missing[@]} toolCalls=${calls:-0}"
  fi

  jq -n --arg label "$label" --arg result "$text" --argjson toolCalls "${calls:-0}" \
        --argjson models "${models:-[]}" --argjson exit "$rc" \
        --arg stderr "$stderr_tail" \
        --argjson missing "$(printf '%s\n' "${missing[@]:-}" | jq -Rsc 'split("\n") | map(select(length>0))')" \
    '{label:$label, ok: ($missing|length)==0 and $exit==0, exit:$exit,
      toolCalls:$toolCalls, models:$models, missing:$missing, result:$result}
     + (if $exit != 0 and ($stderr|length) > 0 then {stderr:$stderr} else {} end)'
}

if [ -n "$TASKS" ]; then
  # Fan out. Each task writes its object to its own file so parallel writers
  # cannot interleave on stdout.
  dir=$(mktemp -d -t farm-out-fan.XXXXXX)
  n=$(jq 'length' "$TASKS")
  for i in $(seq 0 $((n - 1))); do
    p=$(jq -r ".[$i].prompt" "$TASKS")
    [ "$p" != "null" ] || refuse "--tasks $TASKS: task $i has no string \"prompt\""
    l=$(jq -r ".[$i].label // \"task-$i\"" "$TASKS")
    a=$(jq -r ".[$i].agent // \"\"" "$TASKS"); [ "$a" = "null" ] && a=""
    # enc() cannot save a newline: it would split the record, and a forged DONE line inside a
    # label is indistinguishable from a real verdict to every reader of this stream.
    case "$l$p$a" in
      *[$'\n\r\t']*|*[$'\001'-$'\010']*)
        refuse "task $i label contains a control character; not allowed in the event stream" ;;
    esac
    mapfile -t e < <(jq -r ".[$i].expect // [] | if type==\"array\" then .[] else . end" "$TASKS")
    run_one "$l" "$p" "$a" "${e[@]:-}" > "$dir/$i.json" &
  done
  wait
  out=$(jq -s '.' "$dir"/*.json); rm -rf "$dir"
else
  # The child calls the Workflow tool; we never run the script ourselves. The long
  # instruction is not padding: Workflow returns a task id IMMEDIATELY and keeps running
  # in the background, so a child that ends its turn there takes the whole run down.
  wf_args="no args"
  [ -n "$ARGSFILE" ] && wf_args="exactly these args:
$(cat "$ARGSFILE")"
  out=$(run_one workflow "Call the Workflow tool with scriptPath $WORKFLOW and ${wf_args}. Do not write your own script and do not alter the args.

CRITICAL — Workflow returns IMMEDIATELY with a task id and then keeps running in the background. If you end your turn at that point the session exits and the entire run is destroyed. You MUST NOT end your turn until the workflow has actually returned. It may take 20-60 minutes.
After calling Workflow, stay alive by polling: run \`sleep 120\` via Bash, then check whether it finished (ToolSearch for \"select:TaskList,TaskGet,TaskOutput\" and use those, or read the workflow transcript directory named in the Workflow result). Repeat for as long as it takes. Never emit a final text message while the workflow is still running.

When it returns, write the returned object to $OUT as a single JSON document using the Write tool — verbatim, no commentary, no summarising. If Workflow throws, write {\"error\": \"<exact error text>\"} to that same path. Do not retry with invented arguments." "" "${EXPECT[@]:-}" "$OUT")
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
                                     | map(select(.ok|not) | "\(.label) missing \(.missing|join(", "))")
                                     | join("; ")')
if [ -n "$failed" ]; then
  printf '\nUNVERIFIED: %s\n' "$failed" >&2
  exit 1
fi
