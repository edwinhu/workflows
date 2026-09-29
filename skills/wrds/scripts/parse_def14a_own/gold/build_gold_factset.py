#!/usr/bin/env python3
"""build_gold_factset.py — gold set (b): FactSet ownership stakes, 2006-2021.

`factset_own.own_stakes_detail_eq` at (security, holding entity, report_date)
grain, with the percent computed against
`own_sec_prices_eq.adj_shares_outstanding` — the table carries no percentage
column, and `unadj_shares_outstanding` is on a different (pre-split) basis than
`position`, so dividing by it is wrong by the split factor.

WHAT "PROXY-SOURCED" MEANS HERE, and why it is not the PXY marker.
  Measured on this run (US securities, 2006-2021, one query per line):
    comments ILIKE '%PXY%'              3,546 rows /   ~400 securities, total
    of which source_code R              2,048 rows (24.7% of all R rows)
    of which source_code O                798 rows ( 0.087% of all O rows)
  So the literal PXY marker is a comment convention used on a few hundred
  securities, and most of those comments read "VIA <other company> PXY" — a
  stake in a DIFFERENT issuer disclosed through that issuer's proxy. There is no
  source_code that means "proxy statement": no decode table exists for this
  field (`factset.ref_metadata_codes` has no own_stakes entry), and the
  period-end test that would separate a 13F feed from a proxy feed fails
  (source_code K, the 13F feed, is only 7.5% month-end, so `report_date` is an
  event date, not a period end).

  The gold set is therefore defined by the PROXY WINDOW, not by a marker: for
  each linked DEF 14A, the stakes whose `report_date` falls in
  [filing_date - 90d, filing_date + 7d], one row per holder (its latest
  report_date in the window). That selects WHEN, never WHAT, so the values stay
  independent of the parser. `n_pxy_rows` is carried per firm-year so the
  marker-restricted subsample can be scored separately as a robustness cut.

Link chain, every leg with counts and a match rate printed (E3):
    own_sec_coverage_eq (iso_country='US', issue_type='EQ')
      -> factset.sym_cusip                (fsym_id -> cusip9)
      -> wrdssec.wciklink_cusip           (cusip8  -> cik)
      -> def14a_index                     (cik     -> DEF 14A filings 2006-2021)

Output (outside git):
    $GOLD_DIR/gold_factset.tsv.gz        one row per (filing, holder)
    $GOLD_DIR/gold_factset_firmyear.tsv.gz  per-filing gold aggregates
    $GOLD_DIR/gold_factset.json          sidecar: SQL, params, pull date, rows, sha256
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

import psycopg2

SQL_SYMS = """
select sc.fsym_id, sc.cusip, c.security_name
from factset_own.own_sec_coverage_eq c
join factset.sym_cusip sc on sc.fsym_id = c.fsym_id
where c.iso_country = 'US' and c.issue_type = 'EQ'
"""

SQL_WCIK = """
select cik, cusip from wrdssec.wciklink_cusip
where cusip is not null and cik <> '0000000000'
"""

SQL_STAKES = """
select s.fsym_id, s.factset_entity_id, s.position, s.indirect_options,
       s.report_date, s.source_code, s.comments, s.current_flag,
       e.entity_proper_name, e.entity_type
from factset_own.own_stakes_detail_eq s
left join factset.sym_entity e on e.factset_entity_id = s.factset_entity_id
where s.fsym_id = any(%(syms)s)
  and s.report_date between %(d0)s and %(d1)s
"""

SQL_PRICES = """
select fsym_id, price_date, adj_shares_outstanding
from factset_own.own_sec_prices_eq
where fsym_id = any(%(syms)s)
  and price_date between %(d0)s and %(d1)s
  and adj_shares_outstanding is not null
