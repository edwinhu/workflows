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
# WHAT CLOSES THE GOAL IS PASS, NOT "a verdict". `craft-result.sh` exits 1 on overallPass=false, so
# a clause reading "exits 0 or 1" is satisfied by a FAIL. Measured 2026-08-27: round 1 of the
# suite-lint run FAILED with 8 surviving blocking findings and closed the goal — craft's own loop is
# gate FAIL -> fix -> re-run, and nothing was carrying it. A losing run is stopped by the round cap
# below, which is bounded and decidable; it is not stopped by calling a FAIL "done".
#
#   This reverses an earlier removal whose stated reason — "PASS is unsatisfiable, because craft
#   fails any task whose redCommand is green at baseline (red-not-red)" — was already stale when it
#   was written. `redDisposition` shipped 2026-08-17 and is exactly the field a completed task
#   declares instead of a red gate; the removal is dated 2026-08-23.
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
# It must outlast a ROUND, not a human's attention span. Measured 2026-08-27 in this repo: round 1
# of a six-task run took 54 minutes against a 10-minute default, so the ceiling was satisfiable 44
# minutes before any work product existed and craft-elapsed.sh printed CEILING REACHED with zero
# rounds on disk. Bounding how long a session waits on an ABSENT HUMAN is Phase 5's business,
# which is where review already lives.
#
# 720 (12h), raised from 480 on 2026-08-28 alongside maxRounds 3 -> 6. The ceiling has to outlast
# maxRounds x a round, and rounds have been measured at 30-60 min here and 3h+ in mail-bridge on
# 2026-08-19; six rounds against the old 8h left the wall clock binding before the round cap in the
# ordinary case, which inverts which escape is doing the work. 12h also spans a real overnight —
# the three stalls of 2026-08-27/28 cost 14h43m between them, every hour of it inside a window a
# ceiling this size covers.
_hours_as_min="${CRAFT_GOAL_MAX_HOURS:+$(( CRAFT_GOAL_MAX_HOURS * 60 ))}"
MAX_MINUTES="${CRAFT_GOAL_MAX_MINUTES:-${_hours_as_min:-720}}"
case "$MAX_MINUTES" in
  ''|*[!0-9]*) die "CRAFT_GOAL_MAX_MINUTES must be a whole number of minutes, got: $MAX_MINUTES" ;;
esac
SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# THE CEILING TRAVELS WITH THE CLAUSE. craft-elapsed.sh carries its own default too, and the two
# drifted to 480 and 10 — 48x apart — so a goal stating one number named a script that would settle
# it at the other. It already accepts the ceiling as $2, so passing it makes the clause
# self-describing and leaves that default as a fallback for hand invocation only.
#
# The two machine escapes, identical in every regime. `rounds` is the per-round counter craft-
# redispatch increments and hard-stops at `maxRounds` (exit 4 beyond it), so this clause MUST be
# composed against maxRounds. Composed against anything larger it is unreachable, and the run is
# left with the wall clock as its only working escape.
ESCAPES=$(printf 'the rounds field in %s/args.json reads %s or more — `jq -r .rounds` it to check — or the run has been going %s minutes or more, which `bash %s/scripts/craft-elapsed.sh %s %s` prints and settles' \
    "$RUN_DIR" "$ROUNDS" "$MAX_MINUTES" "$SKILL_DIR" "$RUN_DIR" "$MAX_MINUTES")

# The dispatch raises a /loop beside this goal. A fixed-interval loop is a recurring cron that
# ignores the model's own stop:true, and NOTHING in a shell can remove it — CronDelete is a model
# tool, there is no cron CLI, and a session-scoped cron lives in memory rather than in
# .claude/scheduled_tasks.json. So the teardown must be an instruction the session acts on, and the
# goal is the one text it re-reads every turn. Without this the loop keeps ticking after PASS.
TEARDOWN='When this goal closes, cancel the run loop with CronDelete — it is a cron and does not stop on its own.'

if [ "$READONLY" = 1 ]; then
    # An audit produces a diagnosis, not a pass: its gate legitimately FAILs and that is the outcome.
    printf '/goal workflow.js has returned a verdict for %s, or %s\n' "$PLAN" "$ESCAPES"
else
    # The run has produced a verdict craft-result.sh can read. That is the terminal MACHINE event;
    # what to do about it — including opening review — is Phase 5's business, not the goal's.
    printf '/goal craft has returned PASS for %s — `bash %s/scripts/craft-result.sh %s/result.json` exits 0 — or %s. %s\n' \
        "$PLAN" "$SKILL_DIR" "$RUN_DIR" "$ESCAPES" "$TEARDOWN"
fi
