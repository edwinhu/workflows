#!/usr/bin/env bash
# Arm the until Stop hook on THIS session: hold the turn until a command exits 0.
#
# No transport: a state file is written here and read by hooks/work-hold.ts on every Stop. Anything
# that has to be TYPED into the session instead needs the pane idle, and a session working
# back-to-back never goes idle, so it never lands.
#
#   work-hold.sh '<check command>' [--goal '<objective>'] [--run DIR] [--rounds N] [--minutes M]
#   work-hold.sh --goal '<objective>' [--run DIR] [--rounds N] [--minutes M]
#   work-hold.sh --status | --disarm
#
# The SECOND form is CHECK-LESS: the judge alone on the goal. A plan that states no computable goal
# check still needs a hold, and inventing one would be a check nobody wrote. The arm-time refusals
# (already green, could-not-run) are runtime facts about a command and are skipped there; hold-lint
# still runs on the goal text.
#
# --run DIR is the work run this hold watches. While that run is in flight (args.json with no
# non-empty result.json) the hook ALLOWS the stop and counts no round.
#
# Every red Stop counts a round and blocks. A hold is for SHORT work this session drives; a long
# unattended loop with a computable target belongs to grind, which gets fresh context per iteration.
#
# Exit 0 armed, 2 usage or no session id.
set -uo pipefail

SID="${CLAUDE_CODE_SESSION_ID-}"
[ -n "$SID" ] || { echo "work-hold: no CLAUDE_CODE_SESSION_ID — cannot arm a session-scoped hold" >&2; exit 2; }
STATE="${TMPDIR:-/tmp}/work-hold-$SID.json"
HOOK="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)/hooks/work-hold.ts"

case "${1-}" in
  --status)
    # A FEW LABELLED LINES. This used to `cat` the state and then every ledger line ever written for
    # the session, each carrying the whole armed JSON -- dozens of lines in which the hold's actual
    # position was the hardest thing to find.
    [ -f "$STATE" ] || { echo "hold: not armed"; exit 0; }
    python3 - "$STATE" "${STATE%.json}.releases.log" <<'PY'
import json, os, sys, time
state, log = sys.argv[1], sys.argv[2]
try:
    s = json.load(open(state))
except Exception:
    print(f"hold: ARMED — state unreadable ({state})"); raise SystemExit(0)

