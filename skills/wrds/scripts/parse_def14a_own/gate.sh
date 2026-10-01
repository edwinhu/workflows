#!/bin/bash
#
# gate.sh — the grind loop's --gate. Exit 0 = spend a model call, exit 1 = wait.
#
# WHY IT EXISTS. The gate used to be `test -f $WORK/out/round-ready`, and the only
# thing that ever re-created that marker was the tail of run_baseline.sh. Twice on
# 2026-09-29 a grind iteration ended while its round's SGE job was still queued:
# the iteration's process group died, `qsub -sync y` died with it, and the marker
# was therefore never written — so the loop waited forever on a file no surviving
# process was going to create. A gate whose open condition depends on a process
# that can be killed is not a gate, it is a deadlock with a timer.
#
# THE RULE. The gate is shut only while a round is DEMONSTRABLY in flight — a
# recorded SGE job still queued/running, or the recorded run_baseline.sh process
# still alive. Otherwise the gate opens, and if the marker is missing it is
# re-created with the reason written to $WORK/out/round-orphaned.
#
#   exit 0   round-ready exists                                      (normal)
#   exit 0   nothing recorded and no def14a job on the grid          (nothing to wait for)
#   exit 0   ORPHANED: no recorded job on the grid, no live pid      (marker re-created)
#   exit 1   a recorded job is still queued/running on the grid      (wait)
#   exit 1   the recorded run_baseline.sh pid is still alive         (wait)
#   exit 1   an UN-RECORDED job matching ^def14a is on the grid      (wait)
#   exit 1   the scheduler could not be reached                      (wait; a failed
#                                                                    query is not
#                                                                    evidence of a
#                                                                    finished job)
#
# Reads, and never writes, run_baseline.sh's bookkeeping:
#   $WORK/out/round-jobs.tsv     jobid <TAB> label <TAB> epoch
#   $WORK/out/round-state.json   pid, host, phase, job_ids, timestamps
#
# Environment
#   DEF14A_WORK      local work dir  (default /data/def14a_own/work)
#   WRDS_HOST        ssh alias       (default wrds)
#   DEF14A_QSTAT     command whose stdout is an SGE `qstat` listing; a recorded job
#                    id appearing in column 1 means still queued or running.
#                    Default: ssh $WRDS_HOST 'qstat -u $USER'. Overridden by the
#                    test with a stub, which is the only way to exercise the three
#                    branches without a scheduler.
#   DEF14A_JOB_NAME_RE  awk regex for column 3 of the listing, the job NAME, used to
#                    catch a round in flight that nothing recorded (default ^def14a;
#                    SGE truncates names to 10 chars, so def14a_own / def14a_py /
#                    def14a_sas all match).
#   DEF14A_GATE_QUIET=1  suppress the explanation on stdout (exit code only)
#
# Every branch prints WHY, and appends the same line to $WORK/out/round-gate.log:
# a gate that opens without saying why is how the last two hours were lost.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=gate_lib.sh
source "$HERE/gate_lib.sh"

WORK="${DEF14A_WORK:-/data/def14a_own/work}"
HOST="${WRDS_HOST:-wrds}"
QSTAT="${DEF14A_QSTAT:-ssh $HOST 'qstat -u \$USER'}"

OUT="$WORK/out"
READY="$OUT/round-ready"
JOBS_TSV="$OUT/round-jobs.tsv"
STATE_JSON="$OUT/round-state.json"
GATE_LOG="$OUT/round-gate.log"

say() {
    local code="$1"; shift
    mkdir -p "$OUT" 2>/dev/null
    printf '%s gate exit=%s %s\n' "$(date -Is)" "$code" "$*" >> "$GATE_LOG" 2>/dev/null
    [[ "${DEF14A_GATE_QUIET:-0}" == "1" ]] || printf 'gate: %s\n' "$*"
}

GOLD="${GOLD_DIR:-/data/def14a_own/gold}"
FILELIST="${DEF14A_FILELIST:-round_filelist.tsv}"
FILINGS="${DEF14A_FILINGS:-/data/def14a_own/filings}"
gate_select_mode "$GOLD/$FILELIST" "$FILINGS" || exit $?

# --- 1. the normal case ------------------------------------------------------
if (( ! LOCAL )) && [[ -f "$READY" ]]; then
    say 0 "open — $READY exists (round complete)"
    exit 0
fi

