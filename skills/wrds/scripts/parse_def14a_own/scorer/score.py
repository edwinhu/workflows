#!/usr/bin/env python3
"""score.py — score parse_def14a_own output against the gold sets.

Stdlib only. Deterministic: no randomness, output sorted, the same inputs give
byte-identical output.

Metrics, each printed with its denominator:

  (i)   FILING YIELD           share of gold-linked filings with a parsed
                               ownership table. Reported twice: `any row`, and
                               `>=1 parsed percent`, which is the gated one —
                               a table with no percent cannot be scored against
                               a gold percent.
  (ii)  HOLDER RECALL / PRECISION vs blockw
                               match = normalised holder name AND percent within
                               0.5 pp. blockw's universe is 5% blockholders plus
                               director/officer holders, so BOTH sides are
                               restricted to >= 5.0% — scoring a parser row at
                               0.3% against a gold set that does not record it
                               would be measuring the gold set's scope.
  (iii) D&O-GROUP-% and LARGEST-BLOCK-% agreement vs FactSet, within 1.0 pp.
                               DIAGNOSTIC, never gated. Parser D&O group % = max
                               percent over rows flagged is_group_row; gold =
                               FactSet's sum of natural-person holder percents in
                               the proxy window. Parser largest block % = max
                               percent over non-group rows; gold = max single
                               holder percent.
  (iv)  GROUP-ROW DETECTION     share of scored filings with a flagged group row.

GATED vs DIAGNOSTIC. Exactly FOUR metrics gate: filing yield (parsed percent),
holder recall vs blockw, holder precision vs blockw, group-row detection — the
keys under `minimums` in thresholds.json. The two FactSet aggregate metrics in
(iii) are computed and printed with their denominators every run and NEVER affect
the exit code, because the FactSet gold is defined by a proxy window over all
FactSet stakes and mixes 13F / Form 4 positions (only 21 of 2,647 linked
firm-years carry a PXY marker); a 1 pp band over that gold would reward chasing
gold noise.

Splits: dev by default; `--holdout` scores the held-out firms and REFUSES while
GRIND_ITERATION is set in the environment, because a loop that can read the
holdout has no holdout.

`--check` exits 0 only if every gated metric clears its threshold in the locked
thresholds file, 1 otherwise. `--verify-lock` (on by default) recomputes the
sha256 of this script, the gold files and the thresholds against lock.sha256 and
exits 3 on any mismatch: a loop that may edit the scorer can pass any threshold.

Exit codes: 0 pass (with --check) or scored, 1 a gated metric is short,
3 the lock does not verify, 4 --holdout refused inside a grind iteration.
"""

import argparse
import csv
import glob
import gzip
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

PCT_TOL_HOLDER = 0.5     # (ii) percentage points
PCT_TOL_AGG = 1.0        # (iii) percentage points
BLOCK_FLOOR = 5.0        # blockw's covered universe, in percent of class
GOLD_PCT_CEILING = 100.0  # a gold percent above this is a denominator defect, not a holding

SUFFIXES = {
    "JR", "SR", "II", "III", "IV", "V", "MD", "PHD", "ESQ", "CPA",
    "INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LP", "LLP", "LLC",
    "PLC", "NA", "TRUST", "THE", "AND", "ET", "AL", "GROUP", "HOLDINGS", "HOLDING",
}
TOKEN = re.compile(r"[A-Z0-9]+")


def name_key(s):
    """Fold a holder name to a comparable token set.

    blockw writes "WALTON; JIM C." and the proxy writes "Jim C. Walton", so the
    key must be order-free. Single letters are kept as initials but never carry a
    match on their own.
    """
    s = (s or "").upper()
    s = s.replace("&", " AND ")
    toks = [t for t in TOKEN.findall(s) if t not in SUFFIXES]
    return frozenset(t for t in toks if len(t) >= 2), frozenset(t for t in toks if len(t) == 1)


