#!/usr/bin/env bash
# work-loop.sh — the continuation loop work-dispatch.sh used to PRINT, executed instead.
#
#   work-loop.sh --run-dir <dir> --plan <plan.md> --loops <N> [--provider claude|codex|gemini]
#
# One round is: wait for a verdict with a LIVENESS leg, adjudicate it, ask whether the run is
# converging, amend what is mechanically amendable, redispatch. The liveness leg is the point: a
# watcher without one polls forever after the dispatch dies, which is how an OOM kill went silent.
#
# exit 0  the gate passed
# exit 1  the dispatch died with no verdict — the run log is named
# exit 2  bad arguments, or work-result.sh refused the return
# exit 3  work-redispatch.sh refused the round (its Tier 1 gate)
# exit 5  converge-check.ts says NOT CONVERGING — halt rather than burn the cap on a broken brief
# exit 6  the loop cap was reached with the gate still failing
# exit 7  a plan defect escalates: fixing it means choosing scope, which is a human's call
#
# converge-check's exit 2 ("fewer than two readable result files") is KEEP GOING, never a halt:
# every round 1 returns it, so reading it as a halt would stop every run before it began.
#
# Env: WORK_LOOP_POLL overrides the poll interval in seconds (default 30; must be >= 1).
#      WORK_LOOP_SETTLE overrides the post-dispatch settle in seconds (default 2).
set -uo pipefail


SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

die() { printf 'work-loop: %s\n' "$1" >&2; exit 2; }

RUN_DIR=""; PLAN=""; LOOPS=""; PROVIDER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run-dir)  [ $# -ge 2 ] || die "--run-dir needs a value";  RUN_DIR=$2; shift 2 ;;
    --plan)     [ $# -ge 2 ] || die "--plan needs a value";     PLAN=$2;    shift 2 ;;
    --loops)    [ $# -ge 2 ] || die "--loops needs a value";    LOOPS=$2;   shift 2 ;;
    --provider) [ $# -ge 2 ] || die "--provider needs a value"; PROVIDER=$2; shift 2 ;;
    -h|--help)  sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$RUN_DIR" ] || die "--run-dir is required"
[ -n "$PLAN" ]    || die "--plan is required"
[ -n "$LOOPS" ]   || die "--loops is required"
# Digits only, the idiom compose-goal.sh uses: an unvalidated count reaching the arithmetic below
# is an unbounded loop over somebody's typo.
case "$LOOPS" in ''|*[!0-9]*) die "--loops must be a whole number, got: $LOOPS" ;; esac

POLL=${WORK_LOOP_POLL:-30}
case "$POLL" in ''|*[!0-9]*) die "WORK_LOOP_POLL must be a whole number of seconds, got: $POLL" ;; esac
# Zero is digits-only but not an interval: 'sleep 0' turns the wait into a spin that forks
# farm-alive.sh and realpath every iteration for the whole run.
[ "$POLL" -gt 0 ] || die "WORK_LOOP_POLL must be at least 1 second, got: $POLL"

# A detached runner registers in farm-events a moment AFTER its dispatcher returns, so a liveness
# check taken at that instant correctly reports no live run for a round that is perfectly healthy.
# work-dispatch.sh settles before its own check; every round here gets the same grace.
SETTLE=${WORK_LOOP_SETTLE:-2}
case "$SETTLE" in ''|*[!0-9]*) die "WORK_LOOP_SETTLE must be a whole number of seconds, got: $SETTLE" ;; esac

[ -d "$RUN_DIR" ] || die "run dir not found: $RUN_DIR"
# The plan is what work-redispatch.sh re-hashes and re-syncs, so a missing one is a round that
# cannot happen — refuse up front rather than after a wait.
[ -f "$PLAN" ] || die "plan not found: $PLAN"
ARGS="$RUN_DIR/args.json"
[ -f "$ARGS" ] || die "no args.json in $RUN_DIR — that directory is not a work run"

case "$PROVIDER" in ''|claude|codex|gemini) ;;
  *) die "--provider must be claude|codex|gemini, got: $PROVIDER" ;;
esac

RESULT="$RUN_DIR/result.json"

