#!/usr/bin/env python3
"""build_regress_set.py — the FIXED regression set for the 2026-09-29 regression round.

Why this exists. The full-archive re-run at parser `092b6fb9`
(`/data/def14a_own/panel`) beat the reference run at `4b36a962`
(`/data/def14a_own/panel_e4e78a95`) on the identical-row duplicate rate and on
yield, and paid for it with two recall losses that NO gate can see: 1,070 filings
that had >= 1 ownership row before and 0 now, and filings that lost a D&O group
row. Both clusters sit in the layouts the duplicate rounds changed. Every existing
gate reads gold-linked filings or the fixed sample; none of them reads the filings
that regressed, so the loop is free to lose them again.

THE SET IS A DIFF OF TWO PANELS, AND IS FIXED ONCE. Nothing here re-parses
anything: the two panels on disk are the evidence, and the set is written once and
locked, exactly like `sample_full.tsv`.

  (a) ZERO-ROW set    old n_rows > 0 AND new n_rows == 0
  (b) GROUP-ROW set   old has_group_row == 1 AND new has_group_row == 0

EXCLUSIONS — two clauses, both mechanical, both applied to the OLD rows of the
candidate filing, and both meaning "the old rows are demonstrably wrong, so
restoring them is not a target":

  X1  >= 1 old row whose `holder_name` contains a `$`.
      The name column of a beneficial-ownership table carries a person or an
      entity. A `$` in it means the parser read a DOLLAR column as the name:
      a dollar-range-of-equity table (Item 22(b)(5) fund proxies) or a summary
      compensation table. Read in the documents: `Thomas R. $10,001-$50,000 $0`
      (First Trust 2006, `0000875626-06-000515`, an AGGREGATE DOLLAR RANGE OF
      EQUITY SECURITIES table) and `President/CEO - Union National Bank 1996
      $166,500 $38,295 [3]` -> shares=13936 (Univest 1999,
      `0000891554-99-000468`, the SUMMARY COMPENSATION TABLE's All Other
      Compensation column).
  X2  >= 3 old rows, every one carrying the IDENTICAL (shares, percent) pair.
      No real ownership table gives every holder the same holding; a dollar-range
      table does. Read in the documents: Pacholder High Yield Fund 2012
      (`0001193125-12-089540`), 13 trustees each `100000` from "Over $100,000";
      Third Avenue 2002 (`0000930413-02-002213`), 10 trustees each `0` from
      "$0*"; Lincoln National Income Fund 2002 (`0000950116-02-000782`), 6
      directors each `100000` from "over $100,000" while the real
      "Shares of Common Stock Beneficially Owned" column (22,887 / 3,672 / ...)
      went unread.

A rule that was CONSIDERED AND REJECTED, because a document refuted it: "the old
parse emitted no percent anywhere" (980 of the 1,070). GE 2013
(`0001206774-13-001019`) has no percent anywhere and its old rows are the real
ownership table — `As a group (27) 24,040,027 / 40,202,945` and
`BlackRock 583,104,477` — because the document states no percent at all ("No
director or named executive owns more than 1%"). Share-count-only tables are
therefore KEPT in set (a).

SCOPE, not exclusion, for (b). Of the group-row candidates that survive X1/X2,
the GATED set is the filings whose lost group rows include at least one carrying a
PARSED PERCENT; the rest are reported as a DIAGNOSTIC with their own denominator.
The percent is what a group row is scored on — `group_row_detection_rate`'s
denominator is filings with a parsed percent, and the FactSet D&O aggregate is a
percent — and the share-only group-row population is where the report's
compensation/award group labels sit ("All Current Executives as a Group | 271000 |
no percent"). It is a scope decision, disclosed, with the wider population
printed every round; it is NOT a claim that those 1,000-odd rows were wrong.

Inputs   /data/def14a_own/panel_e4e78a95/manifest_*.tsv.gz + rows_*.tsv.gz   (old)
         /data/def14a_own/panel/manifest_*.tsv.gz                           (new)
         <gold-dir>/gold_filelist_all.tsv, <gold-dir>/sample_full.tsv       (union)

Outputs  <gold-dir>/gold_regress.tsv       the set, one row per CANDIDATE filing,
                                           with the flags that say which set it is
                                           in and which exclusion clause fired
         <gold-dir>/regress_filelist.tsv   parser-format filelist for the round
         <gold-dir>/gold_regress.json      sidecar: rules, counts, hashes
         <gold-dir>/round_filelist.tsv     THE 3-WAY UNION this script now owns
                                           (gold_filelist_all + sample_full +
                                           regress_filelist). `sample_full_archive.py`
                                           deliberately no longer writes it: one
                                           writer, one file.

`gold_regress.tsv` is covered by lock.sha256, so the loop cannot edit the set it
is scored on. Determinism: every output is sorted; re-running writes byte-identical
files.
"""

import argparse
import csv
import glob
import gzip
import hashlib
import json
import os
import sys
from collections import defaultdict

