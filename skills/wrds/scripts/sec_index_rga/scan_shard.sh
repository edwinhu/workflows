#!/bin/bash
#
# scan_shard.sh — SGE task that scans one top-level SEC archive shard
# and emits one TSV row per (accession, role, CIK) block in SGML headers.
#
# Environment:
#   SGE_TASK_ID   — 1-based task index into SHARD_LIST
#   SHARD_LIST    — path to newline-separated shard prefixes (default: ./shards.txt)
#   OUT_DIR       — gzipped TSV output dir (default: /scratch/nyu/eddyhu/sec_index)
#   ARCHIVE_ROOT  — (default: /wrds/sec/archives)
#
# Invoke manually:
#   SGE_TASK_ID=1 SHARD_LIST=shards.txt bash scan_shard.sh
#
# Columns: filepath \t form_type \t filed_date \t accession \t role \t cik
#
# Parse strategy: read first 4 KB of each .txt file. Role headers like
# "ISSUER:", "REPORTING-OWNER:", "FILER:", "SUBJECT COMPANY:", "FILED BY:",
# "FILED FOR:", "SECURITIZER:" begin at column 0. After each, the FIRST
# "CENTRAL INDEX KEY:" line gives the CIK for that role. One row per role block.

set -uo pipefail

SHARD_LIST="${SHARD_LIST:-shards.txt}"
OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/sec_index}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

mkdir -p "$OUT_DIR"

SHARD=$(sed -n "${TASK_ID}p" "$SHARD_LIST")
if [[ -z "$SHARD" ]]; then
    echo "ERROR: no shard at line $TASK_ID of $SHARD_LIST" >&2
    exit 2
fi

SHARD_DIR="$ARCHIVE_ROOT/$SHARD"
OUT_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").tsv.gz"
LOG_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").log"

echo "[scan_shard] task=$TASK_ID shard=$SHARD out=$OUT_FILE start=$(date -Is)" >"$LOG_FILE"

if [[ ! -d "$SHARD_DIR" ]]; then
    echo "ERROR: shard dir missing: $SHARD_DIR" >>"$LOG_FILE"
    : | gzip >"$OUT_FILE"
    exit 0
fi

# Find all .txt files under shard; feed to awk which reads only first 4KB per file.
# xargs chunks file args to keep argv reasonable.
# Using head -c 4096 per file is too process-heavy; awk natively limits by byte count.

find "$SHARD_DIR" -type f -name '*.txt' -print0 | \
    xargs -0 -n 200 awk '
    BEGIN {
        IGNORECASE = 1
        HEADER_BYTES = 4096
    }
    FNR == 1 {
        # Flush any pending state from previous file
        if (pending_role != "" && pending_cik != "") {
            emit_row()
        }
        reset_file()
        filepath = FILENAME
        bytes_read = 0
    }
    {
        bytes_read += length($0) + 1
        if (bytes_read > HEADER_BYTES) { nextfile }
        if (index($0, "</SEC-HEADER>") > 0) {
            if (pending_role != "" && pending_cik != "") emit_row()
            reset_file()
            nextfile
        }

        # Top-level metadata (indented with tabs in source; match anywhere)
        if (match($0, /ACCESSION NUMBER:[ \t]+([^ \t\r]+)/, m)) { accession = m[1] }
        else if (match($0, /CONFORMED SUBMISSION TYPE:[ \t]+([^\r]+)/, m)) { form_type = trim(m[1]) }
        else if (match($0, /FILED AS OF DATE:[ \t]+([0-9]+)/, m)) { filed_date = m[1] }

        # Role header: line that starts (col 0) with one of the known role tokens ending in ":"
        # e.g. "ISSUER:", "REPORTING-OWNER:", "FILER:", "SUBJECT COMPANY:",
        # "FILED BY:", "FILED FOR:", "SECURITIZER:", "DEPOSITOR:", "ISSUING ENTITY:"
        if ($0 ~ /^[A-Z][A-Z0-9 \/-]*:[ \t]*$/) {
            # Emit any pending block before starting a new role
            if (pending_role != "" && pending_cik != "") emit_row()
            pending_role = trim_colon($0)
            pending_cik = ""
            next
        }

        # CIK line — take FIRST one per role block
        if (pending_role != "" && pending_cik == "") {
            if (match($0, /CENTRAL INDEX KEY:[ \t]+([0-9]+)/, m)) {
                pending_cik = m[1]
            }
        }
    }
    ENDFILE {
        if (pending_role != "" && pending_cik != "") emit_row()
        # File done — flush pending
    }
    function trim(s) { gsub(/^[ \t\r]+|[ \t\r]+$/, "", s); return s }
    function trim_colon(s) { gsub(/:[ \t]*$/, "", s); return trim(s) }
    function reset_file() {
        accession = ""; form_type = ""; filed_date = ""
        pending_role = ""; pending_cik = ""
    }
    function emit_row() {
        printf "%s\t%s\t%s\t%s\t%s\t%s\n", \
            filepath, form_type, filed_date, accession, pending_role, pending_cik
        pending_role = ""
        pending_cik = ""
    }
    ' | gzip >"$OUT_FILE"

STATUS=${PIPESTATUS[0]}
ROWS=$(gzip -dc "$OUT_FILE" | wc -l)
echo "[scan_shard] task=$TASK_ID status=$STATUS rows=$ROWS end=$(date -Is)" >>"$LOG_FILE"
exit 0