# The loop files itself in the session's farm-events stream, keyed on its own pid, so the watcher mod
# (hooks/watch/watcher.ts) can tell a loop that exited from one that was killed: loop.exit is written by
# the detaching wrapper only when the loop returns, and nothing else records the loop's pid. Its
# out= is loop.exit, never result.json, so farm-alive.sh never reads the loop as the round's runner.
enc() { local s=${1-}; s=${s//%/%25}; s=${s// /%20}; s=${s//$'\t'/%09}; s=${s//=/%3D}; printf '%s' "$s"; }
EVENT_DIR="${TMPDIR:-/tmp}/farm-events${CLAUDE_CODE_SESSION_ID:+/$CLAUDE_CODE_SESSION_ID}"
mkdir -p "$EVENT_DIR" 2>/dev/null || true
LOOP_EVENTS="$EVENT_DIR/$$.ndjson"
printf 'farm: START work-loop cwd=%s out=%s expect=1 t=%s\n' \
  "$(enc "$PWD")" "$(enc "$(realpath -m -- "$RUN_DIR/loop.exit")")" "$(date +%s)" >>"$LOOP_EVENTS" 2>/dev/null || true
trap 'printf "farm: DONE work-loop rc=%s\n" "$?" >>"$LOOP_EVENTS" 2>/dev/null || true' EXIT

# Round 1's log. Rounds 2..N get theirs from work-redispatch.sh, which writes run-<HHMMSS>.log.
LOG="$RUN_DIR/run.log"

# The death message is the only evidence left when a round dies, so it must name a log that is
# actually there: fall back to the newest run*.log in the run dir when the tracked one is missing.
round_log() {
  if [ -f "$LOG" ]; then printf '%s\n' "$LOG"; return; fi
  newest=$(ls -1t "$RUN_DIR"/run*.log 2>/dev/null | head -1)
  printf '%s\n' "${newest:-$LOG}"
}

# The selectors the next round is scoped from. work-result.sh prints the verdict and the score table
# and none of these, so a caller reading only its output cannot say WHAT failed.
#
# `routes` and `planFindings` are printed beside them because they are what the one-lens gate added and
# what the next round is actually NARROWED by: a route names the task that owns a failure the checks
# found, and a planFinding names an item NO task can fix — so a reader who sees only the three arrays
# cannot tell a round that will re-run T2 from one that work-redispatch.sh is about to refuse with
# "amend the plan". Both are printed on every FAIL, empty included.
selectors() {
  python3 - "$RESULT" <<'PY'
import json, sys

def names(v):
    out = []
    for x in v or []:
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict):
            out.append(str(x.get("name") or x.get("id") or x.get("key") or x))
        else:
            out.append(str(x))
    return ", ".join(out) or "(none)"

def routed(v):
    """A route or a plan-routed item, as `owner <- what failed`: the owner is the whole point."""
    out = []
    for x in v or []:
        if isinstance(x, dict):
            what = x.get("failure") or x.get("title") or x.get("id") or "(unlabelled)"
            owner = x.get("ownerTask") or "(no ownerTask)"
            out.append(f"{owner} <- {what}")
        else:
            out.append(str(x))
    return "; ".join(out) or "(none)"

def rule_verdicts(v):
    if not v: return "(none)"
    out = []
    for x in (v[:3] if isinstance(v, list) else []):
        if isinstance(x, dict):
            name = x.get("name") or "(unnamed)"
            score = x.get("score")
            out.append(f"{name}: {score}" if score is not None else name)
        else:
            out.append(str(x))
    res = "; ".join(out)
    if isinstance(v, list) and len(v) > 3:
        res += f" (and {len(v) - 3} more)"
    return res

try:
    r = json.load(open(sys.argv[1]))
except Exception as e:
    sys.stderr.write("work-loop: cannot read selectors out of the result: %s\n" % e)
    sys.exit(0)

print("  tasksThatFlagged:     " + names(r.get("tasksThatFlagged")))
print("  mechanicalThatFailed: " + names(r.get("mechanicalThatFailed")))
print("  rulesThatFailed:      " + names(r.get("rulesThatFailed")))
print("  ruleVerdicts:         " + rule_verdicts(r.get("ruleVerdicts")))
print("  lensesThatFlagged:    " + names(r.get("lensesThatFlagged")))
print("  routes:               " + routed(r.get("routes")))
print("  planFindings:         " + routed(r.get("planFindings")))
PY
}

# work-outcomes.ts appends to the farm outcomes file. Its exit code is deliberately discarded: the
# loop's exit code is the gate's verdict, and a bookkeeping failure must not change it.
record_outcomes() {
  local out orc
  out=$(bun "$SKILL/scripts/work-outcomes.ts" "$RUN_DIR" 2>&1)
  orc=$?
  [ -n "$out" ] && printf '%s\n' "$out"
  [ "$orc" -eq 0 ] || printf 'work-loop: work-outcomes.ts exited %s — round %s outcomes not recorded; continuing\n' "$orc" "$round" >&2
  return 0
}

round=1
while :; do
  echo "work-loop: round $round of $LOOPS — waiting on $RESULT"

  # Wait WITH a liveness leg. Order matters: the verdict is checked first, so a run that finished
  # between two polls is never reported dead. The grace covers only the registration window at the
  # start of a round; once the runner has been seen alive, or the window closes, a dead dispatch is
  # reported exactly as before — that report is the whole feature.
  grace=$SETTLE
  while :; do
    [ -s "$RESULT" ] && break
    if ! bash "$SKILL/scripts/farm-alive.sh" "$RESULT" > /dev/null 2>&1; then
      if [ "$grace" -gt 0 ]; then
        grace=$((grace - 1))
        sleep 1
        continue
      fi
      printf 'work-loop: dispatch died with no verdict — see %s\n' "$(round_log)" >&2
      exit 1
    fi
    grace=0
    sleep "$POLL"
  done

  bash "$SKILL/scripts/work-result.sh" "$RESULT"
  rc=$?
  # An accepted round (PASS or FAIL, never a refusal) records its per-task outcomes and automatic
  # labels BEFORE any exit below can end the loop. Advisory: a failure is logged, never propagated.
  case "$rc" in 0|1) record_outcomes ;; esac
  case "$rc" in
    0) echo "work-loop: PASS on round $round"; exit 0 ;;
    2) echo "work-loop: work-result.sh REFUSED the return — see its reasons above" >&2; exit 2 ;;
  esac

  echo "work-loop: FAIL on round $round"
  selectors

  # Convergence is a HALT, not advice: a round failing where its predecessor failed is evidence
  # about the BRIEF, and spending the remaining cap against it buys nothing. Exit 2 is "too short
  # to judge" and keeps going; only exit 1 stops the loop.
  conv=$(bun "$SKILL/scripts/converge-check.ts" "$RUN_DIR" 2>&1)
  crc=$?
  if [ "$crc" -eq 1 ]; then
    printf '%s\n' "$conv"
    echo "work-loop: halting on NOT CONVERGING rather than spending round $((round + 1))" >&2
    exit 5
  fi

  if [ "$round" -ge "$LOOPS" ]; then
    echo "work-loop: loop cap of $LOOPS reached with the gate still failing — handing to human review" >&2
    exit 6
  fi

  # Amend only what is mechanically decidable. Anything else is choosing scope, and the amender
  # says so with exit 7.
  amend=$(bash "$SKILL/scripts/work-amend.sh" --plan "$PLAN" --args "$ARGS" 2>&1)
  arc=$?
  if [ "$arc" -eq 7 ]; then
    printf '%s\n' "$amend"
    echo "work-loop: a plan defect escalates — a human settles it before another round" >&2
    exit 7
  fi
  if [ "$arc" -eq 0 ]; then
    applied=$(bash "$SKILL/scripts/work-amend.sh" --plan "$PLAN" --args "$ARGS" --apply 2>&1)
    aarc=$?
    printf '%s\n' "$applied"
    [ "$aarc" -eq 0 ] || { echo "work-loop: amendment failed (exit $aarc) — not redispatching" >&2; exit "$aarc"; }
  fi

  redispatch=("$PLAN" "$ARGS" --dispatch)
  [ -n "$PROVIDER" ] && redispatch+=(--provider "$PROVIDER")
  redispatched=$(bash "$SKILL/scripts/work-redispatch.sh" "${redispatch[@]}" 2>&1)
  rrc=$?
  printf '%s\n' "$redispatched"
  case "$rrc" in
    0) ;;
    4) echo "work-loop: work-redispatch.sh refused at its round cap — handing to human review" >&2; exit 6 ;;
    3) echo "work-loop: work-redispatch.sh refused the round at its Tier 1 gate" >&2; exit 3 ;;
    *) echo "work-loop: work-redispatch.sh exited $rrc — not continuing" >&2; exit "$rrc" ;;
  esac

  # This round's log, from the dispatcher that opened it: work-redispatch.sh names run-<HHMMSS>.log,
  # so a message still pointing at run.log would send the reader to round 1's output.
  next_log=$(printf '%s\n' "$redispatched" | sed -n 's/^dispatched, log: \(.*\) (provider: .*)$/\1/p' | tail -1)
  [ -n "$next_log" ] && LOG=$next_log

  # The settle work-dispatch.sh takes before its own liveness check: the runner has just been
  # detached and has not registered in farm-events yet.
  sleep "$SETTLE"

  round=$((round + 1))
done
