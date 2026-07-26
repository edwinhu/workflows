#!/usr/bin/env python3
"""build_shards.py — byte-balanced shard lists for the 13F EDGAR scrape.

Shard key is BYTES, not filings. Filings are listed in archive-path order,
archive path is CIK order, and CIK order correlates with filer size, so
splitting a quarter into equal-COUNT contiguous chunks produced a measured 2x
spread in task duration (19.4 s vs 42.8 s for two 2,254-filing chunks of
2016Q4). Packing on measured file size instead brings the spread under 11%.

Shards are built WITHIN each quarter so the output stays quarter-partitioned,
which is what the ownership panel consumes. Global packing balances slightly
better and is not worth losing that.

Inputs
    sizes.tsv     bucket <TAB> archive-relative-path <TAB> bytes
                  (built by scan_sizes.py; os.path.getsize over the filelists)

Outputs, under <outdir>/
    chunk_<bucket>_<nn>.txt   one archive-relative path per line
    chunks.txt                shard ids, one per line — the SGE array index
    chunks_meta.tsv           shard id, bucket, n_filings, bytes

Usage
    build_shards.py sizes.tsv outdir [--target-mb 200]
"""

import argparse
import collections
import heapq
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sizes", help="sizes.tsv: bucket, path, bytes")
    ap.add_argument("outdir")
    ap.add_argument(
        "--target-mb",
        type=int,
        default=200,
        help="target uncompressed input bytes per shard (default 200)",
    )
    args = ap.parse_args()
    target = args.target_mb * 1024 * 1024
    os.makedirs(args.outdir, exist_ok=True)

    by_quarter = collections.defaultdict(list)
    with open(args.sizes) as fh:
        for line in fh:
            bucket, path, size = line.rstrip("\n").split("\t")
            by_quarter[bucket].append((int(size), path))

    shards = []
    for bucket in sorted(by_quarter):
        items = sorted(by_quarter[bucket], reverse=True)  # LPT: largest first
        total = sum(size for size, _ in items)
        k = max(1, round(total / target))
        bins = [[0, i, []] for i in range(k)]
        heapq.heapify(bins)
        for size, path in items:
            load, i, paths = heapq.heappop(bins)
            paths.append(path)
            heapq.heappush(bins, [load + size, i, paths])
        for load, i, paths in sorted(bins, key=lambda b: b[1]):
            shard_id = "%s_%02d" % (bucket, i)
            paths.sort()  # deterministic within-shard order
            with open(os.path.join(args.outdir, "chunk_%s.txt" % shard_id), "w") as fh:
                fh.write("\n".join(paths) + "\n")
            shards.append((shard_id, bucket, len(paths), load))

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
