#!/bin/bash
#
# run_baseline.sh — one full pass over the gold-linked filings on the WRDS grid,
# fetched back and scored.
#
# Build -> local shards OR stage/qsub/wait/fetch -> score.
#   DEF14A_LOCAL=1 forces local; =0 forces grid; unset auto-selects local only
#   when every round filing exists under DEF14A_FILINGS (default below).
#   DEF14A_LOCAL_PROCESSES defaults to 28 single-core, single-filing workers.
#   --fetch-only always fetches grid output, regardless of local settings.
#
#   DEF14A_ROOT  scratch root on WRDS   (default /scratch/nyu/eddyhu/parse_def14a_own)
#   DEF14A_WORK  local work dir         (default /data/def14a_own/work)
#   GOLD_DIR     gold sets              (default /data/def14a_own/gold)
#   WRDS_HOST    ssh alias              (default wrds)
#   DEF14A_FILELIST  which filelist under $GOLD_DIR to submit
#                    (default round_filelist.tsv — the UNION of the blockw/factset
#                     filelist, the ISS one, and the fixed full-archive sample)
#
# THE GATE MUST NOT DEPEND ON THIS PROCESS SURVIVING. Twice on 2026-09-29 a grind
# iteration ended while the round's SGE job was still queued; the iteration's
# process group died, `qsub -sync y` died with it, and `$WORK/out/round-ready` was
# therefore never re-created — so the loop waited on a marker nothing was left to
# write, forever. Every qsub below now records its job id and this script's pid in
#
#   $WORK/out/round-jobs.tsv     jobid <TAB> label <TAB> epoch   (append-only)
#   $WORK/out/round-state.json   pid, host, root, phase, jobs, timestamps
#
# BEFORE it starts waiting, so `gate.sh` can ask the grid and the process table
# what actually happened and open the gate itself. See gate.sh.
#
# MODES
#   bash run_baseline.sh [score args...]              full round (build/stage/submit/fetch/score)
#   bash run_baseline.sh --fetch-only [score args...] skip build+submit; fetch $ROOT/out and score
#                                                    (this is how an ORPHANED round whose grid
#                                                    job finished is brought home)
#
# EVERY ROUND PARSES BOTH GOLD FILELISTS, THE SAMPLE AND THE REGRESSION SET. `iss_director_recall` is
# gated as of 2026-09-29, and the three sample metrics were gated the same day; a
# gated rate scored over only the filings that happened to be submitted is a rate
# over a denominator the round chose. The submitted filelist is therefore asserted
# below to cover $GOLD_DIR/gold_filelist.tsv (blockw/factset, dev AND holdout
# filings — the parser sees both, the SCORER sees dev only),
# $GOLD_DIR/gold_iss_filelist.tsv (ISS, likewise), $GOLD_DIR/sample_full.tsv
# (the seed-20260929 year-stratified sample) and $GOLD_DIR/regress_filelist.tsv
# (the fixed panel-diff regression set, 2026-09-29), and the run aborts if it does
# not.
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

FETCH_ONLY=0
if [[ "${1:-}" == "--fetch-only" ]]; then
    FETCH_ONLY=1
    shift
fi

# --- durable gate bookkeeping -------------------------------------------------
# Written BEFORE any wait, so a killed round is still reconstructable. `gate.sh`
# is the only reader.
mkdir -p "$WORK/out"
JOBS_TSV="$WORK/out/round-jobs.tsv"
STATE_JSON="$WORK/out/round-state.json"
PHASE="start"
START_EPOCH=$(date +%s)
# shellcheck source=gate_lib.sh
source "$HERE/gate_lib.sh"

# The grind --gate watches this marker: while a round is in flight it is absent,
# the loop records a `wait` and spends no model call. It is re-created at the end
# of EVERY round, including a round whose scorer reports a gated metric short —
# and, if this process is killed mid-round, by gate.sh once the grid is clear.
rm -f "$WORK/out/round-ready" "$WORK/out/round-orphaned"
: > "$JOBS_TSV"
gate_write_state "start"

