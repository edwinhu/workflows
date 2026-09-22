#!/usr/bin/env bash
# Arm the until Stop hook on THIS session: hold the turn until a command exits 0.
#
# No transport: a state file is written here and read by hooks/hound.ts on every Stop. Anything
# that has to be TYPED into the session instead needs the pane idle, and a session working
# back-to-back never goes idle, so it never lands.
#
#   hound-arm.sh '<check command>' [--goal '<objective>'] [--rounds N] [--minutes M]
#   hound-arm.sh --status | --disarm
#
# Exit 0 armed, 2 usage or no session id.
set -uo pipefail

SID="${CLAUDE_CODE_SESSION_ID-}"
[ -n "$SID" ] || { echo "hound-arm: no CLAUDE_CODE_SESSION_ID — cannot arm a session-scoped hold" >&2; exit 2; }
STATE="${TMPDIR:-/tmp}/hound-$SID.json"
HOOK="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)/hooks/hound.ts"

case "${1-}" in
  --status)
    [ -f "$STATE" ] || { echo "hound: not armed"; exit 0; }
    echo "hound: ARMED — $STATE"; cat "$STATE"; echo
    LOG="${STATE%.json}.releases.log"
    [ -s "$LOG" ] && { echo "  release attempts this session:"; sed "s/^/    /" "$LOG"; }
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
    if [ ! -f "$STATE" ]; then echo "hound: not armed"; exit 0; fi
    if [ ! -r /dev/tty ] || [ ! -t 0 ] && ! { exec 3</dev/tty; } 2>/dev/null; then
      printf '%s\trefused (no tty)\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
      echo "hound-arm: --disarm needs the USER to confirm at a terminal, and there is none here." >&2
      echo "  The hold is not yours to release: ask the user, or arm a different check instead." >&2
      echo "  A gate that measures the wrong property is replaced by arming the right one, not by stopping." >&2
      exit 2
    fi
    exec 3</dev/tty
    printf 'hound: release the hold on `%s`? [y/N] ' "$(jq -r .check "$STATE" 2>/dev/null)" > /dev/tty
    read -r ans <&3 || ans=""
    exec 3<&-
    case "$ans" in
      y|Y|yes|YES)
        printf '%s\treleased by user\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        # Restore the window BEFORE the state file goes: the cap record lives in it.
        [ -r "$HOOK" ] && command -v bun >/dev/null 2>&1 && bun "$HOOK" --uncap
        rm -f "$STATE"; echo "hound: disarmed (user confirmed)"; exit 0 ;;
      *)
        printf '%s\tdeclined\t%s\n' "$(date -Is)" "$(jq -r .check "$STATE" 2>/dev/null)" >> "$LOG"
        echo "hound: still armed"; exit 2 ;;
    esac ;;
  "" | -*)
    echo "usage: hound-arm.sh '<check command>' [--goal '<objective>'] [--rounds N] [--minutes M] | --status | --disarm" >&2
    exit 2 ;;
esac

CHECK="$1"; shift
ROUNDS=8; MINUTES=720
GOAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --goal)    GOAL="${2-}"; shift 2 ;;
    --rounds)  ROUNDS="${2-}"; shift 2 ;;
    --minutes) MINUTES="${2-}"; shift 2 ;;
    *) echo "hound-arm: unknown flag $1" >&2; exit 2 ;;
  esac
done

# REFUSE A CHECK THAT ALREADY PASSES. Arming on a met objective holds nothing and teaches the
# session that the hold is noise; arming on one that cannot RUN (exit 2, 127) would hold it
# forever on a broken command.
OUT=$(bash -lc "$CHECK" 2>&1); RC=$?
if [ "$RC" -eq 0 ]; then
  echo "hound-arm: that check ALREADY exits 0 — nothing to hold. Not armed." >&2; exit 2
fi
if [ "$RC" -gt 1 ]; then
  echo "hound-arm: that check exits $RC, which is could-not-run rather than a verdict." >&2
  printf '%s\n' "$OUT" | tail -3 >&2
  echo "hound-arm: fix the command first. Not armed." >&2; exit 2
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
# the goal was "the one text it re-reads every turn" -- and in hound that text is the hold's block
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

CONTINUATION_CLAUSE="A failing check is not a stopping point: fix it and re-run in the same turn. $GOAL_CONTINUATION_TAIL"

python3 - "$STATE" "$CHECK" "$ROUNDS" "$MINUTES" "${GOAL:-}" "$AUTHORITY_CLAUSE" "$CONTINUATION_CLAUSE" <<'PY'
import hashlib, json, os, re, sys, time
path, check, rounds, minutes = sys.argv[1:5]
goal = sys.argv[5] if len(sys.argv) > 5 else ""
authority = sys.argv[6] if len(sys.argv) > 6 else ""
continuation = sys.argv[7] if len(sys.argv) > 7 else ""

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

json.dump({"check": check, "startedAt": int(time.time()),
           "ceilingMinutes": int(minutes), "maxRounds": int(rounds), "rounds": 0,
           "checkFiles": files, "goal": goal,
           "authority": authority, "continuation": continuation},
          open(path, "w"))
print(f"  rubric: {len(files)} file(s) pinned by content", file=sys.stderr)
PY
# LINT THE CHECK AS A SPECIFICATION, not just as a runtime fact. The two refusals above are
# behavioural (green, or could-not-run); these are the rules SKILL.md states and nothing enforced
# until 2026-09-21, when two gates passed arm-time validation and were still mis-specified.
# A critical refuses; anything else is printed and armed anyway, because "the gate measures the
# wrong property" is judgment and stays the session's problem.
LINT="$(dirname "$(readlink -f "$0")")/hold-lint.ts"
if [ -r "$LINT" ] && command -v bun >/dev/null 2>&1; then
  LINT_OUT=$(bun "$LINT" "$CHECK" 2>&1); LINT_RC=$?
  if [ "$LINT_RC" -eq 1 ]; then
    printf '%s\n' "$LINT_OUT"
    if printf '%s' "$LINT_OUT" | grep -q "^CRITICAL"; then
      echo "hound-arm: fix the critical finding(s) above first. Not armed." >&2
      exit 2
    fi
  fi
fi

echo "hound: ARMED on \`$CHECK\` (currently exits $RC)"
echo "  ceiling: $ROUNDS rounds or $MINUTES minutes, whichever first"
printf '%s\tarmed\t%s\n' "$(date -Is)" "$(cat "$STATE")" >> "${STATE%.json}.releases.log"
# CAP THE WINDOW FOR THIS SESSION. A held session keeps working, so every turn bills against the
# model's full window until auto-compact fires there. Only the hook can do it live, and only after
# the state file exists -- the cap record is stored in it and every release undoes it.
[ -r "$HOOK" ] && command -v bun >/dev/null 2>&1 && bun "$HOOK" --cap
echo "  state:   $STATE"
echo "  release: --disarm, which requires the USER to confirm at a terminal"
