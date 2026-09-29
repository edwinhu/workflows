#!/usr/bin/env python3
"""scan_sizes.py — stat every listed filing so shards can be packed on bytes.

`fsize` on wrds_forms is unusable for this (see parse_13f/sge/scan_sizes.py).
Stat the archive instead: NFS metadata reads are fast even when the bodies are
not.

Reads TAB-separated filelists whose FIRST field is the archive-relative path;
the remaining fields (cik, accession, form, fdate) are carried through
untouched, because the parser needs the filing date and build_shards.py must not
drop it.

Emits sizes.tsv: bucket <TAB> bytes <TAB> <the whole filelist line>

Run on a compute node, not the login host:
    qsub -pe onenode 2 -l m_mem_free=8G sge/run_python.sh sge/scan_sizes.py FILELIST_DIR
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
    with open(out_path, "w") as out, ThreadPoolExecutor(THREADS) as pool:
        for bucket in buckets:
            listing = os.path.join(filelist_dir, "filelist_%s.tsv" % bucket)
            lines = [ln.rstrip("\n") for ln in open(listing) if ln.strip()]
            for i in range(0, len(lines), BATCH):
                batch = lines[i : i + BATCH]
                paths = [ln.split("\t")[0] for ln in batch]
                for line, size in zip(batch, pool.map(size_of, paths)):
                    out.write("%s\t%d\t%s\n" % (bucket, size, line))
                    count += 1
                    if size > 0:
                        total += size
                    else:
                        missing += 1

    print(
        "files=%d missing=%d total_gb=%.2f mean_kb=%.1f -> %s"
        % (count, missing, total / 1024**3, total / max(count, 1) / 1024, out_path)
    )
    if missing:
        # A path in the index with no file behind it means the shard plan is
        # built on a filing the parser will then fail to read. Loud, not silent.
        raise SystemExit(
            "ERROR: %d listed filings are missing from %s" % (missing, ARCHIVE_ROOT)
        )


if __name__ == "__main__":
    main()