# --- 2. is the round's own process still alive? ------------------------------
# The recorded pid is checked against /proc rather than pgrep: `pgrep -f
# run_baseline` matches this gate's own command line under some launchers, and a
# gate that sees itself as the round it is waiting for never opens. A pid can be
# reused, so the cmdline is required to still name run_baseline.
PID=""
PHASE=""
if [[ -f "$STATE_JSON" ]]; then
    PID=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$STATE_JSON" | head -1)
    PHASE=$(sed -n 's/.*"phase"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_JSON" | head -1)
fi

pid_alive() {
    local pid="$1"
    [[ -n "$pid" ]] || return 1
    [[ -r "/proc/$pid/cmdline" ]] || return 1
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'run_baseline'
}

if pid_alive "$PID"; then
    say 1 "shut — run_baseline.sh pid $PID is alive (phase=$PHASE)"
    exit 1
fi

# A local round never fetches grid output. Only its recorded process and marker
# can block or release it; even a stale ready marker must not hide a live round.
if (( LOCAL )); then
    if [[ -f "$READY" ]]; then
        say 0 "open — $READY exists (local round complete)"
        exit 0
    fi
    if [[ ! -f "$STATE_JSON" || -z "$PID" ]]; then
        say 1 "shut — local round has no $READY and no recorded pid to recover"
        exit 1
    fi
    REASON="ORPHANED local round: run_baseline.sh pid $PID is gone and $READY was never written (last phase=${PHASE:-unknown})."
    ADVICE="Local output under $OUT may be partial or from the PREVIOUS round; rerun run_baseline.sh before trusting any metric. No grid output is fetched."
    mkdir -p "$OUT"
    {
        printf '%s\n' "$(date -Is)" "$REASON" "$ADVICE"
    } > "$OUT/round-orphaned"
    touch "$READY"
    say 0 "open — $REASON re-created $READY. $ADVICE"
    exit 0
fi

# --- 3. ask the scheduler -----------------------------------------------------
# Verified against the real listing 2026-09-30: column 1 is job-ID and column 3 is
# the (10-char-truncated) job name, so `def14a_own`, `def14a_py` and `def14a_sas`
# are all matched by ^def14a.
JOB_IDS=()
if [[ -s "$JOBS_TSV" ]]; then
    while IFS=$'\t' read -r jid _label _epoch; do
        [[ -n "${jid:-}" ]] && JOB_IDS+=("$jid")
    done < "$JOBS_TSV"
fi

LISTING=$(eval "$QSTAT" 2>/dev/null)
QRC=$?
if (( QRC != 0 )); then
    # A scheduler we cannot reach is NOT evidence that the job finished. Stay shut
    # and say so; the next poll asks again.
    say 1 "shut — cannot reach the scheduler (\`$QSTAT\` exit $QRC); refusing to call a round finished on a failed query"
    exit 1
fi

# --- 4. is any recorded SGE job still queued or running? ---------------------
for jid in "${JOB_IDS[@]+"${JOB_IDS[@]}"}"; do
    if printf '%s\n' "$LISTING" | awk -v j="$jid" '$1==j{found=1} END{exit !found}'; then
        say 1 "shut — SGE job $jid is still queued/running (phase=$PHASE)"
        exit 1
    fi
done

# --- 4b. an UN-RECORDED round in flight --------------------------------------
# A round submitted before this bookkeeping existed — or from a shell nobody
# recorded — is invisible to $JOBS_TSV but plainly visible on the grid. Matching
# the job NAME catches it, and is why switching --gate to this script is safe even
# while the orphaned 40335943 from 2026-09-30 00:19 is still queued.
JOB_NAME_RE="${DEF14A_JOB_NAME_RE:-^def14a}"
if printf '%s\n' "$LISTING" | awk -v re="$JOB_NAME_RE" '$3 ~ re {print $1; found=1} END{exit !found}' \
       > /dev/null; then
    stray=$(printf '%s\n' "$LISTING" | awk -v re="$JOB_NAME_RE" '$3 ~ re {print $1"/"$3}' | sort -u | paste -sd, -)
    say 1 "shut — a job matching $JOB_NAME_RE is on the grid but not in $JOBS_TSV: $stray (an un-recorded round is in flight)"
    exit 1
fi

# --- 5. nothing is in flight -------------------------------------------------
if [[ ! -s "$JOBS_TSV" && ! -f "$STATE_JSON" ]]; then
    # No round was ever recorded and the grid is clear. Open the gate so the loop
    # can act, but invent NO marker: there is no output to claim is current.
    say 0 "open — no round recorded ($STATE_JSON absent) and no $JOB_NAME_RE job on the grid; nothing in flight to wait for"
    exit 0
fi

REASON="ORPHANED round: run_baseline.sh pid ${PID:-none} is gone, recorded SGE job(s) [${JOB_IDS[*]+${JOB_IDS[*]}}] are no longer on the grid, and $READY was never written (last phase=${PHASE:-unknown})."
ADVICE="The parser output under $OUT may therefore be the PREVIOUS round's: gate.sh does not fetch. If phase was 'array' or earlier, the grid output was never brought home — run 'bash run_baseline.sh --fetch-only' before trusting any metric."
{
    printf '%s\n' "$(date -Is)"
    printf '%s\n' "$REASON"
    printf '%s\n' "$ADVICE"
} > "$OUT/round-orphaned"
touch "$READY"
say 0 "open — $REASON re-created $READY. $ADVICE"
exit 0