left = int(s.get("ceilingMinutes", 0)) - int((time.time() - s.get("startedAt", 0)) // 60)
print("hold: ARMED")
print(f"  check:   {s.get('check') or '(none — the judge alone on the goal)'}")
if s.get("goal"):
    print(f"  goal:    {s['goal']}")
if s.get("run"):
    run = s["run"]
    res = os.path.join(run, "result.json")
    flight = "in flight" if (os.path.exists(os.path.join(run, "args.json"))
                             and not (os.path.exists(res) and os.path.getsize(res) > 0)) else "not in flight"
    print(f"  run:     {run} ({flight})")
print(f"  rounds:  {s.get('rounds',0)} of {s.get('maxRounds','?')} used")
print(f"  minutes: {left} left of {s.get('ceilingMinutes','?')}")
rounds = (s.get("history") or [])[-3:]
if rounds:
    print("  last:    " + "; ".join(f"round {h['round']} exit {h['exit']}" for h in rounds))

def check_of(verb, payload):
    payload = payload.strip()
    if verb in ("armed", "capped") and payload.startswith("{"):
        try:
            d = json.loads(payload)
            return d.get("check") or d.get("path") or ""
        except Exception:
            return ""
    return payload

try:
    lines = [l for l in open(log).read().split("\n") if l.strip()]
except OSError:
    lines = []
if lines:
    print("  ledger (last 5):")
    for l in lines[-5:]:
        f = (l.split("\t") + ["", ""])[:3]
        print(f"    {f[0]}  {f[1]}  {check_of(f[1].strip(), f[2])}".rstrip())
PY
    echo "  state:   $STATE (Read tool only — a Bash command naming it prompts the user)"
    exit 0 ;;
  --disarm)
    # RELEASE IS THE USER'S, NOT THE SESSION'S. The arm-time guards refuse a check that is already
    # green or cannot run, because a session will rationalise; then release was left to the same
    # judgment, and "this gate measures the wrong property" is equally available to a session that
    # simply finds the gate hard. Measured 2026-09-21: one session released itself twice in an
    # evening, each time with a reason it believed.
    #
    # An env flag would not hold -- a session runs this in a shell and can set one. A confirmation
    # read from /dev/tty can only be answered by a human at a terminal, so this fails closed for an
    # agent and stays one keystroke for the user. Every attempt is logged either way.
    LOG="${STATE%.json}.releases.log"
    if [ ! -f "$STATE" ]; then echo "hold: not armed"; exit 0; fi
    if [ ! -r /dev/tty ] || [ ! -t 0 ] && ! { exec 3</dev/tty; } 2>/dev/null; then
      printf '%s\trefused (no tty)\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
      echo "work-hold: --disarm needs the USER to confirm at a terminal, and there is none here." >&2
      echo "  The hold is not yours to release: ask the user, or arm a different check instead." >&2
      echo "  A gate that measures the wrong property is replaced by arming the right one, not by stopping." >&2
      exit 2
    fi
    exec 3</dev/tty
    printf 'hold: release the hold on `%s`? [y/N] ' "$(jq -r .check "$STATE" 2>/dev/null)" > /dev/tty
    read -r ans <&3 || ans=""
    exec 3<&-
    case "$ans" in
      y|Y|yes|YES)
        printf '%s\treleased by user\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        # Restore the window BEFORE the state file goes: the cap record lives in it.
        [ -r "$HOOK" ] && command -v bun >/dev/null 2>&1 && bun "$HOOK" --uncap
        rm -f "$STATE"; echo "hold: disarmed (user confirmed)"; exit 0 ;;
      *)
        printf '%s\tdeclined\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        echo "hold: still armed"; exit 2 ;;
    esac ;;
  # A leading --goal is the CHECK-LESS form. Every other leading flag is still a usage error, so a
  # typo cannot silently arm a hold with no check.
  --goal) ;;
  "" | -*)
    echo "usage: work-hold.sh '<check command>' [--goal '<objective>'] [--run DIR] [--rounds N] [--minutes M]" >&2
    echo "       work-hold.sh --goal '<objective>' [--run DIR] [--rounds N] [--minutes M]   (check-less)" >&2
    echo "       work-hold.sh --status | --disarm" >&2
    exit 2 ;;
esac

CHECK=""
case "${1-}" in --goal) ;; *) CHECK="$1"; shift ;; esac
ROUNDS=4; MINUTES=120
GOAL=""; RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --goal)    GOAL="${2-}"; shift 2 ;;
    --run)     RUN="${2-}"; shift 2 ;;
    --rounds)  ROUNDS="${2-}"; shift 2 ;;
    --minutes) MINUTES="${2-}"; shift 2 ;;
    *) echo "work-hold: unknown flag $1" >&2; exit 2 ;;
  esac
done

if [ -z "$CHECK" ] && [ -z "$GOAL" ]; then
  echo "work-hold: a check-less hold is the judge alone on --goal, so --goal is required. Not armed." >&2
  exit 2
fi

RC=0
if [ -n "$CHECK" ]; then
  # REFUSE A CHECK THAT ALREADY PASSES. Arming on a met objective holds nothing and teaches the
  # session that the hold is noise; arming on one that cannot RUN (exit 2, 127) would hold it
  # forever on a broken command. Both are facts about a COMMAND, so neither applies check-less.
  OUT=$(bash -lc "$CHECK" 2>&1); RC=$?
  if [ "$RC" -eq 0 ]; then
    echo "work-hold: that check ALREADY exits 0 — nothing to hold. Not armed." >&2; exit 2
  fi
  if [ "$RC" -gt 1 ]; then
    echo "work-hold: that check exits $RC, which is could-not-run rather than a verdict." >&2
    printf '%s\n' "$OUT" | tail -3 >&2
    echo "work-hold: fix the command first. Not armed." >&2; exit 2
  fi
fi

