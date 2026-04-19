#!/usr/bin/env bash
# Step 2: Download 540K Form 3/4/5 XMLs from WRDS via server-side tar.
#
# Rationale: 540K individual rclone SFTP transfers takes hours. Tarring
# server-side and pulling one archive is ~10 min (one sequential
# stream, resumable by rclone).
#
# Source: /wrds/sec/archives/ (raw SGML) — Form 4 XMLs are embedded in
# an SGML wrapper. We need the XML, so pull raw archives (not
# wrds_clean_filings which strips the XML structure).
#
# Usage:
#   bash scripts/form4_step2_download_xmls.sh
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
FILES_FROM="$PROJ/data/raw/form4_xmls/files_to_download.txt"
OUTPUT_DIR="$PROJ/data/raw/form4_xmls/filings"

if [[ ! -f "$FILES_FROM" ]]; then
    echo "ERROR: $FILES_FROM not found. Run form4_step1_query_filings.py first."
    exit 1
fi

N_FILES=$(wc -l < "$FILES_FROM")
echo "Files to download: $N_FILES"

WRDS_USER="$(ssh wrds whoami)"
WRDS_SCRATCH="/scratch/nyu/$WRDS_USER"
TS=$(date +%s)
REMOTE_TMP="$WRDS_SCRATCH/form4_xmls_$TS.tar.gz"
REMOTE_LIST="/tmp/form4_files_$TS.txt"

mkdir -p "$OUTPUT_DIR"

echo "1/5: Upload file list to WRDS…"
scp "$FILES_FROM" "wrds:$REMOTE_LIST"

echo "2/5: Prepare scratch dir on WRDS…"
ssh wrds "mkdir -p $WRDS_SCRATCH"

echo "3/5: Create tar.gz on WRDS server (may take 10-30 min)…"
# Fork tar in background, wait on PID
ssh wrds "nohup bash -c 'cd /wrds/sec/archives && tar czf $REMOTE_TMP -T $REMOTE_LIST' > $WRDS_SCRATCH/tar_$TS.log 2>&1 &
echo PID=\$!"

# Poll every 60s
echo "Waiting for tar to complete…"
while ssh wrds "pgrep -f 'tar czf.*form4_xmls_$TS' > /dev/null 2>&1"; do
    size=$(ssh wrds "ls -lh $REMOTE_TMP 2>/dev/null | awk '{print \$5}'" || echo "starting…")
    echo "  archive size: ${size:-starting…}"
    sleep 60
done
ssh wrds "ls -lh $REMOTE_TMP"

echo "4/5: Download archive via rclone…"
rclone copy "wrds:$REMOTE_TMP" "$OUTPUT_DIR" \
    --stats 30s --stats-one-line --retries 3 --low-level-retries 10

echo "5/5: Extract locally…"
cd "$OUTPUT_DIR"
ARCHIVE="$(basename "$REMOTE_TMP")"
tar xzf "$ARCHIVE"
rm "$ARCHIVE"

echo "Cleanup remote…"
ssh wrds "rm -f $REMOTE_TMP $REMOTE_LIST"

N_EXTRACTED=$(find "$OUTPUT_DIR" -name "*.txt" | wc -l)
echo "Done: $N_EXTRACTED XMLs extracted to $OUTPUT_DIR"