csv.field_size_limit(1 << 24)
TSV = {"delimiter": "\t", "quoting": csv.QUOTE_NONE}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_manifests(panel_dir):
    """-> {(cik, accession): row}. Raises if the panel is not on disk."""
    paths = sorted(glob.glob(os.path.join(panel_dir, "manifest_*.tsv.gz")))
    if not paths:
        sys.exit("ERROR: no manifest_*.tsv.gz under %s" % panel_dir)
    out = {}
    for p in paths:
        with gzip.open(p, "rt") as fh:
            for r in csv.DictReader(fh, **TSV):
                key = (r["cik"].lstrip("0") or "0", r["accession"])
                if key in out:
                    sys.exit("ERROR: duplicate manifest key %s in %s" % (key, p))
                out[key] = r
    print("[in ] %s: %d manifest rows" % (panel_dir, len(out)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-panel", default="/data/def14a_own/panel_e4e78a95")
    ap.add_argument("--new-panel", default="/data/def14a_own/panel")
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    args = ap.parse_args()
    g = args.gold_dir

    old = read_manifests(args.old_panel)
    new = read_manifests(args.new_panel)

    # JOIN AUDIT (E3): the two panels are the same 207,912 filings by construction —
    # the same filelist and the same shard plan, hashed equal in the run-2 report.
    # If that ever stops holding, say so loudly rather than diffing a subset.
    both = sorted(set(old) & set(new))
    print("[join] old=%d new=%d matched=%d old_only=%d new_only=%d" % (
        len(old), len(new), len(both), len(set(old) - set(new)), len(set(new) - set(old))))
    if len(both) != len(old) or len(both) != len(new):
        sys.exit("ERROR: the two panels do not cover the same filings; a diff over a "
                 "subset is not the regression this round is about")

    cand_a, cand_b = set(), set()
    for key in both:
        o, n = old[key], new[key]
        if int(o["n_rows"]) > 0 and int(n["n_rows"]) == 0:
            cand_a.add(key)
        if o["has_group_row"] == "1" and n["has_group_row"] == "0":
            cand_b.add(key)
    cands = cand_a | cand_b
    print("[set] candidates: (a) zero-row %d ; (b) group-row %d ; union %d" % (
        len(cand_a), len(cand_b), len(cands)))

    # ---- the OLD rows of the candidate filings, for X1 / X2 and for the report ----
    n_old_rows = 0
    val_count = defaultdict(lambda: defaultdict(int))   # key -> (shares, percent) -> n
    stat = defaultdict(lambda: {"rows": 0, "dollar": 0, "grp": 0, "grp_pct": 0})
    for p in sorted(glob.glob(os.path.join(args.old_panel, "rows_*.tsv.gz"))):
        with gzip.open(p, "rt") as fh:
            for r in csv.DictReader(fh, **TSV):
                key = (r["cik"].lstrip("0") or "0", r["accession"])
                if key not in cands:
                    continue
                n_old_rows += 1
                s = stat[key]
                s["rows"] += 1
                if "$" in (r["holder_name"] or ""):
                    s["dollar"] += 1
                if r["is_group_row"] == "1":
                    s["grp"] += 1
                    if (r["percent"] or "") != "":
                        s["grp_pct"] += 1
                val_count[key][(r["shares"], r["percent"])] += 1
    print("[in ] old rows in candidate filings: %d" % n_old_rows)

    rows, counts = [], defaultdict(int)
    for key in sorted(cands):
        cik, acc = key
        s = stat[key]
        vals = val_count[key]
        max_same = max(vals.values()) if vals else 0
        x1 = 1 if s["dollar"] > 0 else 0
        x2 = 1 if (s["rows"] >= 3 and max_same == s["rows"]) else 0
        excluded = x1 or x2
        in_a = 1 if (key in cand_a and not excluded) else 0
        in_b_gated = 1 if (key in cand_b and not excluded and s["grp_pct"] > 0) else 0
        in_b_diag = 1 if (key in cand_b and not excluded and s["grp_pct"] == 0) else 0
        m = old[key]
        rows.append([acc, cik, m["filing_date"], m["source_file"], m["form"],
                     1 if key in cand_a else 0, 1 if key in cand_b else 0,
                     in_a, in_b_gated, in_b_diag, x1, x2,
                     m["n_rows"], m["n_percent_parsed"], s["grp"], s["grp_pct"],
                     s["rows"], max_same])
        counts["candidates"] += 1
        counts["cand_a"] += 1 if key in cand_a else 0
        counts["cand_b"] += 1 if key in cand_b else 0
        counts["excl_x1"] += x1
        counts["excl_x2"] += x2
        counts["excl_x1_only"] += 1 if (x1 and not x2) else 0
        counts["excl_x2_only"] += 1 if (x2 and not x1) else 0
        counts["excl_both"] += 1 if (x1 and x2) else 0
        counts["excl_any"] += 1 if excluded else 0
        counts["excl_from_a"] += 1 if (key in cand_a and excluded) else 0
        counts["excl_from_b"] += 1 if (key in cand_b and excluded) else 0
        counts["set_a"] += in_a
        counts["set_b_gated"] += in_b_gated
        counts["set_b_diag"] += in_b_diag
        counts["set_a_and_b_gated"] += 1 if (in_a and in_b_gated) else 0

    header = ["accession", "cik", "filing_date", "source_file", "form",
              "cand_zero_row", "cand_group_row",
              "in_set_zero_row", "in_set_group_row_gated", "in_set_group_row_diag",
              "excl_x1_dollar_in_name", "excl_x2_one_value_all_rows",
              "old_n_rows", "old_n_percent_parsed", "old_group_rows",
              "old_group_rows_with_percent", "old_rows_counted", "old_max_identical_value"]
    out_path = os.path.join(g, "gold_regress.tsv")
    rows.sort(key=lambda r: (r[0], int(r[1])))
    with open(out_path, "w") as fh:
        fh.write("\t".join(header) + "\n")
        for r in rows:
            fh.write("\t".join(str(x) for x in r) + "\n")
    print("[out] %s: %d candidate filings" % (out_path, len(rows)))
    for k in sorted(counts):
        print("       %-20s %d" % (k, counts[k]))

    # ---- the filelist the round submits -------------------------------------
    # EVERY candidate is submitted, including the excluded ones: the diagnostic
    # over the group-row population needs them, and a set the round does not parse
    # is a set the scorer cannot see.
    fl_path = os.path.join(g, "regress_filelist.tsv")
    fl = sorted({(r[3], r[1], r[0], r[4], r[2]) for r in rows})
    with open(fl_path, "w") as fh:
        for src, cik, acc, form, fdate in fl:
            fh.write("\t".join([src, cik, acc, form, fdate, "regress"]) + "\n")
    print("[out] %s: %d filings" % (fl_path, len(fl)))

    # ---- round_filelist.tsv, the 3-way union THIS script owns ----------------
    gold_path = os.path.join(g, "gold_filelist_all.tsv")
    sample_path = os.path.join(g, "sample_full.tsv")
    for p in (gold_path, sample_path):
        if not os.path.exists(p):
            sys.exit("ERROR: %s missing — round_filelist.tsv is the union of "
                     "gold_filelist_all.tsv, sample_full.tsv and regress_filelist.tsv" % p)
    union, seen, per_src = [], set(), {}
    for src in (gold_path, sample_path, fl_path):
        n_kept = 0
        with open(src) as fh:
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if f[0] in seen:
                    continue
                seen.add(f[0])
                union.append(line.rstrip("\n"))
                n_kept += 1
        per_src[os.path.basename(src)] = {
            "lines": sum(1 for _ in open(src)), "new_paths_contributed": n_kept}
    union.sort()
    round_path = os.path.join(g, "round_filelist.tsv")
    with open(round_path, "w") as fh:
        for line in union:
            fh.write(line + "\n")
    print("[out] %s: %d filings" % (round_path, len(union)))
    for k, v in sorted(per_src.items()):
        print("       %-24s lines=%-6d new paths=%d" % (k, v["lines"], v["new_paths_contributed"]))

    side = {
        "built": "gold/build_regress_set.py",
        "purpose": "fixed regression set for the 2026-09-29 regression round",
        "old_panel": args.old_panel,
        "new_panel": args.new_panel,
        "old_panel_parser_commit": "4b36a962 (panel committed at e4e78a95)",
        "new_panel_parser_commit": "092b6fb9",
        "definition": {
            "set_zero_row": "old n_rows > 0 AND new n_rows == 0",
            "set_group_row": "old has_group_row == 1 AND new has_group_row == 0",
        },
        "exclusions": {
            "X1_dollar_in_name": ">= 1 old row whose holder_name contains '$' — the "
                                 "parser read a DOLLAR column as the name column "
                                 "(dollar-range-of-equity or summary compensation table)",
            "X2_one_value_all_rows": ">= 3 old rows, all carrying the identical "
                                     "(shares, percent) pair — no real ownership table "
                                     "gives every holder the same holding",
            "rejected_rule": "'old parse emitted no percent anywhere' (980 of the 1,070) "
                             "was REJECTED: GE 2013 0001206774-13-001019 states no percent "
                             "at all and its old rows are the real table",
        },
        "group_row_scope": "of the group-row candidates surviving X1/X2, the GATED set is "
                           "those whose lost group rows include >= 1 carrying a parsed "
                           "percent; the rest are a printed diagnostic",
        "counts": dict(sorted(counts.items())),
        "old_rows_in_candidate_filings": n_old_rows,
        "filelist_filings": len(fl),
        "round_filelist_filings": len(union),
        "round_filelist_sources": per_src,
        "sha256_gold_regress_tsv": sha256_of(out_path),
        "sha256_regress_filelist_tsv": sha256_of(fl_path),
        "sha256_round_filelist_tsv": sha256_of(round_path),
    }
    side_path = os.path.join(g, "gold_regress.json")
    with open(side_path, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s  sha256(gold_regress.tsv)=%s" % (side_path, side["sha256_gold_regress_tsv"]))


if __name__ == "__main__":
    main()
