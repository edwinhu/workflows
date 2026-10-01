#!/bin/bash
#
# gate_test.sh — gate.sh against a STUBBED qstat, in a throwaway $DEF14A_WORK.
#
# The three branches that matter are the ones the 2026-09-29 deadlock walked
# through, plus the two that would make the fix dangerous if they were wrong:
#
#   1 in-flight              recorded job on the grid, live pid   -> exit 1, no marker
#   2 finished normally      round-ready present                  -> exit 0
#   3 orphaned-and-finished  pid gone, job gone, no marker        -> exit 0, marker created
#   4 scheduler unreachable  qstat exits non-zero                 -> exit 1 (never assume finished)
#   5 nothing ever recorded  no state file, no marker             -> exit 0, marker NOT created
#  5b nothing recorded but   a ^def14a job is queued anyway       -> exit 1 (the live
#     an un-recorded round                                            2026-09-30 case)
#   6 the recorder           gate_lib.sh on real qsub output      -> ids + state on disk
#
# Touches nothing outside its own mktemp -d. Run: bash gate_test.sh

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/gate.sh"
# Existing scheduler cases must not depend on the machine's local mirror.
export DEF14A_LOCAL=0
PASS=0
FAIL=0

check() {   # check <label> <expected_exit> <actual_exit>
    if [[ "$2" == "$3" ]]; then
        echo "  PASS $1 (exit $3)"
        PASS=$((PASS + 1))
    else
        echo "  FAIL $1: expected exit $2, got $3"
        FAIL=$((FAIL + 1))
    fi
}

