#!/usr/bin/env python3
"""make_holdout.py — split the gold FIRMS into dev and holdout, once, by seed.

A random 20% of CIKs across BOTH gold sets is the holdout. The split is at the
FIRM level, not the filing level: a firm's 1998 and 1999 proxies share layout,
boilerplate and holder names, so splitting filings would leak the answer for a
held-out year into the dev set.

The grind never scores the holdout. `score.py --holdout` refuses to run while
GRIND_ITERATION is set in the environment.

Also emits the union filelist the baseline run needs, so the shard plan and the
scorer read the same set of filings.

Output (outside git):
    $GOLD_DIR/holdout.tsv              cik <TAB> split
    $GOLD_DIR/holdout.json             sidecar: seed, counts, sha256
    $GOLD_DIR/gold_filelist.tsv        relpath, cik, accession, form, filing_date, split
"""

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import random

SPLIT_FRACTION = 0.20


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_gz(path, cols):
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            yield tuple(r[c] for c in cols)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--seed", type=int, default=20260928)
    args = ap.parse_args()
    g = args.gold_dir

    filings = {}  # (cik, accession) -> (relpath, filing_date, which gold sets)
    per_set = {}
    for name, fn in [("blockw", "gold_blockw.tsv.gz"), ("factset", "gold_factset_firmyear.tsv.gz")]:
        ciks = set()
        n = 0
        for cik, acc, fdate, rel in read_gz(os.path.join(g, fn),
                                            ["cik", "accession", "filing_date", "relpath"]):
            n += 1
            ciks.add(cik)
            k = (cik, acc)
            if k in filings:
                filings[k][2].add(name)
            else:
                filings[k] = [rel, fdate, {name}]
        per_set[name] = {"rows": n, "ciks": len(ciks),
                         "filings": len({(c, a) for c, a, _, _ in read_gz(
                             os.path.join(g, fn), ["cik", "accession", "filing_date", "relpath"])})}
        print("[in ] %s: %d rows, %d filings, %d ciks" % (
            name, n, per_set[name]["filings"], len(ciks)))

    all_ciks = sorted({c for c, _ in filings})
    rng = random.Random(args.seed)
    n_hold = round(SPLIT_FRACTION * len(all_ciks))
    holdout = set(rng.sample(all_ciks, n_hold))
    print("[split] seed=%d firms=%d -> holdout=%d (%.1f%%) dev=%d" % (
        args.seed, len(all_ciks), len(holdout), 100 * len(holdout) / len(all_ciks),
        len(all_ciks) - len(holdout)))

    hp = os.path.join(g, "holdout.tsv")
    with open(hp, "w") as fh:
        fh.write("cik\tsplit\n")
        for cik in all_ciks:
            fh.write("%s\t%s\n" % (cik, "holdout" if cik in holdout else "dev"))

    fl = os.path.join(g, "gold_filelist.tsv")
    n_dev = n_hold_f = 0
    with open(fl, "w") as fh:
        for (cik, acc) in sorted(filings):
            rel, fdate, sets = filings[(cik, acc)]
            split = "holdout" if cik in holdout else "dev"
            if split == "dev":
                n_dev += 1
            else:
                n_hold_f += 1
            # parser filelist columns: relpath, cik, accession, form, fdate, company
            # (company is used as the gold-set tag here: it is a free text column the
            # parser copies through, and the scorer keys on cik+accession anyway)
            fh.write("\t".join([rel, str(int(cik)), acc, "DEF 14A", fdate,
                                "+".join(sorted(sets))]) + "\n")
    print("[out] %s: %d filings (%d dev, %d holdout)" % (fl, len(filings), n_dev, n_hold_f))

    side = {
        "seed": args.seed, "split_fraction": SPLIT_FRACTION,
        "firms_total": len(all_ciks), "firms_holdout": len(holdout),
        "firms_dev": len(all_ciks) - len(holdout),
        "filings_total": len(filings), "filings_dev": n_dev, "filings_holdout": n_hold_f,
        "per_gold_set": per_set,
        "built": dt.datetime.now().astimezone().isoformat(),
        "sha256": {"holdout.tsv": sha256_of(hp), "gold_filelist.tsv": sha256_of(fl)},
    }
    sc = os.path.join(g, "holdout.json")
    with open(sc, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s holdout.tsv sha256=%s" % (sc, side["sha256"]["holdout.tsv"]))


if __name__ == "__main__":
    main()
