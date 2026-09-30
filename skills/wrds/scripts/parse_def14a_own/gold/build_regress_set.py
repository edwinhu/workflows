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

EXCLUSIONS — FOUR clauses, all mechanical, all applied to the OLD rows of the
candidate filing, and all meaning "the old rows are demonstrably wrong, so
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

  X3  NO old row carries a percent AND at least half the filing's old `shares`
      values fall in the N-1A dollar-range endpoint set
      {0, 1, 10000, 50000, 100000, 500000, 1000000}.
      ADDED 2026-09-30, and the rule is quoted VERBATIM from the grind floor
      `regress-zero-row-ceiling-0.761-dollar-range-tables`, which measured it:
        "for each of the 590 set-(a) filings not recovered at commit d73248ab, read
         the OLD rows out of panel_e4e78a95/rows_*.tsv.gz; classify a filing
         dollar_range_shaped when NO old row carries a percent and at least half its
         old shares values fall in the dollar-range endpoint set
         {0,1,10000,50000,100000,500000,1000000} -- the N-1A ranges $1-$10,000 /
         $10,001-$50,000 / $50,001-$100,000 / over $100,000."
      Those are Item 22(b)(5) fund dollar-range tables read as share counts, and
      X1/X2 miss them for the reason that floor gives: "the ranges DIFFER between
      trustees, so no three rows carry one identical (shares,percent) pair and no
      holder_name carries a dollar sign." The floor verified six of six sampled
      filings against the documents' own words (0000950137-04-004256,
      0000950137-07-007193, 0001072613-08-000788, 0001047469-06-007946,
      0000950136-05-005070, and earlier 0000950134-02-001418, 0001047469-06-009764,
      0000891092-05-000978, 0000897101-04-000270, 0000950116-05-000211).
  X4  NO old row carries a percent AND >= 3 distinct old `table_index` values AND at
      least half the old rows carry a `holder_name` that repeats 3+ times in the
      filing — the fund-family COMPENSATION table attached once per fund.
      ADDED 2026-09-30, quoted VERBATIM from the grind floor
      `regress-zero-row-ceiling-0.734-refined`:
        "m3_repeated_per_fund 43 (no percent anywhere, at least 3 distinct old
         table_index values, and at least half the old rows are holder names that
         repeat 3+ times -- the fund-family COMPENSATION table attached once per
         fund, which is the rounds own mechanism M3 and which it says to REJECT)."
      All 43 are one document, 0000051931-18-000890 (American Funds 2018, old n_rows
      375) filed under 43 co-registrant CIKs, whose columns read verbatim from
      -debug: "Aggregate compensation from Fund (inc. voluntarily deferred
      compensation2) | Total compensation from all Funds | Dollar range3 of Fund
      shares owned | Aggregate dollar range3 of shares owned in all overseen Funds"
      — compensation dollars and dollar ranges, no share count and no percent.

