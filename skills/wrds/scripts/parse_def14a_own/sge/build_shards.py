#!/usr/bin/env python3
"""build_shards.py — byte-balanced shard lists for the DEF 14A ownership scrape.

Shard key is BYTES, not filings. Filings are listed in archive-path order,
archive path is CIK order, and CIK order correlates with filer size, so equal-
COUNT chunks give a wide spread in task duration (measured 2x on parse_13f).

Shards are built WITHIN each bucket (filing year) so the output stays
year-partitioned.

Inputs
    sizes.tsv   bucket <TAB> bytes <TAB> relpath <TAB> cik <TAB> accession
                <TAB> form <TAB> fdate      (built by scan_sizes.py)

Outputs, under <outdir>/
    chunk_<bucket>_<nn>.tsv   the filelist line per filing (path + metadata)
    chunks.txt                shard ids, one per line — the SGE array index
    chunks_meta.tsv           shard id, bucket, n_filings, bytes

Usage
    build_shards.py sizes.tsv outdir [--target-mb 400]
"""

import argparse
import collections
import heapq
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sizes", help="sizes.tsv: bucket, bytes, filelist line")
    ap.add_argument("outdir")
    ap.add_argument(
        "--target-mb",
        type=int,
        default=400,
        help="target uncompressed input bytes per shard (default 400)",
    )
    args = ap.parse_args()
    target = args.target_mb * 1024 * 1024
    os.makedirs(args.outdir, exist_ok=True)

    by_bucket = collections.defaultdict(list)
    with open(args.sizes) as fh:
        for line in fh:
            bucket, size, rest = line.rstrip("\n").split("\t", 2)
            by_bucket[bucket].append((int(size), rest))

    shards = []
    for bucket in sorted(by_bucket):
        items = sorted(by_bucket[bucket], reverse=True)  # LPT: largest first
        total = sum(size for size, _ in items)
        k = max(1, round(total / target))
        bins = [[0, i, []] for i in range(k)]
        heapq.heapify(bins)
        for size, rest in items:
            load, i, lines = heapq.heappop(bins)
            lines.append(rest)
            heapq.heappush(bins, [load + size, i, lines])
        for load, i, lines in sorted(bins, key=lambda b: b[1]):
            shard_id = "%s_%02d" % (bucket, i)
            lines.sort()  # deterministic within-shard order
            with open(os.path.join(args.outdir, "chunk_%s.tsv" % shard_id), "w") as fh:
                fh.write("\n".join(lines) + "\n")
            shards.append((shard_id, bucket, len(lines), load))

    with open(os.path.join(args.outdir, "chunks.txt"), "w") as fh:
        for shard_id, _, _, _ in shards:
            fh.write(shard_id + "\n")
    with open(os.path.join(args.outdir, "chunks_meta.tsv"), "w") as fh:
        fh.write("chunk_id\tbucket\tn_filings\tbytes\n")
        for shard_id, bucket, n, load in shards:
            fh.write("%s\t%s\t%d\t%d\n" % (shard_id, bucket, n, load))

    loads = [load for _, _, _, load in shards]
    mean = sum(loads) / len(loads)
    print(
        "shards=%d filings=%d bytes_min=%.1fMB max=%.1fMB mean=%.1fMB imbalance=%.1f%%"
        % (
            len(shards),
            sum(n for _, _, n, _ in shards),
            min(loads) / 1e6,
            max(loads) / 1e6,
            mean / 1e6,
            100 * (max(loads) / mean - 1),
        )
    )


if __name__ == "__main__":
    main()
