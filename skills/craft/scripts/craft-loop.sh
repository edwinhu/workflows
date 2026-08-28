#!/usr/bin/env bash
# craft-loop.sh — the continuation loop craft-dispatch.sh used to PRINT, executed instead.
#
#   craft-loop.sh --run-dir <dir> --plan <plan.md> --loops <N> [--provider claude|codex|gemini]
#
# One round is: wait for a verdict with a LIVENESS leg, adjudicate it, ask whether the run is
# converging, amend what is mechanically amendable, redispatch. The liveness leg is the point: a
# watcher without one polls forever after the dispatch dies, which is how an OOM kill went silent.
#
# exit 0  the gate passed
# exit 1  the dispatch died with no verdict — the run log is named
# exit 2  bad arguments, or craft-result.sh refused the return
# exit 3  craft-redispatch.sh refused the round (its Tier 1 gate)
# exit 5  converge-check.ts says NOT CONVERGING — halt rather than burn the cap on a broken brief
# exit 6  the loop cap was reached with the gate still failing
# exit 7  a plan defect escalates: fixing it means choosing scope, which is a human's call
#
# converge-check's exit 2 ("fewer than two readable result files") is KEEP GOING, never a halt:
# every round 1 returns it, so reading it as a halt would stop every run before it began.
#
# Env: CRAFT_LOOP_POLL overrides the poll interval in seconds (default 30; must be >= 1).
#      CRAFT_LOOP_SETTLE overrides the post-dispatch settle in seconds (default 2).
set -uo pipefail

SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

die() { printf 'craft-loop: %s\n' "$1" >&2; exit 2; }

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

POLL=${CRAFT_LOOP_POLL:-30}
case "$POLL" in ''|*[!0-9]*) die "CRAFT_LOOP_POLL must be a whole number of seconds, got: $POLL" ;; esac
# Zero is digits-only but not an interval: 'sleep 0' turns the wait into a spin that forks
# farm-alive.sh and realpath every iteration for the whole run.
[ "$POLL" -gt 0 ] || die "CRAFT_LOOP_POLL must be at least 1 second, got: $POLL"

# A detached runner registers in farm-events a moment AFTER its dispatcher returns, so a liveness
# check taken at that instant correctly reports no live run for a round that is perfectly healthy.
# craft-dispatch.sh settles before its own check; every round here gets the same grace.
SETTLE=${CRAFT_LOOP_SETTLE:-2}
case "$SETTLE" in ''|*[!0-9]*) die "CRAFT_LOOP_SETTLE must be a whole number of seconds, got: $SETTLE" ;; esac

[ -d "$RUN_DIR" ] || die "run dir not found: $RUN_DIR"
# The plan is what craft-redispatch.sh re-hashes and re-syncs, so a missing one is a round that
# cannot happen — refuse up front rather than after a wait.
[ -f "$PLAN" ] || die "plan not found: $PLAN"
ARGS="$RUN_DIR/args.json"
[ -f "$ARGS" ] || die "no args.json in $RUN_DIR — that directory is not a craft run"

case "$PROVIDER" in ''|claude|codex|gemini) ;;
  *) die "--provider must be claude|codex|gemini, got: $PROVIDER" ;;
esac

RESULT="$RUN_DIR/result.json"
# Round 1's log. Rounds 2..N get theirs from craft-redispatch.sh, which writes run-<HHMMSS>.log.
LOG="$RUN_DIR/run.log"

# The death message is the only evidence left when a round dies, so it must name a log that is
# actually there: fall back to the newest run*.log in the run dir when the tracked one is missing.
round_log() {
  if [ -f "$LOG" ]; then printf '%s\n' "$LOG"; return; fi
  newest=$(ls -1t "$RUN_DIR"/run*.log 2>/dev/null | head -1)
  printf '%s\n' "${newest:-$LOG}"
}

# The three selectors the next round is scoped from. craft-result.sh prints the verdict and the
# score table and none of these, so a caller reading only its output cannot say WHAT failed.
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

try:
    r = json.load(open(sys.argv[1]))
