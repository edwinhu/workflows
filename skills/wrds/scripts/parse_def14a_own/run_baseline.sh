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
#   DEF14A_FILELIST  which filelist under $GOLD_DIR to submit
#                    (default round_filelist.tsv — the UNION of the blockw/factset
#                     filelist, the ISS one, and the fixed full-archive sample)
#
# EVERY ROUND PARSES BOTH GOLD FILELISTS AND THE SAMPLE. `iss_director_recall` is
# gated as of 2026-09-29, and the three sample metrics were gated the same day; a
# gated rate scored over only the filings that happened to be submitted is a rate
# over a denominator the round chose. The submitted filelist is therefore asserted
# below to cover $GOLD_DIR/gold_filelist.tsv (blockw/factset, dev AND holdout
# filings — the parser sees both, the SCORER sees dev only),
# $GOLD_DIR/gold_iss_filelist.tsv (ISS, likewise) and $GOLD_DIR/sample_full.tsv
# (the seed-20260929 year-stratified sample), and the run aborts if it does not.
#
# Extending the filelist is additive: score.py keys on (cik, accession) and
# ignores rows for filings that are not in the gold set it is scoring, so a
# superset filelist leaves every existing metric unchanged.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DEF14A_ROOT:-/scratch/nyu/eddyhu/parse_def14a_own}"
WORK="${DEF14A_WORK:-/data/def14a_own/work}"
GOLD="${GOLD_DIR:-/data/def14a_own/gold}"
HOST="${WRDS_HOST:-wrds}"
FILELIST="${DEF14A_FILELIST:-round_filelist.tsv}"

# The grind --gate watches this marker: while a round is in flight it is absent,
# the loop records a `wait` and spends no model call. It is re-created at the end
# of EVERY round, including a round whose scorer reports a gated metric short.
mkdir -p "$WORK/out"
rm -f "$WORK/out/round-ready"

echo "== filelist coverage =="
# Both gold filelists must be covered, or the round scores a gated ISS recall
# over a partial denominator. Compared on the archive path (column 1) because the
# union file tags the 90 shared filings with their blockw/factset source, so the
# whole LINE differs for a filing that is present in both.
for req in gold_filelist.tsv gold_iss_filelist.tsv sample_full.tsv; do
    if [[ ! -f "$GOLD/$req" ]]; then
        echo "ERROR: required gold filelist $GOLD/$req is missing" >&2
        exit 1
    fi
    n_missing=$(comm -23 <(cut -f1 "$GOLD/$req" | sort -u) \
                         <(cut -f1 "$GOLD/$FILELIST" | sort -u) | wc -l)
    echo "  $req: $(wc -l < "$GOLD/$req") filings, $n_missing not covered by $FILELIST"
    if [[ "$n_missing" != "0" ]]; then
        echo "ERROR: $FILELIST does not cover $req ($n_missing filings missing)." >&2
        echo "       Every round must parse BOTH gold filelists AND the fixed" >&2
        echo "       full-archive sample; use round_filelist.tsv." >&2
        exit 1
    fi
done

echo "== build =="
# -buildvcs=false is NOT optional. Without it `go build` stamps vcs.revision,
# vcs.time and vcs.modified into the binary, so the same source built at two
# commits produces two different sha256s of the same length — which is exactly
# why the binary looked "modified" after the full-archive run. With it the build
# is reproducible: identical source gives an identical binary whatever the repo
# state (measured 2026-09-29, three builds, sha256 beb332f1…).
(cd "$HERE/parse_def14a_own_go" && go vet ./... && go test ./... &&
 CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -o parse_def14a_own_go .)

echo "== stage =="
ssh "$HOST" "mkdir -p $ROOT/{bin,filelists/shards,out,logs,sge}"
scp -q "$HERE"/sge/* "$HOST:$ROOT/sge/"
scp -q "$HERE/parse_def14a_own_go/parse_def14a_own_go" "$HOST:$ROOT/bin/"
echo "filelist: $GOLD/$FILELIST ($(wc -l < "$GOLD/$FILELIST") filings)"
scp -q "$GOLD/$FILELIST" "$HOST:$ROOT/filelists/filelist_gold.tsv"
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
FILES_IN=$(wc -l < "$GOLD/$FILELIST")
echo "ownership rows=$ROWS manifest rows=$MAN filelist rows=$FILES_IN"
if [[ "$MAN" != "$FILES_IN" ]]; then
    echo "ERROR: manifest rows ($MAN) != filings submitted ($FILES_IN)" >&2
    exit 1
fi

echo "== score (dev) =="
# The scorer's exit code is captured rather than allowed to abort the script: a
# round whose gated metric is short (exit 1 under --check) has still produced the
# output the loop must be able to read, so the marker is written either way and
# the scorer's code is propagated afterwards.
set +e
python3 "$HERE/scorer/score.py" \
    --rows "$WORK/out/*[0-9].tsv.gz" \
    --manifest "$WORK/out/*.manifest.tsv.gz" \
    --gold-dir "$GOLD" \
    --thresholds "$HERE/thresholds.json" \
    --lock "$HERE/lock.sha256" \
    --miss-report "$WORK/miss_dev.tsv" \
    --iss-miss-report "$WORK/miss_iss_dev.tsv" \
    --sample-report "$WORK/sample_by_year.tsv" \
    --json-out "$WORK/metrics_dev.json" \
    "$@"
SCORE_EXIT=$?
set -e

# The grind --gate waits on this marker: while it is absent the loop records a
# `wait` and spends nothing.
touch "$WORK/out/round-ready"
echo "== done: $WORK/out/round-ready (score exit $SCORE_EXIT) =="
exit "$SCORE_EXIT"
