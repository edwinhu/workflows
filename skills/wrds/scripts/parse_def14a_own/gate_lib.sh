# gate_lib.sh — the durable-gate bookkeeping run_baseline.sh writes and gate.sh reads.
#
# SOURCED, never executed. It lives in its own file for one reason: the recorder is
# half of the fix for the 2026-09-29 deadlock (gate.sh is the other half), and a
# function buried inside a script that needs ssh and a scheduler to reach it is a
# function no test can see. gate_test.sh sources this and drives it with real SGE
# qsub output, no grid.
#
# Contract, relied on by gate.sh:
#   $JOBS_TSV     jobid <TAB> label <TAB> epoch, one line per qsub, append-only
#   $STATE_JSON   pid / host / root / work / filelist / fetch_only / phase /
#                 job_ids / started_epoch / updated_epoch / updated
#
# Callers set: JOBS_TSV STATE_JSON HOST ROOT WORK FILELIST FETCH_ONLY START_EPOCH
# and may set GATE_PID (defaults to $$ — the test sets it so the recorded pid is
# not the test runner's).

gate_write_state() {
    PHASE="$1"
    local jobs
    jobs=$( [[ -s "$JOBS_TSV" ]] && cut -f1 "$JOBS_TSV" | paste -sd, - || true )
    cat > "$STATE_JSON" <<EOF
{
  "pid": ${GATE_PID:-$$},
  "host": "$HOST",
  "root": "$ROOT",
  "work": "$WORK",
  "filelist": "$FILELIST",
  "fetch_only": $FETCH_ONLY,
  "phase": "$PHASE",
  "job_ids": "$jobs",
  "started_epoch": $START_EPOCH,
  "updated_epoch": $(date +%s),
  "updated": "$(date -Is)"
}
EOF
}

# Reads a qsub stream on stdin, passes it through UNCHANGED, and records every job
# id the instant SGE prints it — which is BEFORE `-sync y` starts blocking. That
# timing is the whole point: a kill during the block still leaves the id on disk.
# Both SGE spellings are matched, single job and array:
#   Your job 40335942 ("run_python.sh") has been submitted
#   Your job-array 40335943.1-57:1 ("submit_shards.sh") has been submitted
gate_record_stream() {
    local label="$1" line
    while IFS= read -r line; do
        printf '%s\n' "$line"
        if [[ "$line" =~ [Yy]our\ job(-array)?\ ([0-9]+) ]]; then
            printf '%s\t%s\t%s\n' "${BASH_REMATCH[2]}" "$label" "$(date +%s)" >> "$JOBS_TSV"
            gate_write_state "$PHASE"
        fi
    done
}
