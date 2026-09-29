#!/bin/bash
#
# run_baseline.sh — one full pass over the gold-linked filings on the WRDS grid,
# fetched back and scored.
#
# Build -> stage -> qsub array -> wait -> fetch -> score. Every step prints what
# it did; the SGE array is the only thing that touches /wrds/sec/archives, and
# nothing runs on the login node.
#
#   DEF14A_ROOT  scratch root on WRDS   (default /scratch/nyu/eddyhu/parse_def14a_own)
#   DEF14A_WORK  local work dir         (default /data/def14a_own/work)
#   GOLD_DIR     gold sets              (default /data/def14a_own/gold)
#   WRDS_HOST    ssh alias              (default wrds)
#
# The gold filelist (dev AND holdout filings — the parser sees both, the SCORER
# sees dev only) is $GOLD_DIR/gold_filelist.tsv, written by gold/make_holdout.py.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DEF14A_ROOT:-/scratch/nyu/eddyhu/parse_def14a_own}"
WORK="${DEF14A_WORK:-/data/def14a_own/work}"
GOLD="${GOLD_DIR:-/data/def14a_own/gold}"
HOST="${WRDS_HOST:-wrds}"

# The grind --gate watches this marker: while a round is in flight it is absent,
# the loop records a `wait` and spends no model call.
mkdir -p "$WORK/out"
rm -f "$WORK/out/round-ready"

echo "== build =="
(cd "$HERE/parse_def14a_own_go" && go vet ./... && go test ./... &&
 CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o parse_def14a_own_go .)

echo "== stage =="
ssh "$HOST" "mkdir -p $ROOT/{bin,filelists/shards,out,logs,sge}"
scp -q "$HERE"/sge/* "$HOST:$ROOT/sge/"
scp -q "$HERE/parse_def14a_own_go/parse_def14a_own_go" "$HOST:$ROOT/bin/"
scp -q "$GOLD/gold_filelist.tsv" "$HOST:$ROOT/filelists/filelist_gold.tsv"
ssh "$HOST" "chmod +x $ROOT/sge/*.sh $ROOT/bin/parse_def14a_own_go; echo gold > $ROOT/filelists/buckets.txt; rm -f $ROOT/out/*"

echo "== sizes (compute node) =="
ssh "$HOST" "cd $ROOT && qsub -sync y -pe onenode 2 -l m_mem_free=8G -o $ROOT/logs/scan_sizes.out sge/run_python.sh sge/scan_sizes.py $ROOT/filelists" >/dev/null
ssh "$HOST" "tail -2 $ROOT/logs/scan_sizes.out"

echo "== shards =="
ssh "$HOST" "cd $ROOT && python3 sge/build_shards.py filelists/sizes.tsv filelists/shards --target-mb 400"
NSHARD=$(ssh "$HOST" "wc -l < $ROOT/filelists/shards/chunks.txt")
echo "shards: $NSHARD"

echo "== array =="
ssh "$HOST" "cd $ROOT && qsub -sync y -t 1-$NSHARD sge/submit_shards.sh" | tail -3
ssh "$HOST" "grep -h '\[scan_shard\]' $ROOT/out/*.log | tail -5"
FAIL=$(ssh "$HOST" "grep -lh FAIL $ROOT/out/*.log 2>/dev/null | wc -l")
if [[ "$FAIL" != "0" ]]; then
    echo "ERROR: $FAIL shard(s) reported FAIL — see $ROOT/out/*.log" >&2
    exit 1
fi

echo "== fetch =="
mkdir -p "$WORK/out"
rm -f "$WORK"/out/*
scp -q "$HOST:$ROOT/out/*.tsv.gz" "$WORK/out/"
ROWS=$(zcat "$WORK"/out/*[0-9].tsv.gz | grep -vc '^accession' || true)
MAN=$(zcat "$WORK"/out/*.manifest.tsv.gz | grep -vc '^accession' || true)
FILES_IN=$(wc -l < "$GOLD/gold_filelist.tsv")
echo "ownership rows=$ROWS manifest rows=$MAN filelist rows=$FILES_IN"
if [[ "$MAN" != "$FILES_IN" ]]; then
    echo "ERROR: manifest rows ($MAN) != filings submitted ($FILES_IN)" >&2
    exit 1
fi

echo "== score (dev) =="
python3 "$HERE/scorer/score.py" \
    --rows "$WORK/out/*[0-9].tsv.gz" \
    --manifest "$WORK/out/*.manifest.tsv.gz" \
    --gold-dir "$GOLD" \
    --thresholds "$HERE/thresholds.json" \
    --lock "$HERE/lock.sha256" \
    --miss-report "$WORK/miss_dev.tsv" \
    --json-out "$WORK/metrics_dev.json" \
    "$@"

# The grind --gate waits on this marker: while it is absent the loop records a
# `wait` and spends nothing.
touch "$WORK/out/round-ready"
echo "== done: $WORK/out/round-ready =="