echo "== filelist coverage =="
# Both gold filelists must be covered, or the round scores a gated ISS recall
# over a partial denominator. Compared on the archive path (column 1) because the
# union file tags the 90 shared filings with their blockw/factset source, so the
# whole LINE differs for a filing that is present in both.
for req in gold_filelist.tsv gold_iss_filelist.tsv sample_full.tsv regress_filelist.tsv; do
    if [[ ! -f "$GOLD/$req" ]]; then
        echo "ERROR: required gold filelist $GOLD/$req is missing" >&2
        exit 1
    fi
    n_missing=$(comm -23 <(cut -f1 "$GOLD/$req" | sort -u) \
                         <(cut -f1 "$GOLD/$FILELIST" | sort -u) | wc -l)
    echo "  $req: $(wc -l < "$GOLD/$req") filings, $n_missing not covered by $FILELIST"
    if [[ "$n_missing" != "0" ]]; then
        echo "ERROR: $FILELIST does not cover $req ($n_missing filings missing)." >&2
        echo "       Every round must parse BOTH gold filelists, the fixed" >&2
        echo "       full-archive sample AND the fixed regression set; use" >&2
        echo "       round_filelist.tsv, rebuilt by gold/build_regress_set.py." >&2
        exit 1
    fi
done

if (( FETCH_ONLY )); then
    echo "== --fetch-only: skipping build/stage/submit; bringing $HOST:$ROOT/out home =="
    gate_write_state "fetch"
else

echo "== build =="
# -buildvcs=false is NOT optional. Without it `go build` stamps vcs.revision,
# vcs.time and vcs.modified into the binary, so the same source built at two
# commits produces two different sha256s of the same length — which is exactly
# why the binary looked "modified" after the full-archive run. With it the build
# is reproducible: identical source gives an identical binary whatever the repo
# state (measured 2026-09-29, three builds, sha256 beb332f1…).
(cd "$HERE/parse_def14a_own_go" && go vet ./... && go test ./... &&
 CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -o parse_def14a_own_go .)

LOCAL=0
FILINGS="${DEF14A_FILINGS:-/data/def14a_own/filings}"
case "${DEF14A_LOCAL:-auto}" in
    0) ;;
    1|auto)
        if python3 - "$GOLD/$FILELIST" "$FILINGS" <<'PY'
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
paths = [line.split('\t', 1)[0] for line in Path(sys.argv[1]).read_text().splitlines()]
root = Path(sys.argv[2])
with ThreadPoolExecutor(max_workers=28) as pool:
    present = sum(pool.map(lambda p: (root / p).is_file(), paths))
print("local coverage: listed=%d present=%d missing=%d" % (len(paths), present, len(paths)-present))
sys.exit(0 if paths and present == len(paths) else 1)
PY
        then
            LOCAL=1
        elif [[ "${DEF14A_LOCAL:-auto}" == "1" ]]; then
            echo "ERROR: missing local filings under $FILINGS; refusing forced local round" >&2
            exit 1
        fi
        ;;
    *) echo "ERROR: DEF14A_LOCAL must be 0, 1 or auto" >&2; exit 2 ;;
esac

if (( LOCAL )); then
    echo "== local shards =="
    gate_write_state "local"
    bash "$HERE/local_shards.sh" "$GOLD/$FILELIST" "$FILINGS" "$WORK"
else