WHY X3 AND X4 WERE ADDED. Set (a) was gated at `regress_zero_row_recovered >= 0.95`
on the premise that every filing in it had lost REAL ownership rows. It had not: the
two floors above measured, from the panels themselves, that 205 + 43 = 248 of the
933 set-(a) filings had OLD rows that were themselves wrong, which the duplicate
round REMOVED on purpose in 52f43c4f. That put a hard ceiling of 685/933 = 0.7342 on
the gate, so 0.95 was unreachable and the loop was being paid to re-accept tables
`regress_excluded_emitting_rows_rate` exists to catch. The correction is to the SET,
not to the threshold: 0.95 stays, the mis-specified members leave the denominator,
and they are reported as a DIAGNOSTIC (score.py prints the X3/X4 exclusions and
their emitting-rows rate separately from X1/X2, so re-accepting them is still
visible). `textMoneyBlock` must not be weakened.

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

    # ---- the OLD rows of the candidate filings, for X1..X4 and for the report ----
    # N-1A DOLLAR-RANGE ENDPOINTS, quoted from the 0.761 floor: the $1-$10,000 /
    # $10,001-$50,000 / $50,001-$100,000 / over $100,000 bands, plus 0 and the
    # $500,001-$1,000,000 band the later forms add. A `shares` value equal to one of
    # these and no percent anywhere is a dollar RANGE read as a share COUNT.
    DOLLAR_RANGE_ENDPOINTS = {0, 1, 10000, 50000, 100000, 500000, 1000000}

    n_old_rows = 0
    val_count = defaultdict(lambda: defaultdict(int))   # key -> (shares, percent) -> n
    name_count = defaultdict(lambda: defaultdict(int))  # key -> holder_name -> n   (X4)
    tables = defaultdict(set)                           # key -> {table_index}      (X4)
    names = defaultdict(list)                           # key -> [holder_name, ...] (X4)
    stat = defaultdict(lambda: {"rows": 0, "dollar": 0, "grp": 0, "grp_pct": 0,
                                "pct": 0, "endpoint": 0})
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
                # --- X3 / X4 inputs ---
                if (r["percent"] or "") != "":
                    s["pct"] += 1
                try:
                    if int(r["shares"]) in DOLLAR_RANGE_ENDPOINTS:
                        s["endpoint"] += 1
                except (TypeError, ValueError):
                    pass          # an unparsed shares cell is not an endpoint
                tables[key].add(r["table_index"])
                nm = r["holder_name"] or ""
                names[key].append(nm)
                name_count[key][nm] += 1
    print("[in ] old rows in candidate filings: %d" % n_old_rows)

    rows, counts = [], defaultdict(int)
    for key in sorted(cands):
        cik, acc = key
        s = stat[key]
        vals = val_count[key]
        max_same = max(vals.values()) if vals else 0
        x1 = 1 if s["dollar"] > 0 else 0
        x2 = 1 if (s["rows"] >= 3 and max_same == s["rows"]) else 0
        # X3 / X4 — both require "no percent anywhere" in the OLD rows, which is the
        # condition the two floors state and which is NOT on its own an exclusion
        # (GE 2013 refuted that; see the rejected rule above). It is the CONJUNCTION
        # with the dollar-range shape (X3) or the per-fund repetition (X4) that is.
        no_pct = s["rows"] > 0 and s["pct"] == 0
        x3 = 1 if (no_pct and 2 * s["endpoint"] >= s["rows"]) else 0
        n_rep_rows = sum(1 for nm in names[key] if name_count[key][nm] >= 3)
        x4 = 1 if (no_pct and len(tables[key]) >= 3 and 2 * n_rep_rows >= s["rows"]) else 0
        excluded = x1 or x2 or x3 or x4
        in_a = 1 if (key in cand_a and not excluded) else 0
        in_b_gated = 1 if (key in cand_b and not excluded and s["grp_pct"] > 0) else 0
        in_b_diag = 1 if (key in cand_b and not excluded and s["grp_pct"] == 0) else 0
        m = old[key]
        rows.append([acc, cik, m["filing_date"], m["source_file"], m["form"],
                     1 if key in cand_a else 0, 1 if key in cand_b else 0,
                     in_a, in_b_gated, in_b_diag, x1, x2, x3, x4,
                     m["n_rows"], m["n_percent_parsed"], s["grp"], s["grp_pct"],
                     s["rows"], max_same,
                     s["pct"], s["endpoint"], len(tables[key]), n_rep_rows])
        counts["candidates"] += 1
        counts["cand_a"] += 1 if key in cand_a else 0
        counts["cand_b"] += 1 if key in cand_b else 0
        counts["excl_x1"] += x1
        counts["excl_x2"] += x2
        counts["excl_x3"] += x3
        counts["excl_x4"] += x4
        counts["excl_x1_only"] += 1 if (x1 and not x2) else 0
        counts["excl_x2_only"] += 1 if (x2 and not x1) else 0
        counts["excl_both"] += 1 if (x1 and x2) else 0
        # What the 2026-09-30 correction ACTUALLY removed, which is the number the
        # amendment is judged on: candidates X3/X4 catch that X1/X2 did not.
        counts["excl_x3_new"] += 1 if (x3 and not (x1 or x2)) else 0
        counts["excl_x4_new"] += 1 if (x4 and not (x1 or x2 or x3)) else 0
        counts["excl_x3_or_x4_new"] += 1 if ((x3 or x4) and not (x1 or x2)) else 0
        counts["excl_x3_or_x4_new_from_a"] += 1 if (
            key in cand_a and (x3 or x4) and not (x1 or x2)) else 0
        counts["excl_x3_or_x4_new_from_b"] += 1 if (
            key in cand_b and (x3 or x4) and not (x1 or x2)) else 0
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
              "excl_x3_dollar_range_table", "excl_x4_m3_repeated_per_fund",
              "old_n_rows", "old_n_percent_parsed", "old_group_rows",
              "old_group_rows_with_percent", "old_rows_counted", "old_max_identical_value",
              # the X3/X4 inputs, so every exclusion can be re-checked from this file
              "old_rows_with_percent", "old_rows_range_endpoint_shares",
              "old_distinct_table_index", "old_rows_name_repeated_3plus"]
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
            "X3_dollar_range_table": "ADDED 2026-09-30, quoted from grind floor "
                                     "regress-zero-row-ceiling-0.761-dollar-range-tables: "
                                     "'classify a filing dollar_range_shaped when NO old "
                                     "row carries a percent and at least half its old "
                                     "shares values fall in the dollar-range endpoint set "
                                     "{0,1,10000,50000,100000,500000,1000000} -- the N-1A "
                                     "ranges $1-$10,000 / $10,001-$50,000 / "
                                     "$50,001-$100,000 / over $100,000.'",
            "X4_m3_repeated_per_fund": "ADDED 2026-09-30, quoted from grind floor "
                                       "regress-zero-row-ceiling-0.734-refined: "
                                       "'m3_repeated_per_fund 43 (no percent anywhere, at "
                                       "least 3 distinct old table_index values, and at "
                                       "least half the old rows are holder names that "
                                       "repeat 3+ times -- the fund-family COMPENSATION "
                                       "table attached once per fund, which is the rounds "
                                       "own mechanism M3 and which it says to REJECT).'",
            "why_X3_X4_added": "set (a) was gated at regress_zero_row_recovered >= 0.95 on "
                               "the premise that every member had lost REAL ownership rows. "
                               "The two floors above measured, from the panels, that 205 + "
                               "43 = 248 of the 933 set-(a) filings had OLD rows that were "
                               "themselves wrong and that the duplicate round removed on "
                               "purpose in 52f43c4f, putting a hard ceiling of 685/933 = "
                               "0.7342 on the gate. The SET is corrected; the 0.95 "
                               "thresholds are unchanged; the removed filings remain a "
                               "reported diagnostic",
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
