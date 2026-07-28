#!/bin/bash
#
# scan_shard_rg_awk.sh — Variant A.
#
# Single ripgrep invocation over the shard emits (path <TAB> line) pairs for
# header-relevant patterns; awk maintains per-path state and emits one TSV
# row per (role-block, CIK) just like the baseline scan_shard.sh.
#
# Hypothesis: rg's threadpool hides NFS open latency better than awk-per-file.
#
# Environment (same knobs as scan_shard.sh):
#   SGE_TASK_ID, SHARD_LIST, OUT_DIR, ARCHIVE_ROOT
#   RG_THREADS    — passes to rg -j (default: $NSLOTS or 4)
#
# Output TSV columns (same as baseline):
#   filepath \t form_type \t filed_date \t accession \t role \t cik

set -uo pipefail

SHARD_LIST="${SHARD_LIST:-shards.txt}"
WRDS_SCRATCH="${WRDS_SCRATCH:-/scratch/${WRDS_INST:-nyu}/$(whoami)}"
OUT_DIR="${OUT_DIR:-$WRDS_SCRATCH/sec_index}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"
RG_THREADS="${RG_THREADS:-${NSLOTS:-4}}"

mkdir -p "$OUT_DIR"

SHARD=$(sed -n "${TASK_ID}p" "$SHARD_LIST")
if [[ -z "$SHARD" ]]; then
    echo "ERROR: no shard at line $TASK_ID of $SHARD_LIST" >&2
    exit 2
fi

SHARD_DIR="$ARCHIVE_ROOT/$SHARD"
OUT_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").tsv.gz"
LOG_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").log"

echo "[scan_shard_rg_awk] task=$TASK_ID shard=$SHARD out=$OUT_FILE threads=$RG_THREADS start=$(date -Is)" >"$LOG_FILE"

if [[ ! -d "$SHARD_DIR" ]]; then
    echo "ERROR: shard dir missing: $SHARD_DIR" >>"$LOG_FILE"
    : | gzip >"$OUT_FILE"
    exit 0
fi

# rg walks the tree itself (respects globs). --field-match-separator \t makes
# the (path, line) boundary unambiguous so awk can split cleanly even when the
# matched line contains colons. --no-line-number drops the gratuitous counter.
# We intentionally let rg scan past </SEC-HEADER>; header hits dominate and the
# marker is captured so awk can stop consuming per-path state once seen.

find "$SHARD_DIR" -type f -name '*.txt' -print0 \
  | xargs -0 rg \
      --no-heading \
      -H \
      --no-line-number \
      --field-match-separator $'\t' \
      -j "$RG_THREADS" \
      -e '^[A-Z][A-Z0-9 /-]*:[[:space:]]*$' \
      -e '^ACCESSION NUMBER:' \
      -e '^CONFORMED SUBMISSION TYPE:' \
      -e '^FILED AS OF DATE:' \
      -e 'CENTRAL INDEX KEY:' \
      -e '</SEC-HEADER>' \
  | awk -F'\t' '
    function trim(s) { gsub(/^[ \t\r]+|[ \t\r]+$/, "", s); return s }
    function trim_colon(s) { gsub(/:[ \t\r]*$/, "", s); return trim(s) }
    function flush(path) {
        if (pending_role[path] != "" && pending_cik[path] != "") {
            printf "%s\t%s\t%s\t%s\t%s\t%s\n",
                path,
                form_type[path], filed_date[path], accession[path],
                pending_role[path], pending_cik[path]
        }
        pending_role[path] = ""
        pending_cik[path] = ""
    }
    {
        path = $1
        # Concatenate $2..NF in case the matched line itself had tabs.
        line = $2
        for (i = 3; i <= NF; i++) line = line "\t" $i

        if (done[path]) next
        if (index(line, "</SEC-HEADER>") > 0) {
            flush(path)
            done[path] = 1
            next
        }

        # Metadata (may appear before or after role blocks — all pre-header).
        if (match(line, /^ACCESSION NUMBER:[ \t]+([^ \t\r]+)/, m)) {
            accession[path] = m[1]; next
        }
        if (match(line, /^CONFORMED SUBMISSION TYPE:[ \t]+([^\r]+)/, m)) {
            form_type[path] = trim(m[1]); next
        }
        if (match(line, /^FILED AS OF DATE:[ \t]+([0-9]+)/, m)) {
            filed_date[path] = m[1]; next
        }

        # Role header: starts at column 0, token + colon only.
        if (line ~ /^[A-Z][A-Z0-9 \/-]*:[ \t\r]*$/) {
            flush(path)
            pending_role[path] = trim_colon(line)
            pending_cik[path] = ""
            next
        }

        # CIK line — first one per role block wins.
        if (pending_role[path] != "" && pending_cik[path] == "") {
            if (match(line, /CENTRAL INDEX KEY:[ \t]+([0-9]+)/, m)) {
                pending_cik[path] = m[1]
                # Emit immediately so we free the state slot.
                printf "%s\t%s\t%s\t%s\t%s\t%s\n",
                    path,
                    form_type[path], filed_date[path], accession[path],
                    pending_role[path], pending_cik[path]
                pending_role[path] = ""
                pending_cik[path] = ""
            }
        }
    }
    END {
        for (p in pending_role) flush(p)
    }
    ' | gzip >"$OUT_FILE"

STATUS=${PIPESTATUS[1]}   # awk status (rg status often 0/1 either way)
ROWS=$(gzip -dc "$OUT_FILE" | wc -l)
echo "[scan_shard_rg_awk] task=$TASK_ID status=$STATUS rows=$ROWS end=$(date -Is)" >>"$LOG_FILE"
exit 0