except Exception as e:
    sys.stderr.write("craft-loop: cannot read selectors out of the result: %s\n" % e)
    sys.exit(0)

print("  tasksThatFlagged:     " + names(r.get("tasksThatFlagged")))
print("  mechanicalThatFailed: " + names(r.get("mechanicalThatFailed")))
print("  lensesThatFlagged:    " + names(r.get("lensesThatFlagged")))
PY
}

round=1
while :; do
  echo "craft-loop: round $round of $LOOPS — waiting on $RESULT"

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
      printf 'craft-loop: dispatch died with no verdict — see %s\n' "$(round_log)" >&2
      exit 1
    fi
    grace=0
    sleep "$POLL"
  done

  bash "$SKILL/scripts/craft-result.sh" "$RESULT"
  rc=$?
  case "$rc" in
    0) echo "craft-loop: PASS on round $round"; exit 0 ;;
    2) echo "craft-loop: craft-result.sh REFUSED the return — see its reasons above" >&2; exit 2 ;;
  esac

  echo "craft-loop: FAIL on round $round"
  selectors

  # Convergence is a HALT, not advice: a round failing where its predecessor failed is evidence
  # about the BRIEF, and spending the remaining cap against it buys nothing. Exit 2 is "too short
  # to judge" and keeps going; only exit 1 stops the loop.
  conv=$(bun "$SKILL/scripts/converge-check.ts" "$RUN_DIR" 2>&1)
  crc=$?
  if [ "$crc" -eq 1 ]; then
    printf '%s\n' "$conv"
    echo "craft-loop: halting on NOT CONVERGING rather than spending round $((round + 1))" >&2
    exit 5
  fi

  if [ "$round" -ge "$LOOPS" ]; then
    echo "craft-loop: loop cap of $LOOPS reached with the gate still failing — handing to human review" >&2
    exit 6
  fi

  # Amend only what is mechanically decidable. Anything else is choosing scope, and the amender
  # says so with exit 7.
  amend=$(bash "$SKILL/scripts/craft-amend.sh" --plan "$PLAN" --args "$ARGS" 2>&1)
  arc=$?
  if [ "$arc" -eq 7 ]; then
    printf '%s\n' "$amend"
    echo "craft-loop: a plan defect escalates — a human settles it before another round" >&2
    exit 7
  fi
  if [ "$arc" -eq 0 ]; then
    applied=$(bash "$SKILL/scripts/craft-amend.sh" --plan "$PLAN" --args "$ARGS" --apply 2>&1)
    aarc=$?
    printf '%s\n' "$applied"
    [ "$aarc" -eq 0 ] || { echo "craft-loop: amendment failed (exit $aarc) — not redispatching" >&2; exit "$aarc"; }
  fi

  redispatch=("$PLAN" "$ARGS" --dispatch)
  [ -n "$PROVIDER" ] && redispatch+=(--provider "$PROVIDER")
  redispatched=$(bash "$SKILL/scripts/craft-redispatch.sh" "${redispatch[@]}" 2>&1)
  rrc=$?
  printf '%s\n' "$redispatched"
  case "$rrc" in
    0) ;;
    4) echo "craft-loop: craft-redispatch.sh refused at its round cap — handing to human review" >&2; exit 6 ;;
    3) echo "craft-loop: craft-redispatch.sh refused the round at its Tier 1 gate" >&2; exit 3 ;;
    *) echo "craft-loop: craft-redispatch.sh exited $rrc — not continuing" >&2; exit "$rrc" ;;
  esac

  # This round's log, from the dispatcher that opened it: craft-redispatch.sh names run-<HHMMSS>.log,
  # so a message still pointing at run.log would send the reader to round 1's output.
  next_log=$(printf '%s\n' "$redispatched" | sed -n 's/^dispatched, log: \(.*\) (provider: .*)$/\1/p' | tail -1)
  [ -n "$next_log" ] && LOG=$next_log

  # The settle craft-dispatch.sh takes before its own liveness check: the runner has just been
  # detached and has not registered in farm-events yet.
  sleep "$SETTLE"

  round=$((round + 1))
done