echo "== stage =="
ssh "$HOST" "mkdir -p $ROOT/{bin,filelists/shards,out,logs,sge}"
scp -q "$HERE"/sge/* "$HOST:$ROOT/sge/"
scp -q "$HERE/parse_def14a_own_go/parse_def14a_own_go" "$HOST:$ROOT/bin/"
echo "filelist: $GOLD/$FILELIST ($(wc -l < "$GOLD/$FILELIST") filings)"
scp -q "$GOLD/$FILELIST" "$HOST:$ROOT/filelists/filelist_gold.tsv"
ssh "$HOST" "chmod +x $ROOT/sge/*.sh $ROOT/bin/parse_def14a_own_go; echo gold > $ROOT/filelists/buckets.txt; rm -f $ROOT/out/*"

echo "== sizes (compute node) =="
gate_write_state "sizes"
ssh "$HOST" "cd $ROOT && qsub -sync y -pe onenode 2 -l m_mem_free=8G -o $ROOT/logs/scan_sizes.out sge/run_python.sh sge/scan_sizes.py $ROOT/filelists" \
    | gate_record_stream scan_sizes >/dev/null
ssh "$HOST" "tail -2 $ROOT/logs/scan_sizes.out"

echo "== shards =="
ssh "$HOST" "cd $ROOT && python3 sge/build_shards.py filelists/sizes.tsv filelists/shards --target-mb 400"
NSHARD=$(ssh "$HOST" "wc -l < $ROOT/filelists/shards/chunks.txt")
echo "shards: $NSHARD"

echo "== array =="
gate_write_state "array"
ssh "$HOST" "cd $ROOT && qsub -sync y -t 1-$NSHARD sge/submit_shards.sh" \
    | gate_record_stream shard_array | tail -3
ssh "$HOST" "grep -h '\[scan_shard\]' $ROOT/out/*.log | tail -5"
FAIL=$(ssh "$HOST" "grep -lh FAIL $ROOT/out/*.log 2>/dev/null | wc -l")
if [[ "$FAIL" != "0" ]]; then
    echo "ERROR: $FAIL shard(s) reported FAIL — see $ROOT/out/*.log" >&2
    exit 1
fi

fi   # local/grid
fi   # end of the build/stage/submit block skipped by --fetch-only

echo "== fetch =="
gate_write_state "fetch"
mkdir -p "$WORK/out" "$WORK/shard_logs"
# The shard logs land OUTSIDE $WORK/out on purpose: clearing the last pass is a
# glob over $WORK/out, and a directory in there makes that line fail under `set -e`.
# The glob is *.tsv.gz and NOT `*`: round-jobs.tsv / round-state.json live in the
# same directory and are what gate.sh reads if this process is killed.
if [[ "${LOCAL:-0}" == "0" ]]; then
    rm -f "$WORK"/out/*.tsv.gz "$WORK"/shard_logs/*
    scp -q "$HOST:$ROOT/out/*.tsv.gz" "$WORK/out/"
    scp -q "$HOST:$ROOT/out/*.log" "$WORK/shard_logs/"
else
    echo "local output already under $WORK/out; skipping grid fetch"
fi
ROWS=$(zcat "$WORK"/out/*[0-9].tsv.gz | grep -vc '^accession' || true)
MAN=$(zcat "$WORK"/out/*.manifest.tsv.gz | grep -vc '^accession' || true)
FILES_IN=$(wc -l < "$GOLD/$FILELIST")
echo "ownership rows=$ROWS manifest rows=$MAN filelist rows=$FILES_IN"
if [[ "$MAN" != "$FILES_IN" ]]; then
    echo "ERROR: manifest rows ($MAN) != filings submitted ($FILES_IN)" >&2
    exit 1
fi

# --- DIAGNOSTIC, NEVER GATED: parser wall time per shard -----------------------
# The 31 duplicate-round commits made the parser 1.30x slower shard-paired over the
# full archive (22,907 s -> 29,683 s, worst on the late-era HTML shards), so every
# round prints what it cost. It is REPORTED and never gated: a wall-time ceiling
# would pay the loop to stop parsing.
echo "== wall time per shard (diagnostic, not gated) =="
python3 - "$WORK/shard_logs" "$WORK/shard_wall.tsv" <<'PY'
import glob, os, re, statistics, sys
logs, out = sys.argv[1], sys.argv[2]
rows = []
for p in sorted(glob.glob(os.path.join(logs, "*.log"))):
    txt = open(p, errors="replace").read()
    m = re.search(r"shard=(\S+) status=(\d+) files=(\d+) ownership_rows=(\d+) "
                  r"manifest_rows=(\d+) wall=(\d+)s", txt)
    if not m:
        print("  NO wall= line in %s (shard failed or still running)" % os.path.basename(p))
        continue
    rows.append((m.group(1), int(m.group(3)), int(m.group(4)), int(m.group(6))))
rows.sort()
with open(out, "w") as fh:
    fh.write("shard\tfiles\townership_rows\twall_s\n")
    for r in rows:
        fh.write("%s\t%d\t%d\t%d\n" % r)
if not rows:
    print("  no shard logs parsed — nothing to report")
    raise SystemExit(0)
w = [r[3] for r in rows]
print("  shards=%d  total=%ds  median=%ds  max=%ds  mean=%.1fs" % (
    len(w), sum(w), int(statistics.median(w)), max(w), sum(w) / len(w)))
print("  slowest five (shard, files, rows, wall_s):")
for r in sorted(rows, key=lambda r: -r[3])[:5]:
    print("    %-12s files=%-6d rows=%-8d wall=%ds" % r)
print("  [out] %s" % out)
PY

echo "== score (dev) =="
gate_write_state "score"
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
    --regress-report "$WORK/regress_dev.tsv" \
    --json-out "$WORK/metrics_dev.json" \
    "$@"
SCORE_EXIT=$?
set -e

# The grind --gate waits on this marker: while it is absent the loop records a
# `wait` and spends nothing.
touch "$WORK/out/round-ready"
gate_write_state "done"
echo "== done: $WORK/out/round-ready (score exit $SCORE_EXIT) =="
exit "$SCORE_EXIT"
