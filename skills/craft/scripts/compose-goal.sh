#!/usr/bin/env bash
# Compose the /goal line craft self-sends, with every clause DECIDABLE.
#
#   compose-goal.sh <plan.md> <run-dir> <max-rounds> <readOnly:0|1>
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
MAX_HOURS="${CRAFT_GOAL_MAX_HOURS:-8}"
case "$MAX_HOURS" in
  ''|*[!0-9]*) die "CRAFT_GOAL_MAX_HOURS must be a whole number of hours, got: $MAX_HOURS" ;;
esac
SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# An audit produces a diagnosis, not a pass: its gate legitimately FAILs and that is the outcome.
if [ "$READONLY" = 1 ]; then
    printf '/goal workflow.js has returned a verdict for %s and the craft human review gate has returned approved or rejected, or the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check — or the run has been going %s hours or more, which `bash %s/scripts/craft-elapsed.sh %s` prints and settles\n' \
        "$PLAN" "$RUN_DIR" "$ROUNDS" "$MAX_HOURS" "$SKILL_DIR" "$RUN_DIR"
else
    printf '/goal the craft human review gate has returned approved or rejected for %s, or the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check — or the run has been going %s hours or more, which `bash %s/scripts/craft-elapsed.sh %s` prints and settles\n' \
        "$PLAN" "$RUN_DIR" "$ROUNDS" "$MAX_HOURS" "$SKILL_DIR" "$RUN_DIR"
fi
