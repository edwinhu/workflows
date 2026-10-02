#!/usr/bin/env bash
# Run this repo's bun suite with test FILES in parallel worker processes (bun >= 1.4 `--parallel`).
#
#   scripts/test.sh                      # whole suite, one worker per CPU
#   scripts/test.sh ./skills/work ./tests  # a subset; paths need ./ or bun reads them as name filters
#   TEST_JOBS=8 scripts/test.sh          # cap the workers
#
# Every worker inherits one env, so the run gets its own TMPDIR and FARM_OUTCOMES: farm-events,
# fixtures and outcome rows never reach the caller's session dirs or ~/.local/state.
# It sits under /tmp, NOT the inherited $TMPDIR: bun reads every ancestor directory of its cwd at
# startup, and with fixtures under a 661k-entry ~/.tmp each of the suite's thousands of bun spawns
# paid ~200 ms for it (gate-vacuity 371 s there, 58 s here; measured 2026-10-02).
set -euo pipefail
cd "$(dirname "$0")/.."

run_tmp=$(mktemp -d "${TEST_TMP_BASE:-/tmp}/workflows-test.XXXXXX")
trap 'rm -rf "$run_tmp"' EXIT
export TMPDIR="$run_tmp" FARM_OUTCOMES="$run_tmp/farm-outcomes.jsonl"

# A wall-clock cap, because a hang never fails on its own: once in nine runs a worker spun at 100%
# CPU beside an un-reaped (zombie) `bun` child of converge-check.test.ts and the run sat for 18 min.
# timeout signals its whole process group, so the workers go too. Exit 124 = the cap fired.
cap=()
command -v timeout >/dev/null && cap=(timeout -k 10 "${TEST_WALL:-600}")
${cap[@]+"${cap[@]}"} bun test --parallel${TEST_JOBS:+=$TEST_JOBS} "$@"
