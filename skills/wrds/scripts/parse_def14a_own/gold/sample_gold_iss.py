#!/usr/bin/env python3
"""sample_gold_iss.py — sample the ISS gold set and split it at the FIRM level.

Two deterministic draws, each with its own recorded seed:

  SAMPLE  ~3,000 of the linked DEF 14A filings in gold_iss_all.tsv.gz,
          stratified by ISS proxy year over 2002-2024, seed 20260929.
          Proportional allocation with a largest-remainder top-up, so the year
          mix of the sample matches the year mix of the linked population.

  SPLIT   20% of the sampled FIRMS (CIKs) to a holdout, seed 20260930, with a
          FORCED core: every CIK that is marked `holdout` in
          holdout_20260928_spent.tsv (the spent seed-20260928 split) or in
          holdout.tsv (the seed-20260929 split) goes to the ISS holdout. Those
          firms have already been read once as a holdout; scoring them as ISS dev
          would let a spent firm back into the tuning set. The fresh random draw
          only tops the forced core up to 20%.

Firm-level, not filing-level: a firm's consecutive proxies share layout and
holder names.

Output (outside git):
    $GOLD_DIR/gold_iss.tsv.gz            the sampled ISS director rows
    $GOLD_DIR/gold_iss.json              sidecar: seeds, counts, strata, sha256
    $GOLD_DIR/holdout_iss.tsv            cik <TAB> split
    $GOLD_DIR/holdout_iss.json           sidecar: seed, forced core, counts, sha256
    $GOLD_DIR/gold_iss_filelist.tsv      the parser filelist for the sampled filings
    $GOLD_DIR/gold_filelist_all.tsv      union with the existing gold_filelist.tsv
"""

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import random
from collections import defaultdict


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_holdout_ciks(path):
    """CIKs marked `holdout` in a holdout.tsv, as int-normalised strings."""
    out = set()
    if not os.path.exists(path):
        return out
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["split"] == "holdout":
                out.add(str(int(r["cik"])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--target", type=int, default=3000)
    ap.add_argument("--sample-seed", type=int, default=20260929)
    ap.add_argument("--split-seed", type=int, default=20260930)
    ap.add_argument("--split-fraction", type=float, default=0.20)
    args = ap.parse_args()
    g = args.gold_dir

    # ---- read the linked population -----------------------------------------
    rows = []
    with gzip.open(os.path.join(g, "gold_iss_all.tsv.gz"), "rt") as fh:
        rdr = csv.DictReader(fh, delimiter="\t")
        cols = rdr.fieldnames
        for r in rdr:
            rows.append(r)
    filings = {}  # (cik, accession) -> (year, relpath, filing_date)
    for r in rows:
        k = (str(int(r["cik"])), r["accession"])
        filings.setdefault(k, (int(r["gold_year"]), r["relpath"], r["filing_date"]))
    print("[in ] gold_iss_all.tsv.gz: %d director rows, %d filings, %d ciks" % (
        len(rows), len(filings), len({k[0] for k in filings})))

    by_year = defaultdict(list)
    for k, (yr, _rel, _fd) in filings.items():
        by_year[yr].append(k)
    for v in by_year.values():
        v.sort()
    years = sorted(by_year)
    n_pop = len(filings)
    print("[strata] %d years %d..%d, population %d filings" % (len(years), years[0], years[-1], n_pop))

    # ---- proportional allocation with largest-remainder top-up ---------------
    exact = {y: args.target * len(by_year[y]) / n_pop for y in years}
    alloc = {y: min(len(by_year[y]), int(exact[y])) for y in years}
    short = args.target - sum(alloc.values())
    rema = sorted(years, key=lambda y: (-(exact[y] - int(exact[y])), y))
    i = 0
    while short > 0 and i < len(rema) * 4:
        y = rema[i % len(rema)]
        if alloc[y] < len(by_year[y]):
            alloc[y] += 1
            short -= 1
        i += 1
    if short > 0:
        raise SystemExit("ERROR: could not allocate %d more filings" % short)

    rng = random.Random(args.sample_seed)
    sampled = []
    print("\n[sample] seed=%d target=%d  (year: population -> drawn)" % (args.sample_seed, args.target))
    for y in years:
        pick = sorted(rng.sample(by_year[y], alloc[y]))
        sampled.extend(pick)
        print("  %d  %5d -> %4d" % (y, len(by_year[y]), len(pick)))
    sampled_set = set(sampled)
    print("  TOTAL %d -> %d filings (%.2f%% of the linked population)" % (
        n_pop, len(sampled_set), 100 * len(sampled_set) / n_pop))

    sample_ciks = sorted({k[0] for k in sampled_set}, key=int)
    print("  distinct sampled firms (CIKs): %d" % len(sample_ciks))

    # ---- the firm-level split ------------------------------------------------
    spent28 = read_holdout_ciks(os.path.join(g, "holdout_20260928_spent.tsv"))
    spent29 = read_holdout_ciks(os.path.join(g, "holdout.tsv"))
    forced_all = spent28 | spent29
    forced = sorted(set(sample_ciks) & forced_all, key=int)
    print("\n[split] seed=%d target fraction=%.2f" % (args.split_seed, args.split_fraction))
    print("  holdout CIKs in holdout_20260928_spent.tsv : %d" % len(spent28))
    print("  holdout CIKs in holdout.tsv (seed 20260929) : %d" % len(spent29))
    print("  union of the two spent holdouts             : %d" % len(forced_all))
    print("  of those, present in the ISS sample (FORCED to ISS holdout) : %d" % len(forced))

    n_want = round(args.split_fraction * len(sample_ciks))
    pool = sorted(set(sample_ciks) - set(forced), key=int)
    n_extra = max(0, n_want - len(forced))
    n_extra = min(n_extra, len(pool))
    rng2 = random.Random(args.split_seed)
    extra = sorted(rng2.sample(pool, n_extra), key=int) if n_extra else []
    holdout = set(forced) | set(extra)
    print("  20%% of %d ISS firms = %d ; forced %d + fresh draw %d = %d (%.2f%%)" % (
        len(sample_ciks), n_want, len(forced), len(extra), len(holdout),
        100 * len(holdout) / len(sample_ciks)))
    if len(forced) > n_want:
        print("  NOTE: the forced core alone exceeds %.0f%%; no fresh draw was added." % (
            100 * args.split_fraction))

    n_dev_f = sum(1 for k in sampled_set if k[0] not in holdout)
    print("  filings: %d dev, %d holdout" % (n_dev_f, len(sampled_set) - n_dev_f))

    # ---- write --------------------------------------------------------------
    keep = [r for r in rows if (str(int(r["cik"])), r["accession"]) in sampled_set]
    keep.sort(key=lambda r: (int(r["cik"]), r["filing_date"], r["accession"], r["director_name"]))
    gp = os.path.join(g, "gold_iss.tsv.gz")
    with gzip.open(gp, "wt") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in keep:
            fh.write("\t".join(r[c] for c in cols) + "\n")
    n_flag = sum(1 for r in keep if r["any_flag"] == "1")
    print("\n[out] %s: %d director rows (%d flagged, %d usable)" % (
        gp, len(keep), n_flag, len(keep) - n_flag))

    hp = os.path.join(g, "holdout_iss.tsv")
    with open(hp, "w") as fh:
        fh.write("cik\tsplit\n")
        for cik in sample_ciks:
            fh.write("%s\t%s\n" % (cik.zfill(10), "holdout" if cik in holdout else "dev"))
    print("[out] %s: %d firms" % (hp, len(sample_ciks)))

    fp = os.path.join(g, "gold_iss_filelist.tsv")
    with open(fp, "w") as fh:
        for k in sorted(sampled_set, key=lambda k: (int(k[0]), k[1])):
            yr, rel, fd = filings[k]
            fh.write("\t".join([rel, k[0], k[1], "DEF 14A", fd, "iss"]) + "\n")
    print("[out] %s: %d filings" % (fp, len(sampled_set)))

    # union filelist: the existing gold round's filings PLUS the ISS ones, so the
    # existing gold round is not broken by adding this one.
    base = os.path.join(g, "gold_filelist.tsv")
    seen, union = set(), []
    for src in (base, fp):
        with open(src) as fh:
            for line in fh:
                p = line.rstrip("\n").split("\t")
                k = (str(int(p[1])), p[2])
                if k in seen:
                    continue
                seen.add(k)
                union.append(line.rstrip("\n"))
    up = os.path.join(g, "gold_filelist_all.tsv")
    with open(up, "w") as fh:
        for line in sorted(union, key=lambda s: (int(s.split("\t")[1]), s.split("\t")[2])):
            fh.write(line + "\n")
    n_base = sum(1 for _ in open(base))
    print("[out] %s: %d filings (%d from gold_filelist.tsv + %d new ISS)" % (
        up, len(union), n_base, len(union) - n_base))

    strata = {str(y): {"population": len(by_year[y]), "drawn": alloc[y]} for y in years}
    side = {
        "artifact": "gold_iss.tsv.gz",
        "gold_set": "iss",
        "source_artifact": "gold_iss_all.tsv.gz",
        "sample_seed": args.sample_seed, "target": args.target,
        "stratified_by": "ISS proxy year (gold_year), 2002-2024, proportional + largest remainder",
        "population_filings": n_pop, "sampled_filings": len(sampled_set),
        "sampled_firms": len(sample_ciks),
        "director_rows": len(keep), "director_rows_flagged": n_flag,
        "strata": strata,
        "built": dt.datetime.now().astimezone().isoformat(),
        "sha256": {"gold_iss.tsv.gz": sha256_of(gp), "gold_iss_filelist.tsv": sha256_of(fp),
                   "gold_filelist_all.tsv": sha256_of(up)},
    }
    with open(os.path.join(g, "gold_iss.json"), "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s sha256=%s" % (os.path.join(g, "gold_iss.json"), side["sha256"]["gold_iss.tsv.gz"]))

    hside = {
        "artifact": "holdout_iss.tsv",
        "split_seed": args.split_seed, "split_fraction": args.split_fraction,
        "firms_total": len(sample_ciks), "firms_holdout": len(holdout),
        "firms_dev": len(sample_ciks) - len(holdout),
        "filings_dev": n_dev_f, "filings_holdout": len(sampled_set) - n_dev_f,
        "forced_core": {
            "why": "a firm marked holdout in either spent split has already been read "
                   "as a holdout; scoring it as ISS dev would return a spent firm to the "
                   "tuning set",
            "sources": ["holdout_20260928_spent.tsv", "holdout.tsv"],
            "holdout_ciks_in_20260928_spent": len(spent28),
            "holdout_ciks_in_20260929": len(spent29),
            "union": len(forced_all),
            "intersect_iss_sample_forced": len(forced),
            "forced_ciks": forced,
        },
        "fresh_draw_ciks": extra,
        "built": dt.datetime.now().astimezone().isoformat(),
        "sha256": {"holdout_iss.tsv": sha256_of(hp)},
    }
    with open(os.path.join(g, "holdout_iss.json"), "w") as fh:
        json.dump(hside, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s holdout_iss.tsv sha256=%s" % (
        os.path.join(g, "holdout_iss.json"), hside["sha256"]["holdout_iss.tsv"]))


if __name__ == "__main__":
    main()
