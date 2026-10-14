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

# The roots a farm-events writer reaches when a test hands its child no TMPDIR of its own: /tmp (the
# writers' default) and the caller's TMPDIR, which is taken before this script replaces it.
event_roots=(/tmp/farm-events)
[ -n "${TMPDIR:-}" ] && [ "${TMPDIR%/}/farm-events" != /tmp/farm-events ] && event_roots+=("${TMPDIR%/}/farm-events")
run_tmp=$(mktemp -d "${TEST_TMP_BASE:-/tmp}/workflows-test.XXXXXX")
# The run's own bookkeeping (per-file timings, the cap report), outside run_tmp so no test sees it.
run_meta=$(mktemp -d "${TEST_TMP_BASE:-/tmp}/workflows-test-meta.XXXXXX")
touch "$run_meta/start"
if [ "${KEEP_TMP:-}" = 1 ]; then
  echo "test.sh: KEEP_TMP=1 — fixtures kept in $run_tmp, leak guard off" >&2
else
  trap 'rm -rf "$run_tmp" "$run_meta"' EXIT
fi
# A caller inside a farm row or grind loop passes its identity (FARM_OUT_CHILD, FARM_ROW_ID, GRIND_*);
# the fixture rows of farm-bgjob.test.ts would read it as their own. None reaches the suite.
while IFS= read -r v; do unset "$v"; done < <(compgen -e | grep -E '^(FARM|GRIND)_' || true)
export TMPDIR="$run_tmp" FARM_OUTCOMES="$run_tmp/farm-outcomes.jsonl"
# No test reads the real OpenRouter balance: every interactive SessionStart spawn would, and a low
# account would then change what those tests see. tests/openrouter-credits.test.ts points at its stubs.
export OPENROUTER_CREDITS_URL=off
# Nor the Jev spend log or reply cache: a cached reply would answer a later test's stub call.
# tests/jev-spend.test.ts turns them on against its own stubs.
export JEV_CALL_LOG=off JEV_CACHE=off
# The python suites import modules that live in the tree; their bytecode would land in __pycache__/
# beside them. Ignored by git, but still a write into the tree every run.
export PYTHONDONTWRITEBYTECODE=1
# pytest.ini carries `-n auto`, so every pytest a test spawns (checks-python-pins, the ds/workshop
# check legs) would fork one xdist worker per core on top of bun's own per-core files: 32 files x 32
# workers, load average 94-145 on 32 cores. xdist reads this variable for `auto`; a bare pytest
# outside the suite is untouched. tests/pytest-workers-bounded.test.ts pins it.
export PYTEST_XDIST_AUTO_NUM_WORKERS="${TEST_PYTEST_WORKERS:-2}" WORKFLOWS_SUITE=1