"""

WIN_BEFORE = 90
WIN_AFTER = 7
PRICE_LOOKBACK = 100


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--user", default="edwin_hu", help="factset_own is licensed on edwin_hu only")
    ap.add_argument("--start", default="2006-01-01")
    ap.add_argument("--end", default="2021-12-31")
    ap.add_argument("--n-firmyears", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=20260928)
    args = ap.parse_args()

    con = psycopg2.connect(
        host="wrds-pgdata.wharton.upenn.edu", port=9737, database="wrds",
        user=args.user, sslmode="require",
    )
    cur = con.cursor()

    cur.execute(SQL_SYMS)
    syms = cur.fetchall()
    print("[in ] US EQ securities with a cusip: %d" % len(syms))

    cur.execute(SQL_WCIK)
    wcik = cur.fetchall()
    print("[in ] wrdssec.wciklink_cusip: %d rows" % len(wcik))

    cik_by_cusip8 = defaultdict(set)
    for cik, cusip in wcik:
        cik_by_cusip8[cusip.strip()].add(cik)

    # fsym_id -> ciks
    ciks_by_sym, name_by_sym = {}, {}
    n_sym_no_cik = 0
    for fsym, cusip9, secname in syms:
        ciks = cik_by_cusip8.get((cusip9 or "")[:8], set())
        name_by_sym[fsym] = secname or ""
        if not ciks:
            n_sym_no_cik += 1
            continue
        ciks_by_sym[fsym] = ciks
    print("[join] fsym_id -> cik: %d of %d matched (%.1f%%), %d unmatched" % (
        len(ciks_by_sym), len(syms), 100 * len(ciks_by_sym) / len(syms), n_sym_no_cik))

    # DEF 14A filings in range, by cik
    filings_by_cik = defaultdict(list)
    with gzip.open(os.path.join(args.gold_dir, "def14a_index.tsv.gz"), "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if args.start <= r["filing_date"] <= args.end:
                filings_by_cik[r["cik"]].append(
                    (dt.date.fromisoformat(r["filing_date"]), r["accession"], r["relpath"], r["coname"]))
    n_filings_in_range = sum(len(v) for v in filings_by_cik.values())
    print("[in ] DEF 14A filings %s..%s: %d across %d ciks" % (
        args.start, args.end, n_filings_in_range, len(filings_by_cik)))

    # candidate (fsym_id, cik, filing) universe
    cands = []
    for fsym, ciks in sorted(ciks_by_sym.items()):
        for cik in sorted(ciks):
            for fdate, acc, rel, coname in filings_by_cik.get(cik, []):
                cands.append((fsym, cik, fdate, acc, rel, coname))
    # one security per filing: a cusip can map to several fsym_ids (share classes)
    best_by_filing = {}
    for fsym, cik, fdate, acc, rel, coname in cands:
        key = (cik, acc)
        if key not in best_by_filing or fsym < best_by_filing[key][0]:
            best_by_filing[key] = (fsym, cik, fdate, acc, rel, coname)
    universe = sorted(best_by_filing.values(), key=lambda t: (t[1], t[3]))
    print("[join] candidate (filing x security) pairs: %d raw -> %d filings" % (len(cands), len(universe)))
    print("        filing coverage: %d of %d DEF 14A in range have a FactSet security (%.1f%%)" % (
        len(universe), n_filings_in_range, 100 * len(universe) / n_filings_in_range))

    rng = random.Random(args.seed)
    sample = universe if len(universe) <= args.n_firmyears else rng.sample(universe, args.n_firmyears)
    sample.sort(key=lambda t: (t[1], t[3]))
    print("[samp] seed=%d n_firmyears=%d -> %d sampled filings, %d distinct securities, %d ciks" % (
        args.seed, args.n_firmyears, len(sample), len({s[0] for s in sample}), len({s[1] for s in sample})))

    sym_list = sorted({s[0] for s in sample})
    d0 = min(s[2] for s in sample) - dt.timedelta(days=WIN_BEFORE)
    d1 = max(s[2] for s in sample) + dt.timedelta(days=WIN_AFTER)

    cur.execute(SQL_STAKES, {"syms": sym_list, "d0": d0, "d1": d1})
    stakes = cur.fetchall()
    print("[in ] own_stakes_detail_eq for sampled securities: %d rows" % len(stakes))

    cur.execute(SQL_PRICES, {"syms": sym_list,
                             "d0": d0 - dt.timedelta(days=PRICE_LOOKBACK), "d1": d1})
    prices = cur.fetchall()
    print("[in ] own_sec_prices_eq: %d rows" % len(prices))
    con.close()

    px = defaultdict(list)
    for fsym, pdate, shrout in prices:
        px[fsym].append((pdate, float(shrout)))
    for v in px.values():
        v.sort()

    def shares_out(fsym, on):
        """Latest adj_shares_outstanding at or before `on`, within PRICE_LOOKBACK days."""
        best = None
        for pdate, shrout in px.get(fsym, []):
            if pdate <= on:
                best = (pdate, shrout)
            else:
                break
        if best and (on - best[0]).days <= PRICE_LOOKBACK and best[1] > 0:
            return best
        return None

    by_sym = defaultdict(list)
    for rec in stakes:
        by_sym[rec[0]].append(rec)

    holder_cols = ["gold_set", "cik", "accession", "filing_date", "relpath", "fsym_id",
                   "security_name", "factset_entity_id", "holder_name", "entity_type",
                   "is_natural_person", "position", "report_date", "source_code",
                   "is_pxy_comment", "shares_outstanding", "shrout_date", "holder_pct"]
    fy_cols = ["gold_set", "cik", "accession", "filing_date", "relpath", "fsym_id",
               "security_name", "n_holders", "largest_block_pct", "largest_block_holder",
               "insider_sum_pct", "n_insider_holders", "n_pxy_rows", "shares_outstanding"]

    holder_rows, fy_rows = [], []
    n_no_stake = n_no_shrout = 0
    for fsym, cik, fdate, acc, rel, _coname in sample:
        lo, hi = fdate - dt.timedelta(days=WIN_BEFORE), fdate + dt.timedelta(days=WIN_AFTER)
        # latest report_date per holder inside the window
        latest = {}
        for (_f, ent, pos, _io, rdate, scode, comments, _cf, ename, etype) in by_sym.get(fsym, []):
            if not (lo <= rdate <= hi) or pos is None:
                continue
            k = ent
            if k not in latest or rdate > latest[k][1]:
                latest[k] = (ent, rdate, float(pos), scode or "", comments or "", ename, etype)
        if not latest:
            n_no_stake += 1
            continue
        so = shares_out(fsym, fdate)
        if so is None:
            n_no_shrout += 1
            continue
        shrout_date, shrout = so
        rows = []
        for ent, rdate, pos, scode, comments, ename, etype in sorted(latest.values()):
            pct = 100.0 * pos / shrout
            natural = 1 if ename is None else 0
            rows.append([
                "factset", cik, acc, fdate, rel, fsym, name_by_sym.get(fsym, ""),
                ent, (ename or "").replace("\t", " "), etype or "", natural,
                "%.0f" % pos, rdate, scode, 1 if "PXY" in comments.upper() else 0,
                "%.0f" % shrout, shrout_date, "%.6f" % pct,
            ])
        holder_rows.extend(rows)
        largest = max(rows, key=lambda r: float(r[17]))
        ins = [r for r in rows if r[10] == 1]
        fy_rows.append([
            "factset", cik, acc, fdate, rel, fsym, name_by_sym.get(fsym, ""),
            len(rows), "%.6f" % float(largest[17]), largest[8] or largest[7],
            "%.6f" % sum(float(r[17]) for r in ins), len(ins),
            sum(int(r[14]) for r in rows), "%.0f" % shrout,
        ])

    n_s = len(sample)
    print("\n[join] sampled filings -> gold (denominator = %d sampled filings)" % n_s)
    print("  dropped, no stake in the +-window   : %d (%.1f%%)" % (n_no_stake, 100 * n_no_stake / n_s))
    print("  dropped, no shares outstanding      : %d (%.1f%%)" % (n_no_shrout, 100 * n_no_shrout / n_s))
    print("  LINKED filings                      : %d (%.1f%%)" % (len(fy_rows), 100 * len(fy_rows) / n_s))
    print("  holder rows                         : %d" % len(holder_rows))
    n_pxy_fy = sum(1 for r in fy_rows if int(r[12]) > 0)
    print("  filings with >=1 PXY-marked row     : %d (%.1f%% of linked)" % (
        n_pxy_fy, 100 * n_pxy_fy / max(len(fy_rows), 1)))

    holder_rows.sort(key=lambda r: (r[1], str(r[3]), r[2], r[7]))
    fy_rows.sort(key=lambda r: (r[1], str(r[3]), r[2]))
    out_h = os.path.join(args.gold_dir, "gold_factset.tsv.gz")
    out_f = os.path.join(args.gold_dir, "gold_factset_firmyear.tsv.gz")
    for path, cols, rows in [(out_h, holder_cols, holder_rows), (out_f, fy_cols, fy_rows)]:
        with gzip.open(path, "wt") as fh:
            fh.write("\t".join(cols) + "\n")
            for r in rows:
                fh.write("\t".join(str(x) for x in r) + "\n")
        print("[out] %s: %d rows x %d cols" % (path, len(rows), len(cols)))

    side = {
        "artifact": [os.path.basename(out_h), os.path.basename(out_f)],
        "gold_set": "factset",
        "source": "factset_own.own_stakes_detail_eq + own_sec_prices_eq (adj_shares_outstanding)",
        "proxy_definition": ("stakes whose report_date falls in [filing_date-%dd, filing_date+%dd]; "
                             "one row per holder (latest report_date in window). NOT the PXY comment "
                             "marker: that marker covers ~400 US securities in total and mostly reads "
                             "'VIA <other issuer> PXY'." % (WIN_BEFORE, WIN_AFTER)),
        "sql": {"syms": " ".join(SQL_SYMS.split()), "wciklink_cusip": " ".join(SQL_WCIK.split()),
                "stakes": " ".join(SQL_STAKES.split()), "prices": " ".join(SQL_PRICES.split())},
        "params": {"start": args.start, "end": args.end, "n_firmyears": args.n_firmyears,
                   "seed": args.seed, "window_before_days": WIN_BEFORE,
                   "window_after_days": WIN_AFTER, "price_lookback_days": PRICE_LOOKBACK},
        "wrds_account": args.user,
        "pull_date": dt.datetime.now().astimezone().isoformat(),
        "universe_filings": len(universe), "def14a_filings_in_range": n_filings_in_range,
        "sampled_filings": n_s, "linked_filings": len(fy_rows),
        "holder_rows": len(holder_rows),
        "dropped": {"no_stake_in_window": n_no_stake, "no_shares_outstanding": n_no_shrout},
        "filings_with_pxy_row": n_pxy_fy,
        "sha256": {os.path.basename(out_h): sha256_of(out_h),
                   os.path.basename(out_f): sha256_of(out_f)},
    }
    sc = os.path.join(args.gold_dir, "gold_factset.json")
    with open(sc, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True, default=str)
        fh.write("\n")
    print("[out] %s" % sc)


if __name__ == "__main__":
    main()