# PIN THE RUBRIC, NOT JUST THE COMMAND. The hold records the check STRING, and the session is the
# one that authored the script that string invokes -- so the objective can be edited until it
# passes while the armed command never changes and the state file stays satisfied. Observed
# 2026-09-22: a gate was red, its script was rewritten, and it went green with the hold none the
# wiser. Hashing the files the check names turns that from invisible into recorded; it does not
# forbid it, because a genuinely broken instrument does need fixing mid-hold.
# COMPOSE THE CLAUSES, do not leave them to the caller. compose-goal.sh did this, and its comments
# record why each one exists: without CONTINUATION a run "stops at its FIRST stopping point rather
# than its ceiling", which is "the whole difference between a session that spends its budget and one
# that reports a verdict and goes quiet with hours left". Those clauses lived in the goal because
# the goal was "the one text it re-reads every turn" -- and in the hold that text is its block
# message, which carried none of them.
AUTHORITY_CLAUSE='You may decide alone, without asking: which finding to fix first, whether to commit what is green (explicit paths, never push), and what to pick up next.'
# shellcheck source=../../../lib/goal-clauses.sh
_clauses="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)/lib/goal-clauses.sh"
# shellcheck disable=SC1090
[ -r "$_clauses" ] && . "$_clauses"
# A FALLBACK, because this also runs from the DEPLOYED plugin copy, which may not carry
# lib/. Verified the hazard rather than assumed it: with lib/ hidden the clause silently
# lost its tail and still read plausibly -- exactly the drift this extraction exists to
# prevent, reintroduced as a packaging bug.
: "${GOAL_CONTINUATION_TAIL:=When the stated scope closes and budget remains, pick the largest open item you found while working, say in one line why you picked it, and start it. Report at the ceiling, not at the first stopping point.}"

# The opening depends on what this hold actually has: a check-less hold has no check to fail, and
# telling the session a failing check is not a stopping point names an instrument that does not exist.
if [ -n "$CHECK" ]; then
  CONTINUATION_CLAUSE="A failing check is not a stopping point: fix it and re-run in the same turn. $GOAL_CONTINUATION_TAIL"
else
  CONTINUATION_CLAUSE="An unmet goal is not a stopping point: take the next action in the same turn. $GOAL_CONTINUATION_TAIL"
fi

python3 - "$STATE" "$CHECK" "$ROUNDS" "$MINUTES" "${GOAL:-}" "$AUTHORITY_CLAUSE" "$CONTINUATION_CLAUSE" "${RUN:-}" <<'PY'
import hashlib, json, os, re, sys, time
path, check, rounds, minutes = sys.argv[1:5]
goal = sys.argv[5] if len(sys.argv) > 5 else ""
authority = sys.argv[6] if len(sys.argv) > 6 else ""
continuation = sys.argv[7] if len(sys.argv) > 7 else ""
run = sys.argv[8] if len(sys.argv) > 8 else ""

def digest(f):
    try:
        return hashlib.sha256(open(f, "rb").read()).hexdigest()[:16]
    except OSError:
        return None

files = {}
for tok in re.findall(r"[\w./~-]+", check):
    f = os.path.expanduser(tok)
    if os.path.isfile(f):
        d = digest(f)
        if d:
            files[os.path.abspath(f)] = d

state = {"check": check, "startedAt": int(time.time()),
         "ceilingMinutes": int(minutes), "maxRounds": int(rounds), "rounds": 0,
         "checkFiles": files, "goal": goal,
         "authority": authority, "continuation": continuation}
# Absolute, because the hook runs from whatever cwd the Stop happens in.
if run:
    state["run"] = os.path.abspath(os.path.expanduser(run))
