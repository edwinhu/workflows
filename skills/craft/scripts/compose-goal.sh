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

# An audit produces a diagnosis, not a pass: its gate legitimately FAILs and that is the outcome.
if [ "$READONLY" = 1 ]; then
    printf '/goal workflow.js has returned a verdict for %s and the craft human review gate has returned approved or rejected, or the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check\n' \
        "$PLAN" "$RUN_DIR" "$ROUNDS"
else
    printf '/goal the craft human review gate has returned approved or rejected for %s, or the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check\n' \
        "$PLAN" "$RUN_DIR" "$ROUNDS"
fi