def names_match(a, b):
    """True when two holder names denote the same holder.

    Requires a shared long token; two shared long tokens, or one plus a shared
    initial, or the gold name having only one long token to share.
    """
    a_long, a_init = a
    b_long, b_init = b
    if not a_long or not b_long:
        return False
    shared = a_long & b_long
    if not shared:
        return False
    if len(shared) >= 2:
        return True
    if a_init & b_init:
        return True
    # One long token each (e.g. "FMR" vs "FMR"), or a one-token gold name that is
    # fully contained in the parsed name.
    return len(a_long) == 1 or len(b_long) == 1


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_tsv_gz(pattern):
    """Rows from every file matching `pattern`, as dicts. Header per file."""
    n_files = 0
    for path in sorted(glob.glob(pattern)):
        n_files += 1
        with gzip.open(path, "rt") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                yield r
    if n_files == 0:
        sys.exit("ERROR: no files matched %s" % pattern)


def fnum(s):
    if s is None or s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def verify_lock(lock_path, files):
    """Every path in the lock must hash to its recorded value."""
    with open(lock_path) as fh:
        want = {}
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            h, name = line.split(None, 1)
            want[name.strip()] = h
    bad = []
    for name, path in sorted(files.items()):
        if name not in want:
            bad.append("%s: not in lock" % name)
            continue
        got = sha256_of(path)
        if got != want[name]:
            bad.append("%s: lock=%s actual=%s" % (name, want[name][:16], got[:16]))
    missing = sorted(set(want) - set(files))
    for name in missing:
        bad.append("%s: in lock but not presented" % name)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True, help="glob for parser row files (*.tsv.gz)")
    ap.add_argument("--manifest", required=True, help="glob for parser manifest files (*.manifest.tsv.gz)")
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--thresholds", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                        "..", "thresholds.json"))
    ap.add_argument("--lock", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "..", "lock.sha256"))
    ap.add_argument("--holdout", action="store_true", help="score the HOLDOUT firms instead of dev")
    ap.add_argument("--check", action="store_true", help="exit 0 iff every gated metric clears its threshold")
    ap.add_argument("--no-verify-lock", action="store_true", help="skip the hash lock (for lock creation only)")
    ap.add_argument("--miss-report", default="", help="write the per-filing miss decomposition here")
    ap.add_argument("--json-out", default="", help="write the metrics as JSON here")
    args = ap.parse_args()

    g = args.gold_dir
    if args.holdout and os.environ.get("GRIND_ITERATION"):
        print("REFUSED: --holdout inside a grind iteration (GRIND_ITERATION=%s). "
              "A loop that can read the holdout has no holdout."
              % os.environ["GRIND_ITERATION"], file=sys.stderr)
        sys.exit(4)

    thresholds = json.load(open(args.thresholds))

    if not args.no_verify_lock:
        files = {
            "scorer/score.py": os.path.abspath(__file__),
            "thresholds.json": os.path.abspath(args.thresholds),
            "gold/gold_blockw.tsv.gz": os.path.join(g, "gold_blockw.tsv.gz"),
            "gold/gold_factset.tsv.gz": os.path.join(g, "gold_factset.tsv.gz"),
            "gold/gold_factset_firmyear.tsv.gz": os.path.join(g, "gold_factset_firmyear.tsv.gz"),
            "gold/holdout.tsv": os.path.join(g, "holdout.tsv"),
        }
        bad = verify_lock(args.lock, files)
        if bad:
            print("LOCK MISMATCH:", file=sys.stderr)
            for b in bad:
                print("  " + b, file=sys.stderr)
            sys.exit(3)
        print("[lock] %s verified over %d files" % (args.lock, len(files)))

    want_split = "holdout" if args.holdout else "dev"
    split = {}
    with open(os.path.join(g, "holdout.tsv")) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            split[r["cik"].lstrip("0") or "0"] = r["split"]
    print("[in ] holdout.tsv: %d firms (%d %s)" % (
        len(split), sum(1 for v in split.values() if v == want_split), want_split))

    def in_split(cik):
        return split.get(str(cik).lstrip("0") or "0") == want_split

    # ---- gold ---------------------------------------------------------------
    # blockw holder rows, keyed by (cik_int, accession)
    gold_block = defaultdict(list)
    gold_block_filings = set()
    n_block_rows = n_block_noblock = 0
    for r in read_tsv_gz(os.path.join(g, "gold_blockw.tsv.gz")):
        cik = r["cik"].lstrip("0") or "0"
        if not in_split(cik):
            continue
        key = (cik, r["accession"])
        gold_block_filings.add(key)
        if r["no_blockholder"] == "1":
            n_block_noblock += 1
            continue
        pct = fnum(r["holder_pct"])
        if pct is None or pct > GOLD_PCT_CEILING:
            continue
        gold_block[key].append({"name": r["holder_name"], "key": name_key(r["holder_name"]),
                                "pct": pct})
        n_block_rows += 1
    print("[in ] gold blockw (%s): %d filings, %d holder rows, %d no-blockholder rows" % (
        want_split, len(gold_block_filings), n_block_rows, n_block_noblock))

    gold_fs = {}
    for r in read_tsv_gz(os.path.join(g, "gold_factset_firmyear.tsv.gz")):
        cik = r["cik"].lstrip("0") or "0"
        if not in_split(cik):
            continue
        lb, ins = fnum(r["largest_block_pct"]), fnum(r["insider_sum_pct"])
        gold_fs[(cik, r["accession"])] = {
            "largest": lb if (lb is not None and lb <= GOLD_PCT_CEILING) else None,
            "insider_sum": ins if (ins is not None and ins <= GOLD_PCT_CEILING) else None,
            "n_pxy": int(r["n_pxy_rows"] or 0),
        }
    print("[in ] gold factset (%s): %d filings" % (want_split, len(gold_fs)))

    gold_filings = gold_block_filings | set(gold_fs)
    if not gold_filings:
        sys.exit("ERROR: no gold filings in split %s" % want_split)

    # ---- parser output ------------------------------------------------------
    man = {}
    for r in read_tsv_gz(args.manifest):
        cik = r["cik"].lstrip("0") or "0"
        key = (cik, r["accession"])
        if key in gold_filings:
            man[key] = r
    print("[in ] parser manifest rows matching gold filings: %d" % len(man))

    parsed = defaultdict(list)
    n_rows_read = 0
    for r in read_tsv_gz(args.rows):
        cik = r["cik"].lstrip("0") or "0"
        key = (cik, r["accession"])
        if key not in gold_filings:
            continue
        n_rows_read += 1
        parsed[key].append({
            "name": r["holder_name"], "key": name_key(r["holder_name"]),
            "pct": fnum(r["percent"]), "marker": r["percent_marker"],
            "group": r["is_group_row"] == "1", "inst": r["is_institution"] == "1",
            "cls": r["share_class"], "kind": r["table_kind"],
        })
    print("[in ] parser ownership rows in gold filings: %d" % n_rows_read)

    # ---- (i) filing yield ---------------------------------------------------
    scored = sorted(gold_filings)
    n_gold = len(scored)
    n_present = sum(1 for k in scored if k in man)
    has_any = {k for k in scored if parsed.get(k)}
    has_pct = {k for k in scored if any(p["pct"] is not None for p in parsed.get(k, []))}
    yield_any = len(has_any) / n_gold
    yield_pct = len(has_pct) / n_gold
    print("\n== (i) FILING YIELD (denominator = %d gold-linked %s filings) ==" % (n_gold, want_split))
    print("  filings present in the parser manifest : %d (%.2f%%)" % (n_present, 100 * n_present / n_gold))
    print("  >=1 ownership row                      : %d (%.2f%%)" % (len(has_any), 100 * yield_any))
    print("  >=1 PARSED PERCENT  [gated]            : %d (%.2f%%)" % (len(has_pct), 100 * yield_pct))

    # ---- (ii) holder recall / precision vs blockw ---------------------------
    gold_rows_scored = tp_recall = 0
    miss_name = miss_pct = miss_notable = 0
    cand_rows = tp_prec = 0
    for k in scored:
        gold = [x for x in gold_block.get(k, []) if x["pct"] >= BLOCK_FLOOR]
        prows = parsed.get(k, [])
        cands = [p for p in prows if (not p["group"]) and p["pct"] is not None and p["pct"] >= BLOCK_FLOOR]
        for x in gold:
            gold_rows_scored += 1
            if not prows:
                miss_notable += 1
                continue
            nm = [p for p in prows if names_match(p["key"], x["key"])]
            if not nm:
                miss_name += 1
                continue
            if any(p["pct"] is not None and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER for p in nm):
                tp_recall += 1
            else:
                miss_pct += 1
        if gold_block.get(k):  # precision only where blockw covers the filing
            for p in cands:
                cand_rows += 1
                if any(names_match(p["key"], x["key"]) and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER
                       for x in gold_block[k]):
                    tp_prec += 1
    recall = tp_recall / gold_rows_scored if gold_rows_scored else 0.0
    precision = tp_prec / cand_rows if cand_rows else 0.0
    print("\n== (ii) HOLDER MATCH vs blockw (name + percent within %.1f pp, both sides >= %.1f%%) ==" % (
        PCT_TOL_HOLDER, BLOCK_FLOOR))
    print("  RECALL    [gated]: %d / %d gold holder rows = %.2f%%" % (tp_recall, gold_rows_scored, 100 * recall))
    print("    missed, filing had no parsed row : %d" % miss_notable)
    print("    missed, no name match            : %d" % miss_name)
    print("    missed, name matched, percent off : %d" % miss_pct)
    print("  PRECISION [gated]: %d / %d parsed non-group rows >= %.1f%% = %.2f%%" % (
        tp_prec, cand_rows, BLOCK_FLOOR, 100 * precision))

    # ---- (iii) aggregates vs FactSet ---------------------------------------
    def agg_agreement(field, pick):
        n_comp = n_ok = 0
        gaps = []
        for k in scored:
            gf = gold_fs.get(k)
            if not gf or gf[field] is None:
                continue
            v = pick(parsed.get(k, []))
            if v is None:
                continue
            n_comp += 1
            gap = abs(v - gf[field])
            gaps.append(gap)
            if gap <= PCT_TOL_AGG:
                n_ok += 1
        gaps.sort()
        med = gaps[len(gaps) // 2] if gaps else None
        mad = sum(gaps) / len(gaps) if gaps else None
        return n_ok, n_comp, med, mad

    def pick_group(rows):
        vals = [p["pct"] for p in rows if p["group"] and p["pct"] is not None]
        return max(vals) if vals else None

    def pick_largest(rows):
        vals = [p["pct"] for p in rows if (not p["group"]) and p["pct"] is not None]
        return max(vals) if vals else None

    g_ok, g_n, g_med, g_mad = agg_agreement("insider_sum", pick_group)
    l_ok, l_n, l_med, l_mad = agg_agreement("largest", pick_largest)
    grp_agree = g_ok / g_n if g_n else 0.0
    lrg_agree = l_ok / l_n if l_n else 0.0
    print("\n== (iii) AGGREGATE AGREEMENT vs FactSet (within %.1f pp) — DIAGNOSTIC, NOT GATED ==" % PCT_TOL_AGG)
    print("  D&O group %% vs FactSet insider sum  [DIAGNOSTIC]: %d / %d comparable = %.2f%%  (median |gap| %s pp, MAD %s pp)" % (
        g_ok, g_n, 100 * grp_agree, fmt(g_med), fmt(g_mad)))
    print("  largest block %% vs FactSet largest  [DIAGNOSTIC]: %d / %d comparable = %.2f%%  (median |gap| %s pp, MAD %s pp)" % (
        l_ok, l_n, 100 * lrg_agree, fmt(l_med), fmt(l_mad)))
    print("  the FactSet gold is a proxy-window selection over all FactSet stakes (13F / Form 4 mixed;")
    print("  21 of 2,647 linked firm-years carry a PXY marker), so these two never affect the exit code.")

    # ---- (iv) group-row detection ------------------------------------------
    n_grp = sum(1 for k in has_pct if any(p["group"] for p in parsed[k]))
    grp_rate = n_grp / len(has_pct) if has_pct else 0.0
    print("\n== (iv) GROUP-ROW DETECTION (denominator = %d filings with a parsed percent) ==" % len(has_pct))
    print("  filings with a flagged D&O group row [gated]: %d (%.2f%%)" % (n_grp, 100 * grp_rate))

    # ---- miss decomposition -------------------------------------------------
    causes = defaultdict(int)
    detail = []
    for k in scored:
        m = man.get(k)
        prows = parsed.get(k, [])
        gold = [x for x in gold_block.get(k, []) if x["pct"] >= BLOCK_FLOOR]
        gf = gold_fs.get(k)
        cause = ""
        if m is None:
            cause = "link_failure_not_in_manifest"
        elif m.get("parse_status") != "ok":
            cause = "read_error"
        elif not prows:
            cause = "no_table_found_plain_text" if m.get("parser") == "text_table" else "no_table_found_html"
        elif not any(p["pct"] is not None for p in prows):
            cause = "table_found_no_percent"
        elif gold and not any(
                any(names_match(p["key"], x["key"]) for p in prows) for x in gold):
            cause = "name_mismatch"
        elif gold and not any(
                any(names_match(p["key"], x["key"]) and p["pct"] is not None
                    and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER for p in prows) for x in gold):
            cause = "percent_mismatch"
        elif not any(p["group"] for p in prows):
            cause = "group_row_missing"
        elif gf and gf["largest"] is not None and pick_largest(prows) is not None \
                and abs(pick_largest(prows) - gf["largest"]) > PCT_TOL_AGG:
            cause = "aggregate_gap_multi_class_or_denominator"
        else:
            cause = "ok"
        causes[cause] += 1
        detail.append((k[0], k[1], cause, len(prows), len(gold),
                       "" if m is None else m.get("parser", "")))
    print("\n== MISS DECOMPOSITION (denominator = %d gold-linked %s filings) ==" % (n_gold, want_split))
    for c in sorted(causes, key=lambda c: (-causes[c], c)):
        print("  %-42s %6d (%5.2f%%)" % (c, causes[c], 100 * causes[c] / n_gold))

    if args.miss_report:
        detail.sort()
        with open(args.miss_report, "w") as fh:
            fh.write("cik\taccession\tcause\tn_parsed_rows\tn_gold_rows_ge5\tparser\n")
            for row in detail:
                fh.write("\t".join(str(x) for x in row) + "\n")
        print("[out] %s: %d rows" % (args.miss_report, len(detail)))

    metrics = {
        "split": want_split,
        "gold_filings": n_gold,
        "filing_yield_any_row": yield_any,
        "filing_yield_parsed_percent": yield_pct,
        "holder_recall_blockw": recall,
        "holder_precision_blockw": precision,
        "holder_gold_rows_scored": gold_rows_scored,
        "holder_candidate_rows": cand_rows,
        "group_pct_agreement_factset": grp_agree,
        "group_pct_comparable": g_n,
        "largest_block_agreement_factset": lrg_agree,
        "largest_block_comparable": l_n,
        "group_row_detection_rate": grp_rate,
        "median_abs_gap_group_pp": g_med,
        "mad_group_pp": g_mad,
        "median_abs_gap_largest_pp": l_med,
        "mad_largest_pp": l_mad,
        "miss_causes": dict(sorted(causes.items())),
    }
    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump(metrics, fh, indent=2, sort_keys=True)
            fh.write("\n")
        print("[out] %s" % args.json_out)

    values = {
        "filing_yield_parsed_percent": yield_pct,
        "holder_recall_blockw": recall,
        "holder_precision_blockw": precision,
        "group_row_detection_rate": grp_rate,
        "group_pct_agreement_factset": grp_agree,
        "largest_block_agreement_factset": lrg_agree,
    }
    # GATED = exactly the keys in thresholds["minimums"]. Every other metric is
    # diagnostic: printed with its denominator, never able to change the exit code.
    gated_names = list(thresholds["minimums"])
    unknown = [n for n in gated_names if n not in values]
    if unknown:
        sys.exit("ERROR: thresholds.json gates unknown metric(s): %s" % ", ".join(sorted(unknown)))
    diag_names = [n for n in thresholds.get("diagnostics", []) if n in values]

    print("\n== GATED METRICS (%d; thresholds %s) ==" % (len(gated_names), os.path.abspath(args.thresholds)))
    failed = []
    for name in gated_names:
        val, thr = values[name], thresholds["minimums"][name]
        ok = val >= thr
        print("  %-34s %.4f  >= %.4f  %s" % (name, val, thr, "PASS" if ok else "FAIL"))
        if not ok:
            failed.append("%s: %.4f < %.4f" % (name, val, thr))

    if diag_names:
        print("\n== DIAGNOSTIC METRICS (%d; no threshold, NO effect on the exit code) ==" % len(diag_names))
        for name in diag_names:
            print("  %-34s %.4f  (diagnostic)" % (name, values[name]))

    if args.check:
        if failed:
            print("\nCHECK FAIL (%d of %d gated metric(s) short):" % (len(failed), len(gated_names)))
            for f in failed:
                print("  " + f)
            sys.exit(1)
        print("\nCHECK PASS: all %d gated metrics clear their thresholds" % len(gated_names))
        sys.exit(0)
    if failed:
        print("\n(%d gated metric(s) below threshold; --check would exit 1)" % len(failed))


def fmt(v):
    return "n/a" if v is None else "%.3f" % v


if __name__ == "__main__":
    main()
