#!/usr/bin/env python3
"""scan_sizes.py — stat every listed filing so shards can be packed on bytes.

`fsize` on wrds_forms is unusable for this: it is populated for older filings
and collapses for recent ones (2021Q2 reports 0.016 GB across 6,307 filings,
about 2.6 KB each, against a true ~1 GB). Stat the archive instead. It is
cheap — 248,500 files in 7 seconds with 48 threads, because NFS metadata reads
are fast even when the file bodies are not.

Emits sizes.tsv: bucket <TAB> archive-relative-path <TAB> bytes

Run on a compute node, not the login host, which has a low memory ceiling:
    qsub -pe onenode 2 -l m_mem_free=8G run_python.sh scan_sizes.py FILELIST_DIR
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor

ARCHIVE_ROOT = os.environ.get("ARCHIVE_ROOT", "/wrds/sec/archives")
BATCH = 2000
THREADS = 48


def main() -> None:
    filelist_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    buckets = [
        line.strip()
        for line in open(os.path.join(filelist_dir, "buckets.txt"))
        if line.strip()
    ]

    def size_of(path: str) -> int:
        try:
            return os.path.getsize(os.path.join(ARCHIVE_ROOT, path))
        except OSError:
            return -1

    total = count = missing = 0
    out_path = os.path.join(filelist_dir, "sizes.tsv")
    # Stream in batches: materialising 248k futures at once exhausts memory on
    # the smaller nodes.
    with open(out_path, "w") as out, ThreadPoolExecutor(THREADS) as pool:
        for bucket in buckets:
            listing = os.path.join(filelist_dir, "filelist_%s.txt" % bucket)
            paths = [line.strip() for line in open(listing) if line.strip()]
            for i in range(0, len(paths), BATCH):
                batch = paths[i : i + BATCH]
                for path, size in zip(batch, pool.map(size_of, batch)):
                    out.write("%s\t%s\t%d\n" % (bucket, path, size))
                    count += 1
                    if size > 0:
                        total += size
                    else:
                        missing += 1

    print(
        "files=%d missing=%d total_gb=%.2f mean_kb=%.1f -> %s"
        % (count, missing, total / 1024**3, total / count / 1024, out_path)
    )
    if missing:
        # A path in the index with no file behind it means the shard plan is
        # built on a filing the parser will then fail to read.
        raise SystemExit("ERROR: %d listed filings are missing from %s" % (missing, ARCHIVE_ROOT))


if __name__ == "__main__":
    main()