json.dump(state, open(path, "w"))
print(f"  rubric: {len(files)} file(s) pinned by content", file=sys.stderr)
PY
# LINT THE CHECK AS A SPECIFICATION, not just as a runtime fact. The two refusals above are
# behavioural (green, or could-not-run); these are the rules SKILL.md states and nothing enforced
# until 2026-09-21, when two gates passed arm-time validation and were still mis-specified.
# A critical refuses; anything else is printed and armed anyway, because "the gate measures the
# wrong property" is judgment and stays the session's problem.
LINT="$(dirname "$(readlink -f "$0")")/hold-lint.ts"
if [ -r "$LINT" ] && command -v bun >/dev/null 2>&1; then
  # The GOAL is linted with the check, not separately: the two together are the objective, and the
  # milestone/human-dependency/turn-count rules bite on whichever of them states it.
  if [ -z "$CHECK" ]; then
    LINT_OUT=$(bun "$LINT" --goal "$GOAL" 2>&1); LINT_RC=$?
  elif [ -n "$GOAL" ]; then
    LINT_OUT=$(bun "$LINT" "$CHECK" --goal "$GOAL" 2>&1); LINT_RC=$?
  else
    LINT_OUT=$(bun "$LINT" "$CHECK" 2>&1); LINT_RC=$?
  fi
  if [ "$LINT_RC" -eq 1 ]; then
    printf '%s\n' "$LINT_OUT"
    if printf '%s' "$LINT_OUT" | grep -q "^CRITICAL"; then
      # "Not armed" has to be TRUE on disk. The state file is written above (the rubric has to be
      # pinned from the same parse), and leaving it behind on a refusal arms the hold anyway: the
      # Stop hook reads the file, not this exit code. No ledger line exists yet, so nothing restores it.
      rm -f "$STATE"
      echo "work-hold: fix the critical finding(s) above first. Not armed." >&2
      exit 2
    fi
  fi
fi

# WARN ON A LONG HOLD, and hand over the command that replaces it. Every heartbeat tick re-enters
# this session's WHOLE context, so a hold whose ceiling is hours is paying that on every wake; grind
# runs a fresh process per iteration on the same check. Printed, never refused: the ceilings are the
# user's to set, and the ask here is that the cheaper mechanism be visible at the moment of choosing.
#
# SILENT WITH --run. That is work-dispatch.sh arming over a dispatched run, whose ceilings come from
# compose-goal.sh (720 minutes) rather than from anyone choosing them — so the warning fired on every
# routine dispatch, and grind is not the alternative to a run that is already detached. The advice is
# for a hand-armed long hold, which is what is left when --run is absent.
case "$MINUTES$ROUNDS" in *[!0-9]*) ;; *)
  if [ -z "$RUN" ] && { [ "$MINUTES" -gt 120 ] || [ "$ROUNDS" -gt 4 ]; }; then
    GRIND="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)/skills/grind/scripts/grind.sh"
    {
      echo "WARNING: this is a LONG hold ($ROUNDS rounds / $MINUTES minutes; the defaults are 4 and 120)."
      echo "  Every wake re-enters THIS session's whole context — the plan, the run dir, the"
      echo "  transcript — so a long hold pays that on every one. A long loop with a computable target"
      echo "  belongs to grind, which gets a fresh process per iteration and keeps nothing between them:"
      if [ -n "$CHECK" ]; then
        # Single-quote the check the way SKILL.md documents, escaping any apostrophe that slipped past
        # hold-lint rather than trusting the rule that forbids one.
        Q="'${CHECK//\'/\'\\\'\'}'"
        echo ""
        echo "  setsid nohup bash $GRIND run --journal $PWD/grind.jsonl --prompt-file $PWD/PROMPT.md --check $Q --max-iters $ROUNDS >grind.log 2>&1 </dev/null &"
      else
        echo "  (this hold is check-less, so grind has nothing to gate on — state a check first, which"
        echo "   in a work plan is args.goalCheck)"
      fi
      echo ""
      echo "  Arming anyway."
    } >&2
  fi ;;
esac

if [ -n "$CHECK" ]; then
  echo "hold: ARMED on \`$CHECK\` (currently exits $RC)"
else
  echo "hold: ARMED check-less — the judge alone on the goal"
fi
echo "  ceiling: $ROUNDS rounds or $MINUTES minutes, whichever first"
[ -n "$RUN" ] && echo "  run:     $RUN (a stop is allowed while this run is in flight)"
printf '%s\tarmed\t%s\n' "$(date -Is)" "$(cat "$STATE")" >> "${STATE%.json}.releases.log"
# CAP THE WINDOW FOR THIS SESSION. A held session keeps working, so every turn bills against the
# model's full window until auto-compact fires there. Only the hook can do it live, and only after
# the state file exists -- the cap record is stored in it and every release undoes it.
[ -r "$HOOK" ] && command -v bun >/dev/null 2>&1 && bun "$HOOK" --cap
echo "  state:   $STATE"
echo "  release: --disarm, which requires the USER to confirm at a terminal"
