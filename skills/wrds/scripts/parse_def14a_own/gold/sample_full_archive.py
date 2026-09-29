#!/usr/bin/env python3
"""sample_full_archive.py — a FIXED full-archive sample, stratified by filing year.

Why this exists. The three gold sets (blockw 1996-2001, FactSet 2006-2021, ISS
2002-2024) are all built from licensed vendor coverage of larger, better-behaved
filers, and none of them covers 1994-1995 or 2025-2026 at all. The full-archive
run of 2026-09-29 (207,912 filings, commit e4e78a95) measured a panel-wide
parsed-percent yield of 0.8454 against the gold dev split's 0.8921, and an
exact-key duplicate excess of 9.00% concentrated in years the gold sets cannot
see. A metric that only ever reads gold-linked filings cannot detect either.

This sample is the corpus-shaped ruler: ~250 filings per FILING year, 1994-2026,
drawn from the full-archive manifests, with every gold-linked filing excluded so
the sample metrics and the gold metrics never share a filing.

DETERMINISM. One RNG per year, seeded `SEED * 1000 + year`, sampling from the
year's pool sorted by (accession, cik). Re-running writes a byte-identical file.

Inputs   /data/def14a_own/panel/manifest_<year>.tsv.gz   (the full-archive run)
         /data/def14a_own/gold/gold_filelist_all.tsv     (filings to EXCLUDE)

Outputs  <gold-dir>/sample_full.tsv    the filelist, parser format, 6 columns:
                                       relpath, cik, accession, form, fdate, 'sample'
         <gold-dir>/sample_full.json   sidecar: seed, per-year counts, bytes, sha256
         <gold-dir>/round_filelist.tsv UNION of gold_filelist_all.tsv and
                                       sample_full.tsv — what run_baseline.sh
                                       submits, so one grid pass scores both.

`sample_full.tsv` is covered by lock.sha256: the grind may not edit the sample it
is scored on, exactly as it may not edit the gold sets.
"""

import argparse
import csv
import gzip
import hashlib
import json
import os
import random
import sys


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel-dir", default="/data/def14a_own/panel")
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--seed", type=int, default=20260929)
    ap.add_argument("--per-year", type=int, default=250)
    ap.add_argument("--year-min", type=int, default=1994)
    ap.add_argument("--year-max", type=int, default=2026)
    args = ap.parse_args()

    gold_path = os.path.join(args.gold_dir, "gold_filelist_all.tsv")
    gold_acc = set()
    with open(gold_path) as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) >= 3:
                gold_acc.add(f[2])
    print("[in ] %s: %d gold-linked accessions to exclude" % (gold_path, len(gold_acc)))

    picked, per_year = [], {}
    n_pool_total = n_excluded = 0
    for year in range(args.year_min, args.year_max + 1):
        mpath = os.path.join(args.panel_dir, "manifest_%d.tsv.gz" % year)
        if not os.path.exists(mpath):
            sys.exit("ERROR: %s missing — the full-archive run must be on disk" % mpath)
        pool = []
        n_year = 0
        with gzip.open(mpath, "rt") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                n_year += 1
                if r["accession"] in gold_acc:
                    n_excluded += 1
                    continue
                pool.append(r)
        pool.sort(key=lambda r: (r["accession"], r["cik"]))
        n_pool_total += len(pool)
        k = min(args.per_year, len(pool))
        rnd = random.Random(args.seed * 1000 + year)
        sel = rnd.sample(pool, k)
        sel.sort(key=lambda r: (r["accession"], r["cik"]))
        per_year[year] = {
            "filings_in_year": n_year,
            "pool_after_gold_exclusion": len(pool),
            "sampled": k,
            "bytes": sum(int(r["bytes"]) for r in sel),
            "max_bytes": max((int(r["bytes"]) for r in sel), default=0),
        }
        picked.extend(sel)
        print("  %d: year=%-6d pool=%-6d sampled=%-4d %8.1f MB (max %6.1f MB)" % (
            year, n_year, len(pool), k,
            per_year[year]["bytes"] / 1e6, per_year[year]["max_bytes"] / 1e6))

    picked.sort(key=lambda r: (r["accession"], r["cik"]))
    out_path = os.path.join(args.gold_dir, "sample_full.tsv")
    with open(out_path, "w") as fh:
        for r in picked:
            fh.write("\t".join([r["source_file"], r["cik"], r["accession"],
                                r["form"], r["filing_date"], "sample"]) + "\n")
    total_bytes = sum(v["bytes"] for v in per_year.values())
    print("[out] %s: %d filings, %.2f GB" % (out_path, len(picked), total_bytes / 1e9))

    # The union filelist the round submits. Deduplicated on the ARCHIVE PATH, which
    # is the parser's unit of work; the same accession under two CIKs is two paths
    # and both are kept, because the panel grain is (cik, accession).
    union, seen = [], set()
    for src in (gold_path, out_path):
        with open(src) as fh:
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if f[0] in seen:
                    continue
                seen.add(f[0])
                union.append(line.rstrip("\n"))
    union.sort()
    round_path = os.path.join(args.gold_dir, "round_filelist.tsv")
    with open(round_path, "w") as fh:
        for line in union:
            fh.write(line + "\n")
    print("[out] %s: %d filings (gold %d + sample %d, %d shared paths dropped)" % (
        round_path, len(union), sum(1 for _ in open(gold_path)), len(picked),
        sum(1 for _ in open(gold_path)) + len(picked) - len(union)))

    side = {
        "built": "gold/sample_full_archive.py",
        "seed": args.seed,
        "rng": "random.Random(seed*1000 + year); pool sorted by (accession, cik)",
        "per_year_target": args.per_year,
        "years": [args.year_min, args.year_max],
        "source": "full-archive manifests under %s (run 2026-09-29, commit e4e78a95)" % args.panel_dir,
        "excluded": "every filing whose accession appears in gold_filelist_all.tsv",
        "gold_accessions_excluded": len(gold_acc),
        "rows_excluded_from_pools": n_excluded,
        "pool_total": n_pool_total,
        "sampled_filings": len(picked),
        "sampled_bytes": total_bytes,
        "per_year": {str(k): v for k, v in sorted(per_year.items())},
        "sha256_sample_full_tsv": sha256_of(out_path),
        "sha256_round_filelist_tsv": sha256_of(round_path),
        "round_filelist_filings": len(union),
    }
    side_path = os.path.join(args.gold_dir, "sample_full.json")
    with open(side_path, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s  sha256(sample_full.tsv)=%s" % (side_path, side["sha256_sample_full_tsv"]))


if __name__ == "__main__":
    main()