check_file() {   # check_file <label> present|absent <path>
    if [[ "$2" == "present" && -f "$3" ]] || [[ "$2" == "absent" && ! -f "$3" ]]; then
        echo "  PASS $1 ($2: $3)"
        PASS=$((PASS + 1))
    else
        echo "  FAIL $1: expected $2: $3"
        FAIL=$((FAIL + 1))
    fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; [[ -n "${LIVE_PID:-}" ]] && kill "$LIVE_PID" 2>/dev/null' EXIT

# --- the stubs ---------------------------------------------------------------
# A qstat listing in SGE's shape. job-ID is column 1, which is all gate.sh reads.
mk_qstat() {   # mk_qstat <jobid>...   (empty = an idle grid)
    mk_qstat_named other_proj "$@"
}
# Column 3 is the job NAME. The default listing deliberately uses a name that does
# NOT match ^def14a, so the id check and the name fallback are tested apart.
mk_qstat_named() {   # mk_qstat_named <name> <jobid>...
    local nm="$1"; shift
    { echo "job-ID  prior   name       user         state submit/start at     queue"
      echo "-----------------------------------------------------------------------"
      for j in "$@"; do
          printf '%s 0.50000 %s eddyhu      qw    09/30/2026 00:19:02   \n' "$j" "$nm"
      done
    } > "$TMP/qstat_out"
    cat > "$TMP/qstat_stub.sh" <<EOF
#!/bin/bash
cat "$TMP/qstat_out"
EOF
    chmod +x "$TMP/qstat_stub.sh"
}

mk_state() {   # mk_state <pid> <phase>
    mkdir -p "$W/out"
    cat > "$W/out/round-state.json" <<EOF
{ "pid": $1, "host": "wrds", "root": "/scratch/x", "work": "$W",
  "filelist": "round_filelist.tsv", "fetch_only": 0, "phase": "$2",
  "job_ids": "40335943", "started_epoch": 1, "updated_epoch": 2, "updated": "now" }
EOF
}

mk_jobs() {   # mk_jobs <jobid>...
    mkdir -p "$W/out"
    : > "$W/out/round-jobs.tsv"
    for j in "$@"; do
        printf '%s\tshard_array\t1759200000\n' "$j" >> "$W/out/round-jobs.tsv"
    done
}

fresh_work() { W="$TMP/work$1"; mkdir -p "$W/out"; }

# A live process whose cmdline names run_baseline — the same thing gate.sh greps
# for in /proc. `sleep` under that filename is the whole trick; no scheduler and
# no real round are involved.
cat > "$TMP/run_baseline.sh" <<'EOF'
#!/bin/bash
sleep 120
EOF
chmod +x "$TMP/run_baseline.sh"

# --- 1. IN FLIGHT: job queued, pid alive -> gate shut ------------------------
echo "case 1: in-flight (job 40335943 queued, run_baseline pid alive)"
fresh_work 1
# stdout/stderr go to /dev/null, and stdin is closed: a background child that
# inherits this script's stdout holds the pipe open when the suite is run as
# `bash gate_test.sh | tail`, and the caller then waits 120 s for a sleep.
bash "$TMP/run_baseline.sh" >/dev/null 2>&1 </dev/null & LIVE_PID=$!
mk_state "$LIVE_PID" array
mk_jobs 40335943
mk_qstat 40335943
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "in-flight, live pid -> shut" 1 $?
check_file "in-flight leaves no marker" absent "$W/out/round-ready"

# 1b. the same round with the pid ALREADY dead but the job still queued: this is
# exactly the orphan state, and it must still wait — the grid is doing the work.
echo "case 1b: in-flight but ORPHANED pid (job still queued) -> still shut"
kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null; DEAD_PID="$LIVE_PID"; LIVE_PID=""
fresh_work 1b
mk_state "$DEAD_PID" array
mk_jobs 40335943
mk_qstat 40335943
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "orphaned pid, job queued -> shut" 1 $?
check_file "no marker while the grid still holds it" absent "$W/out/round-ready"

# --- 2. FINISHED NORMALLY: run_baseline wrote the marker ---------------------
echo "case 2: finished normally (round-ready present)"
fresh_work 2
mk_state "$DEAD_PID" done
mk_jobs 40335943
mk_qstat                     # idle grid
touch "$W/out/round-ready"
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "marker present -> open" 0 $?
check_file "marker untouched" present "$W/out/round-ready"
check_file "not reported as orphaned" absent "$W/out/round-orphaned"

# --- 3. ORPHANED AND FINISHED: the deadlock the fix is for -------------------
echo "case 3: orphaned-and-finished (pid gone, job gone, no marker)"
fresh_work 3
mk_state "$DEAD_PID" array
mk_jobs 40335943
mk_qstat                     # the job has left the grid
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" > "$TMP/out3.txt" 2>&1
check "orphaned-and-finished -> open" 0 $?
check_file "marker re-created" present "$W/out/round-ready"
check_file "reason recorded" present "$W/out/round-orphaned"
if grep -q "ORPHANED round" "$TMP/out3.txt" && grep -q "fetch-only" "$TMP/out3.txt"; then
    echo "  PASS orphan message names the reason and the --fetch-only remedy"
    PASS=$((PASS + 1))
else
    echo "  FAIL orphan message: $(cat "$TMP/out3.txt")"
    FAIL=$((FAIL + 1))
fi

# --- 4. SCHEDULER UNREACHABLE: a failed query is not a finished job ----------
echo "case 4: scheduler unreachable (qstat exits 255)"
fresh_work 4
mk_state "$DEAD_PID" array
mk_jobs 40335943
printf '#!/bin/bash\nexit 255\n' > "$TMP/qstat_fail.sh"; chmod +x "$TMP/qstat_fail.sh"
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_fail.sh" bash "$GATE" >/dev/null 2>&1
check "qstat failure -> shut" 1 $?
check_file "no marker invented on a failed query" absent "$W/out/round-ready"

# --- 5. NOTHING EVER RECORDED -----------------------------------------------
echo "case 5: no round ever recorded"
fresh_work 5
mk_qstat
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "no state file -> open" 0 $?
check_file "marker NOT invented when no round ran" absent "$W/out/round-ready"

# --- 5b. NOTHING RECORDED but a def14a job is on the grid --------------------
# The live 2026-09-30 situation: the orphaned round was submitted before this
# bookkeeping existed, so there is no state file — and the gate must still wait.
echo "case 5b: no state file, but an un-recorded def14a job is queued"
fresh_work 5b
mk_qstat_named def14a_py 40335943
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" > "$TMP/out5b.txt" 2>&1
check "un-recorded def14a job in flight -> shut" 1 $?
check_file "no marker while an un-recorded round runs" absent "$W/out/round-ready"
if grep -q "un-recorded round is in flight" "$TMP/out5b.txt"; then
    echo "  PASS message names the stray job"
    PASS=$((PASS + 1))
else
    echo "  FAIL message: $(cat "$TMP/out5b.txt")"
    FAIL=$((FAIL + 1))
fi

# --- 6. THE RECORDER: gate_lib.sh against real SGE qsub output ---------------
# The other half of the fix. Verified against verbatim SGE output for both
# spellings, because a recorder that misses the array line records nothing for the
# only qsub whose wait is long enough to be killed inside.
echo "case 6: gate_lib.sh records job ids out of real qsub output"
fresh_work 6
(
    JOBS_TSV="$W/out/round-jobs.tsv"; STATE_JSON="$W/out/round-state.json"
    HOST=wrds; ROOT=/scratch/x; WORK="$W"; FILELIST=round_filelist.tsv; FETCH_ONLY=0
    START_EPOCH=1; GATE_PID=4242; PHASE=start
    : > "$JOBS_TSV"
    source "$HERE/gate_lib.sh"
    gate_write_state start
    printf '%s\n' 'Your job 40335942 ("run_python.sh") has been submitted' \
        | gate_record_stream scan_sizes > "$W/passthru_a.txt"
    PHASE=array
    printf '%s\n%s\n' \
        'Your job-array 40335943.1-57:1 ("submit_shards.sh") has been submitted' \
        'Job-array 40335943.1-57:1 exited with exit code 0.' \
        | gate_record_stream shard_array > "$W/passthru_b.txt"
)
if [[ "$(cut -f1 "$W/out/round-jobs.tsv" | paste -sd, -)" == "40335942,40335943" ]]; then
    echo "  PASS both job ids recorded, in order"
    PASS=$((PASS + 1))
else
    echo "  FAIL recorded ids: $(cut -f1 "$W/out/round-jobs.tsv" | paste -sd, -)"
    FAIL=$((FAIL + 1))
fi
if grep -q '"job_ids": "40335942,40335943"' "$W/out/round-state.json" &&
   grep -q '"phase": "array"' "$W/out/round-state.json" &&
   grep -q '"pid": 4242' "$W/out/round-state.json"; then
    echo "  PASS state file carries pid, phase and both job ids"
    PASS=$((PASS + 1))
else
    echo "  FAIL state file: $(cat "$W/out/round-state.json")"
    FAIL=$((FAIL + 1))
fi
if [[ "$(cat "$W/passthru_a.txt")" == 'Your job 40335942 ("run_python.sh") has been submitted' ]] &&
   [[ "$(wc -l < "$W/passthru_b.txt")" == "2" ]]; then
    echo "  PASS qsub output passes through unchanged (the pipeline stays a pipeline)"
    PASS=$((PASS + 1))
else
    echo "  FAIL passthrough altered the qsub stream"
    FAIL=$((FAIL + 1))
fi
# 6b. and gate.sh must read what gate_lib.sh just wrote — the contract, end to end.
mk_qstat 40335943
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "gate reads the recorder's files: array still queued -> shut" 1 $?
mk_qstat
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "same files, grid now idle -> open" 0 $?
check_file "marker re-created from the recorder's state" present "$W/out/round-ready"

# --- 7. LOCAL: scheduler access is forbidden, even with a stray grid job -----
echo "case 7: local rounds never query qstat or ssh"
mkdir -p "$TMP/gold" "$TMP/filings" "$TMP/bin"
export GOLD_DIR="$TMP/gold" DEF14A_FILINGS="$TMP/filings" DEF14A_FILELIST=round_filelist.tsv
for i in 1 2 3 4 5; do
    printf 'filing%s.txt\tfixture\n' "$i" >> "$GOLD_DIR/$DEF14A_FILELIST"
    touch "$DEF14A_FILINGS/filing$i.txt"
done
cat > "$TMP/qstat_forbidden.sh" <<EOF
#!/bin/bash
touch "$TMP/qstat_called"
exit 99
EOF
cat > "$TMP/bin/ssh" <<EOF
#!/bin/bash
touch "$TMP/ssh_called"
exit 99
EOF
chmod +x "$TMP/qstat_forbidden.sh" "$TMP/bin/ssh"
export PATH="$TMP/bin:$PATH"
for mode in 1 auto unset; do
    echo "  local selection: $mode"
    if [[ "$mode" == unset ]]; then unset DEF14A_LOCAL; else export DEF14A_LOCAL="$mode"; fi
    fresh_work "7-$mode"
    mk_state "$DEAD_PID" local
    DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_forbidden.sh" bash "$GATE" > "$TMP/local_out" 2>&1
    check "dead local round -> open ($mode)" 0 $?
    check_file "local marker re-created ($mode)" present "$W/out/round-ready"
    check_file "local orphan reason recorded ($mode)" present "$W/out/round-orphaned"
    check_file "qstat was never called ($mode)" absent "$TMP/qstat_called"
    if grep -q 'fetch-only' "$TMP/local_out"; then
        check "local recovery must not advise grid fetch ($mode)" 0 1
    else
        check "local recovery does not advise grid fetch ($mode)" 0 0
    fi
    DEF14A_WORK="$W" bash "$GATE" >/dev/null 2>&1
    check "completed local round -> open without ssh ($mode)" 0 $?
    check_file "ssh was never called ($mode)" absent "$TMP/ssh_called"
done

export DEF14A_LOCAL=1
fresh_work 7-live
bash "$TMP/run_baseline.sh" >/dev/null 2>&1 </dev/null & LIVE_PID=$!
mk_state "$LIVE_PID" local
touch "$W/out/round-ready"
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_forbidden.sh" bash "$GATE" >/dev/null 2>&1
check "live local round overrides stale ready marker -> shut" 1 $?
rm "$W/out/round-ready"
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_forbidden.sh" bash "$GATE" >/dev/null 2>&1
check "live local round without marker -> shut" 1 $?
check_file "no marker invented for live local round" absent "$W/out/round-ready"
kill "$LIVE_PID"; wait "$LIVE_PID" 2>/dev/null; LIVE_PID=""
check_file "live local round never called qstat" absent "$TMP/qstat_called"

fresh_work 7-empty
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_forbidden.sh" bash "$GATE" >/dev/null 2>&1
check "no local state or ready marker -> shut" 1 $?
check_file "no local marker invented without recorded round" absent "$W/out/round-ready"
check_file "empty local state never queried qstat" absent "$TMP/qstat_called"

# Forced local selects local even when the runner would reject missing inputs.
rm "$DEF14A_FILINGS/filing5.txt"
fresh_work 7-forced-missing
mk_state "$DEAD_PID" local
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_forbidden.sh" bash "$GATE" >/dev/null 2>&1
check "forced local with incomplete mirror still ignores grid" 0 $?
check_file "forced local never queried qstat" absent "$TMP/qstat_called"

# Both fallback predicates retain the un-recorded grid job guard.
for mode in auto 0; do
    echo "case 8: incomplete/forced grid ($mode), stray job queued"
    export DEF14A_LOCAL="$mode"
    fresh_work "8-$mode"
    mk_qstat_named def14a_py 40345207
    DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
    check "grid selection still blocks un-recorded job ($mode)" 1 $?
    check_file "grid selection does not invent marker ($mode)" absent "$W/out/round-ready"
done
# Explicit grid wins even over a complete mirror.
touch "$DEF14A_FILINGS/filing5.txt"
fresh_work 8-complete
DEF14A_WORK="$W" DEF14A_QSTAT="$TMP/qstat_stub.sh" bash "$GATE" >/dev/null 2>&1
check "explicit grid with complete mirror still blocks stray job" 1 $?

echo
echo "gate_test: $PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]] || exit 1
