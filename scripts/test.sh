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
if [ "${KEEP_TMP:-}" = 1 ]; then
  echo "test.sh: KEEP_TMP=1 — fixtures kept in $run_tmp, leak guard off" >&2
else
  trap 'rm -rf "$run_tmp"' EXIT
fi
export TMPDIR="$run_tmp" FARM_OUTCOMES="$run_tmp/farm-outcomes.jsonl"

# A wall-clock cap, because a hang never fails on its own: once in nine runs a worker spun at 100%
# CPU beside an un-reaped (zombie) `bun` child of converge-check.test.ts and the run sat for 18 min.
# timeout signals its whole process group, so the workers go too. Exit 124 = the cap fired.
cap=()
command -v timeout >/dev/null && cap=(timeout -k 10 "${TEST_WALL:-600}")
rc=0
${cap[@]+"${cap[@]}"} bun test --parallel${TEST_JOBS:+=$TEST_JOBS} "$@" || rc=$?

# THE LEAK GUARD. A fixture that outlives its test lands in whatever TMPDIR the caller has, and
# outside this script that is the user's: ~/.tmp held ~125K fixture dirs from one week of bare
# `bun test` and gate-harness runs (counted 2026-10-02). Every test must sweep what it makes
# (tests/helpers/tmp.ts), so the run's own TMPDIR must be empty here. Allowed, because neither is a
# fixture: farm-outcomes.jsonl (this script's FARM_OUTCOMES) and uv-*.lock (uv's interpreter locks,
# which `uv run` in the python suites keeps on purpose).
if [ "${KEEP_TMP:-}" != 1 ]; then
  leaks=$(find "$run_tmp" -mindepth 1 -maxdepth 1 ! -name farm-outcomes.jsonl ! -name 'uv-*.lock' -printf '%f\n' | sort)
  if [ -n "$leaks" ]; then
    echo "test.sh: LEAK GUARD FAILED — $(wc -l <<<"$leaks") entries left in the run's TMPDIR:" >&2
    head -40 <<<"$leaks" | sed 's/^/  /' >&2
    echo "Create fixture dirs with useTmp() from tests/helpers/tmp.ts; KEEP_TMP=1 keeps them to inspect." >&2
    [ "$rc" = 0 ] && rc=1
  else
    echo "test.sh: leak guard ok — the run's TMPDIR is empty" >&2
  fi
fi
exit "$rc"
