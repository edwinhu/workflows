#!/bin/bash
# Local transport for the unchanged grid worker; one core and one filing per process.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILELIST="${1:?filelist required}"
FILINGS="${2:?filings root required}"
WORK="${3:?work directory required}"
PROCESSES="${DEF14A_LOCAL_PROCESSES:-28}"
if [[ ! "$PROCESSES" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: DEF14A_LOCAL_PROCESSES must be a positive integer" >&2
    exit 2
fi
mkdir -p "$WORK/local_shards" "$WORK/out" "$WORK/shard_logs"
python3 - "$FILELIST" "$FILINGS" "$WORK/local_sizes.tsv" <<'PY'
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
lines = Path(sys.argv[1]).read_text().splitlines()
root = Path(sys.argv[2])
def size(line):
    return (root / line.split('\t', 1)[0]).stat().st_size
with ThreadPoolExecutor(max_workers=28) as pool:
    sizes = list(pool.map(size, lines))
with open(sys.argv[3], 'w') as out:
    for n, line in sorted(zip(sizes, lines), key=lambda pair: pair[1]):
        out.write('gold\t%d\t%s\n' % (n, line))
print('local sizes: files=%d bytes=%d' % (len(lines), sum(sizes)))
PY
python3 "$HERE/sge/build_shards.py" "$WORK/local_sizes.tsv" "$WORK/local_shards" --target-mb 400
export SHARD_DIR="$WORK/local_shards"
export SHARD_LIST="$SHARD_DIR/chunks.txt"
export OUT_DIR="$WORK/out"
export BIN="$HERE/parse_def14a_own_go/parse_def14a_own_go"
export ARCHIVE_ROOT="$FILINGS"
export NSLOTS=1 CONCURRENCY=1
rm -f "$WORK"/out/*.tsv.gz "$WORK"/out/*.log "$WORK"/shard_logs/*.log
echo "local workers=$PROCESSES shards=$(wc -l < "$SHARD_LIST")"
seq 1 "$(wc -l < "$SHARD_LIST")" | xargs -r -P "$PROCESSES" -I '{}' \
    env SGE_TASK_ID='{}' bash "$HERE/sge/scan_shard.sh"
mv "$WORK"/out/*.log "$WORK/shard_logs/"