# Skills with their own locked npm deps (cite-check, deep-research: @google/genai). At runtime bun
# auto-installs them because no node_modules sits above the skill, but `bun test` never auto-installs,
# so a checkout nobody ran `bun install` in (every fresh worktree) fails those suites with "Cannot
# find module". Install from the lockfile; a failure here stops the run rather than going red later.
for lock in skills/*/bun.lock; do
  d=$(dirname "$lock")
  [ -d "$d/node_modules" ] && continue
  bun install --cwd "$d" --frozen-lockfile --silent \
    || { echo "test.sh: bun install failed in $d (offline with a cold bun cache?)" >&2; exit 1; }
done

# THE TREE GUARD's snapshot: every path git reports as changed or untracked, with its content hash,
# so a test that edits an already-dirty file is caught too. Taken before the suite and compared after.
tree_state() {
  git status --porcelain --untracked-files=all | while IFS= read -r line; do
    p=${line:3}
    if [ -f "$p" ]; then h=$(git hash-object -- "$p"); else h=-; fi
    printf '%s %s\n' "$line" "$h"
  done
}
in_git=0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && in_git=1
[ "$in_git" = 1 ] && tree_before=$(tree_state)

# A wall-clock cap, because a hang never fails on its own: once in nine runs a worker spun at 100%
# CPU beside an un-reaped (zombie) `bun` child of converge-check.test.ts and the run sat for 18 min.
# timeout signals its whole process group, so the workers go too. Exit 124 = the cap fired.
# A capped run names its cause: bun prints only the in-flight file names, so 2 s before the cap a
# watchdog records the slowest finished files, what is still running and the process tree under the
# run — the stuck child is in that tree. Three first runs hit the cap on 2026-10-13, one file in
# flight each, and none left a trace of what that file was waiting on.
wall=${TEST_WALL:-600}
export TEST_FILE_TIMING_LOG="$run_meta/file-timing.log"
cap_report() {  # $1 = pid of the capped command
  local now; now=$(date +%s%3N)
  echo "test.sh: WALL CAP ($wall s) FIRED — the run 2 s before the kill (TEST_WALL raises the cap):"
  echo "  slowest finished files:"
  awk '{f=$0; sub(/^[^ ]+ [^ ]+ [^ ]+ /, "", f)} $1=="start"{s[f]=$2} $1=="end"{e[f]=$2}
       END{for (f in e) if (f in s) printf "%.1f %s\n", (e[f]-s[f])/1000, f}' "$TEST_FILE_TIMING_LOG" 2>/dev/null \
    | sort -rn | head -10 | awk '{printf "    %7.1fs  %s\n", $1, $2}'
  echo "  still running (started, no end recorded):"
  awk -v now="$now" '{f=$0; sub(/^[^ ]+ [^ ]+ [^ ]+ /, "", f)} $1=="start"{s[f]=$2} $1=="end"{e[f]=1}
       END{for (f in s) if (!(f in e)) printf "%.1f %s\n", (now-s[f])/1000, f}' "$TEST_FILE_TIMING_LOG" 2>/dev/null \
    | sort -rn | awk '{printf "    %7.1fs  %s\n", $1, $2}'
  echo "  process tree of the run (pid, elapsed, state, wait channel, argv):"
  ps -e -o pid=,ppid=,etimes=,stat=,wchan:22=,args= | awk -v root="$1" '
    { kids[$2] = kids[$2] " " $1; row[$1] = sprintf("%8s %6ss %-5s %-22s ", $1, $3, $4, $5)
      a = $0; sub(/^ *[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ /, "", a); args[$1] = a }
    function walk(p, d,   n, k, i) {
      printf "    %s%*s%s\n", row[p], 2 * d, "", substr(args[p], 1, 200)
      n = split(kids[p], k, " "); for (i = 1; i <= n; i++) walk(k[i], d + 1)
    }
    END { if (root in row) walk(root, 0) }'
}
cap=()
command -v timeout >/dev/null && cap=(timeout -k 10 "$wall")
wd=
if [ ${#cap[@]} -gt 0 ] && [[ $wall =~ ^[0-9]+$ ]] && [ "$wall" -gt 2 ]; then
  ( sleep $((wall - 2)); p=$(pgrep -P $$ -x timeout | head -1); [ -n "$p" ] && cap_report "$p" > "$run_meta/cap-report.txt" ) &
  wd=$!
fi
rc=0
${cap[@]+"${cap[@]}"} bun test --parallel${TEST_JOBS:+=$TEST_JOBS} --preload ./tests/helpers/file-timing.ts "$@" || rc=$?
if [ -n "$wd" ]; then pkill -P "$wd" 2>/dev/null || true; kill "$wd" 2>/dev/null || true; wait "$wd" 2>/dev/null || true; fi
[ "$rc" = 124 ] && [ -s "$run_meta/cap-report.txt" ] && cat "$run_meta/cap-report.txt" >&2

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

# THE EVENT GUARD. The run's own TMPDIR is empty above even when a test points a farm.sh/grind.sh child
# at the machine's real event root: /tmp/farm-events/<session>/<pid>.ndjson is outside it, and the
# session's watcher reads those rows as live runs (473 files by 2026-10-14, every one naming a
# fixture journal under a workflows-test.* dir). A row written during this run that names this run's
# TMPDIR is a test's, whatever session dir it landed in; a real session's row cannot name it.
if [ "${KEEP_TMP:-}" != 1 ]; then
  leaked=$(for root in "${event_roots[@]}"; do
    [ -d "$root" ] && find "$root" -type f -name '*.ndjson' -newer "$run_meta/start" -print0 2>/dev/null \
      | xargs -0 -r grep -lF -- "$run_tmp" 2>/dev/null
  done | sort -u || true)
  if [ -n "$leaked" ]; then
    echo "test.sh: EVENT GUARD FAILED — $(wc -l <<<"$leaked") event stream(s) naming this run's fixtures landed in a real farm-events root:" >&2
    head -20 <<<"$leaked" | sed 's/^/  /' >&2
    echo "Give the spawned farm.sh/grind.sh/work-loop child an env with TMPDIR set to the test's own dir (grindEnv() in skills/grind/scripts/grind-test-env.ts, or hermeticEnv() in tests/helpers/hermetic-env.ts)." >&2
    [ "$rc" = 0 ] && rc=1
  else
    echo "test.sh: event guard ok — no farm-events stream naming this run's fixtures reached ${event_roots[*]}" >&2
  fi
fi

# THE TREE GUARD. A test that writes into the checkout races every parallel test that scans it:
# agent-contract's hooks/zz-ghost-unwired.ts fixture made gate-vacuity ENOENT ten times in one run.
# Fixtures belong in useTmp() dirs or temp copies; nothing is allow-listed. A path that a test makes
# and deletes inside the run leaves no trace here, so this catches what outlives the suite.
if [ "$in_git" = 1 ]; then
  tree_diff=$(diff <(printf "%s\n" "$tree_before") <(printf "%s\n" "$(tree_state)") | grep "^[<>]" || true)
  if [ -n "$tree_diff" ]; then
    echo "test.sh: TREE GUARD FAILED — the run created, changed or deleted paths in the checkout" >&2
    echo "  (< before the run, > after; columns: git status, path, content hash):" >&2
    head -40 <<<"$tree_diff" | sed 's/^/  /' >&2
    echo "Write fixtures under a useTmp() dir (tests/helpers/tmp.ts) or a temp copy, never the repo." >&2
    [ "$rc" = 0 ] && rc=1
  else
    echo "test.sh: tree guard ok — git status is unchanged by the run" >&2
  fi
fi
exit "$rc"
