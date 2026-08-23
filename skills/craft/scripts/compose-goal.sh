#!/usr/bin/env bash
# Compose the /goal line craft self-sends, with every clause DECIDABLE.
#
#   compose-goal.sh <plan.md> <run-dir> <max-rounds> <readOnly:0|1>
#
# HUMAN REVIEW IS NOT IN HERE. A goal is what a session can close BY WORKING, and a human verdict
# is not something it can work toward — so a human clause makes every run stoppable only by a person
# who may have walked away. Measured 2026-08-22: a tested, reversible bugfix sat behind that clause
# for ~18 hours while the outage it repaired stayed live. Review is real and still happens; it lives
# in the skill's Phase 5, AFTER the goal clears, where it is a step the session performs rather than
# a condition it waits on.
#
# Two things this deliberately does NOT say, each measured on an episode that could not close its
# own goal:
#
#   "or stop after N turns" — /goal installs a Stop hook judged by a model reading the transcript,
#   and nothing counts turns: no num_turns, no turn_count, anywhere. The clause was re-adjudicated
#   on every stop attempt and the judge reasoned out of it four times, finally holding that stopping
#   deliberately disqualifies the escape while losing control would qualify. The escape now names
#   <run-dir>/rounds, so checking it is a `cat` whose output is evidence in the transcript.
#
#   A ROUND-ONLY escape. Measured 2026-08-19, mail-bridge: rounds ran 3h+ each, so `rounds >= 4`
#   put the guaranteed stop twelve hours out while the human slept — the goal was decidable and
#   still unreachable in any useful time. Rounds count work, not elapsed, so the clause below adds
#   an hours bound that a `date`-free `find` can settle, and either one closes the goal.
#
#   "workflow.js has returned PASS" — unsatisfiable once the plan succeeds. Craft fails any task
#   whose redCommand is green at baseline (red-not-red), so a completed plan's gates are all green
#   by construction and a re-run flags every task; one episode ended at redNotRed: 5. The goal names
#   the terminal HUMAN event instead, which stays reachable after the work is done.
set -euo pipefail

die() { printf 'compose-goal: %s\n' "$1" >&2; exit 2; }

[ $# -eq 4 ] || die "usage: compose-goal.sh <plan.md> <run-dir> <max-rounds> <readOnly:0|1>"
PLAN=$1; RUN_DIR=$2; ROUNDS=$3; READONLY=$4

case "$ROUNDS" in
  ''|*[!0-9]*) die "max-rounds must be a whole number, got: $ROUNDS" ;;
esac
case "$READONLY" in 0|1) ;; *) die "readOnly must be 0 or 1, got: $READONLY" ;; esac

# The wall-clock ceiling the goal may not outlive. Overridable, never absent: a goal with no time
# bound is one an unattended session cannot close by working.
# Minutes, not hours: the ceiling bounds how long a session may WAIT on the human half, and a
# session with work left keeps working regardless — the Stop hook gates stopping, not working.
_hours_as_min="${CRAFT_GOAL_MAX_HOURS:+$(( CRAFT_GOAL_MAX_HOURS * 60 ))}"
MAX_MINUTES="${CRAFT_GOAL_MAX_MINUTES:-${_hours_as_min:-10}}"
case "$MAX_MINUTES" in
  ''|*[!0-9]*) die "CRAFT_GOAL_MAX_MINUTES must be a whole number of minutes, got: $MAX_MINUTES" ;;
esac
SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# The two machine escapes, identical in every regime.
ESCAPES=$(printf 'the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check — or the run has been going %s minutes or more, which `bash %s/scripts/craft-elapsed.sh %s` prints and settles' \
    "$RUN_DIR" "$ROUNDS" "$MAX_MINUTES" "$SKILL_DIR" "$RUN_DIR")

if [ "$READONLY" = 1 ]; then
    # An audit produces a diagnosis, not a pass: its gate legitimately FAILs and that is the outcome.
    printf '/goal workflow.js has returned a verdict for %s, or %s\n' "$PLAN" "$ESCAPES"
else
    # The run has produced a verdict craft-result.sh can read. That is the terminal MACHINE event;
    # what to do about it — including opening review — is Phase 5's business, not the goal's.
    printf '/goal craft has returned a verdict for %s — `bash %s/scripts/craft-result.sh %s/result.json` exits 0 or 1 rather than 2 — or %s\n' \
        "$PLAN" "$SKILL_DIR" "$RUN_DIR" "$ESCAPES"
fi
