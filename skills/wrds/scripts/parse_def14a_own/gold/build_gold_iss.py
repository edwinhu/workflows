#!/usr/bin/env python3
"""build_gold_iss.py — gold set (c): ISS/RiskMetrics directors, 2002-2024.

A MODERN-ERA holder-level yardstick. The two WRDS blockholder gold sets stop at
2001 (`blockw`) or are firm-level and noisy (`factset`); ISS Directors carries a
per-director share count and voting-power percent stamped with the proxy's
`meetingdate`, which is exactly the individual-holder half of the DEF 14A
*Security Ownership of Certain Beneficial Owners and Management* table.

    risk_directors.rmdirectors  2007-2024  9-char as-delivered cusip
    risk_directors.directors    2002-2006  6-char header cusip (WRDS-backfilled)

Grain out: one row per (company, meeting, director).

WHAT ISS DOES NOT CARRY, so the scorer must not treat its absence as a miss:
  * no "all directors and executive officers as a group" row
  * no non-director 5% blockholder (FMR, Vanguard, a family LP off the board)
  * executive officers who are not directors — the proxy table lists them, ISS
    does not
(verified in /home/eh/projects/r2000/scratch/ownership_sources.md §2)

KNOWN VENDOR DEFECT, detected and FLAGGED rather than silently used: some
`num_of_shares` values are low by a factor of ~100. The Walmart rows are the
documented case — 2015 `JIM C. WALTON` 16,217,556 shares at
`pcnt_ctrl_votingpower` 50.28 against 3.226bn shares outstanding, i.e. the stated
percent implies 1.622bn shares, a ratio of 100.005. The detector is therefore
external: CRSP `msf.shrout` at the month-end on or before `meetingdate` gives
shares outstanding, and a row whose reported share count is far below what its own
stated percent implies is flagged.

    flag_shares_100x        pcnt >= 1.0, shrout known, and
                            shares / (pcnt/100 * shrout) < 0.05
    flag_shares_gt_out      shares > 1.05 * shrout   (a share count above the
                            whole float is not a holding)
    flag_no_shares          num_of_shares null or 0

Link chain, every leg's row count and match rate printed (E3):
    ISS cusip
      -> cusip8  (rmdirectors: cusip9[:8];  legacy: cusip6 -> wciklink cusip8[:6])
      -> wrdssec.wciklink_cusip.cik
      -> def14a_index_iss (cik, filing_date in [meetingdate-120d, meetingdate-7d])
    ISS cusip -> crsp.stocknames.ncusip -> crsp.msf.shrout   (defect detector only)

Output (outside git):
    $GOLD_DIR/gold_iss_all.tsv.gz    every linked ISS director row (pre-sample)
    $GOLD_DIR/gold_iss_all.json      sidecar: SQL, params, pull date, rows, sha256
"""

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
from collections import defaultdict

import psycopg2

SQL_RM = """
select year, company_id::bigint as co_id, ticker, cusip, name, meetingdate,
       fullname, classification, ownless1, num_of_shares, pcnt_ctrl_votingpower,
       director_detail_id
from risk_directors.rmdirectors
where meetingdate between %(d0)s and %(d1)s
order by cusip, meetingdate, fullname
"""

SQL_LEGACY = """
select year, legacy_pps_id::bigint as co_id, ticker, cusip, name, meetingdate,
       fullname, classification, ownless1::text as ownless1, num_of_shares,
       pcnt_ctrl_votingpower, director_detail_id
from risk_directors.directors
where meetingdate between %(d0)s and %(d1)s
order by cusip, meetingdate, fullname
"""

SQL_WCIK = """
select cik, cusip, coname from wrdssec.wciklink_cusip
where cusip is not null and cik <> '0000000000'
"""

# shares outstanding for the defect detector. Joined server-side so only
# (ncusip, month, shrout) crosses the wire — never the full msf.
SQL_SHROUT = """
select sn.ncusip, m.date, m.shrout
from crsp.msf m
join crsp.stocknames sn
  on sn.permno = m.permno and m.date between sn.namedt and sn.nameenddt
where m.date between %(d0)s and %(d1)s
  and sn.ncusip is not null and m.shrout is not null and m.shrout > 0
"""


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_index(path):
    by_cik = {}
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            by_cik.setdefault(r["cik"], []).append(
                (dt.date.fromisoformat(r["filing_date"]), r["accession"], r["relpath"], r["coname"]))
    for v in by_cik.values():
        v.sort()
    return by_cik


def normname(s):
    s = (s or "").upper()
    for ch in ".,;&/'\"()-":
        s = s.replace(ch, " ")
    drop = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LP", "LLC", "PLC",
            "HOLDINGS", "HOLDING", "GROUP", "THE", "NEW", "CL", "A", "B"}
    return [t for t in s.split() if t not in drop]


def namematch(a, b):
    return bool(a) and bool(b) and a[0] == b[0]


COLS = [
    "gold_set", "iss_table", "co_id", "company_name", "ticker", "iss_cusip", "cusip8",
    "gold_year", "meetingdate", "director_name", "classification", "ownless1",
    "num_of_shares", "pcnt_ctrl_votingpower", "shrout_thousands", "implied_shares_from_pct",
    "flag_shares_100x", "flag_shares_gt_out", "flag_no_shares", "any_flag",
    "cik", "accession", "filing_date", "relpath", "days_before_meeting",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--index", default="def14a_index_iss.tsv.gz")
    ap.add_argument("--start", default="2002-01-01")
    ap.add_argument("--end", default="2024-12-31")
    ap.add_argument("--win-lo-days", type=int, default=120)
    ap.add_argument("--win-hi-days", type=int, default=7)
    args = ap.parse_args()
    g = args.gold_dir

    con = psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                           database="wrds", user=args.user, sslmode="require")
    cur = con.cursor()

    cur.execute(SQL_RM, {"d0": max(args.start, "2007-01-01"), "d1": args.end})
    rm = cur.fetchall()
    print("[in ] risk_directors.rmdirectors %s..%s: %d rows" % (
        max(args.start, "2007-01-01"), args.end, len(rm)))

    cur.execute(SQL_LEGACY, {"d0": args.start, "d1": min(args.end, "2006-12-31")})
    lg = cur.fetchall()
    print("[in ] risk_directors.directors   %s..%s: %d rows" % (
        args.start, min(args.end, "2006-12-31"), len(lg)))

    cur.execute(SQL_WCIK)
    wcik = cur.fetchall()
    print("[in ] wrdssec.wciklink_cusip: %d rows" % len(wcik))

    cur.execute(SQL_SHROUT, {"d0": "2001-06-01", "d1": args.end})
    shr = cur.fetchall()
    print("[in ] crsp.msf x stocknames shrout rows: %d" % len(shr))
    con.close()

    # ---- indexes ------------------------------------------------------------
    cik_by_cusip8 = defaultdict(set)
    coname_by_cik = {}
    for cik, cusip, coname in wcik:
        cik_by_cusip8[cusip.strip()].add(cik)
        coname_by_cik.setdefault(cik, coname or "")
    cik_by_cusip6 = defaultdict(set)
    for c8, ciks in cik_by_cusip8.items():
        cik_by_cusip6[c8[:6]] |= ciks
    print("[idx] wciklink: %d distinct cusip8, %d distinct cusip6" % (
        len(cik_by_cusip8), len(cik_by_cusip6)))

    # ncusip8 -> sorted [(date, shrout)]
    shr_by_c8 = defaultdict(list)
    for ncusip, d, s in shr:
        shr_by_c8[ncusip.strip()].append((d, float(s)))
    for v in shr_by_c8.values():
        v.sort()
    shr_c8_by_c6 = defaultdict(list)
    for k in sorted(shr_by_c8):
        shr_c8_by_c6[k[:6]].append(k)
    print("[idx] shrout: %d distinct ncusip8, %d distinct ncusip6" % (
        len(shr_by_c8), len(shr_c8_by_c6)))

    index = load_index(os.path.join(g, args.index))
    print("[idx] %s: %d ciks" % (args.index, len(index)))

    # ---- dedupe -------------------------------------------------------------
    recs = []
    seen = set()
    n_dupe = 0
    for tbl, rows in (("rmdirectors", rm), ("directors", lg)):
        for r in rows:
            (year, co_id, ticker, cusip, name, mtg, fullname, cls, ownless1,
             shares, pcnt, _ddid) = r
            k = (tbl, (cusip or "").strip(), mtg, (fullname or "").strip().upper())
            if k in seen:
                n_dupe += 1
                continue
            seen.add(k)
            recs.append([tbl, year, co_id, ticker, (cusip or "").strip(), name, mtg,
                         fullname, cls, ownless1, shares, pcnt])
    print("[dedupe] (iss_table, cusip, meetingdate, fullname): dropped %d byte-duplicate rows -> %d" % (
        n_dupe, len(recs)))

    # ---- shares-outstanding lookup + defect flags ---------------------------
    def shrout_at(c8, when):
        """shrout (thousands) at the LAST month-end on or before `when`."""
        v = shr_by_c8.get(c8)
        if not v:
            return None
        lo, hi = 0, len(v) - 1
        best = None
        while lo <= hi:
            mid = (lo + hi) // 2
            if v[mid][0] <= when:
                best = v[mid][1]
                lo = mid + 1
            else:
                hi = mid - 1
        return best

    # ---- link ---------------------------------------------------------------
    n_rows_in = len(recs)
    n_no_cusip = n_no_cik = n_no_filing = 0
    n_amb_cik = n_contested = n_contested_unresolved = 0
    n_shrout_missing = 0
    flags = defaultdict(int)
    out = []
    meetings_seen, meetings_linked = set(), set()
    firms_seen, firms_linked = set(), set()

    for rec in recs:
        (tbl, year, co_id, ticker, cusip, name, mtg, fullname, cls, ownless1,
         shares, pcnt) = rec
        mkey = (tbl, cusip, mtg)
        meetings_seen.add(mkey)
        firms_seen.add((tbl, cusip))
        if not cusip:
            n_no_cusip += 1
            continue
        if tbl == "rmdirectors":
            c8 = cusip[:8]
            ciks = cik_by_cusip8.get(c8, set())
        else:
            c8 = cusip[:6]
            ciks = cik_by_cusip6.get(cusip[:6], set())
        if not ciks:
            n_no_cik += 1
            continue
        if len(ciks) > 1:
            n_amb_cik += 1

        lo = mtg - dt.timedelta(days=args.win_lo_days)
        hi = mtg - dt.timedelta(days=args.win_hi_days)
        cands = []
        for cik in sorted(ciks):
            for fdate, acc, rel, coname in index.get(cik, []):
                if lo <= fdate <= hi:
                    cands.append((cik, fdate, acc, rel, coname))
        if len({c[0] for c in cands}) > 1:
            n_contested += 1
            contested = True
        else:
            contested = False
        if not cands:
            n_no_filing += 1
            continue
        target = normname(name)
        named = [c for c in cands if namematch(normname(c[4]), target)]
        if contested and len({c[0] for c in named}) != 1:
            n_contested_unresolved += 1
        pool = named or cands
        pool.sort(key=lambda c: (c[1], c[0]))
        cik, fdate, acc, rel, _cn = pool[-1]

        # defect flags
        sh = float(shares) if shares is not None else None
        pc = float(pcnt) if pcnt is not None else None
        # shrout looked up on the 8-char ncusip; legacy cusip6 has no 8-char form,
        # so fall back to any ncusip8 with that 6-char prefix.
        so = None
        if tbl == "rmdirectors":
            so = shrout_at(cusip[:8], mtg)
        if so is None:
            for cand8 in shr_c8_by_c6.get(cusip[:6], ()):
                so = shrout_at(cand8, mtg)
                if so is not None:
                    break
        if so is None:
            n_shrout_missing += 1
        out_shares = so * 1000.0 if so is not None else None
        implied = (pc / 100.0 * out_shares) if (pc is not None and out_shares) else None
        f100 = 1 if (implied and implied > 0 and pc is not None and pc >= 1.0
                     and sh is not None and sh > 0 and sh / implied < 0.05) else 0
        fgt = 1 if (out_shares and sh is not None and sh > 1.05 * out_shares) else 0
        fns = 1 if (sh is None or sh <= 0) else 0
        anyf = 1 if (f100 or fgt or fns) else 0
        for nm, v in (("flag_shares_100x", f100), ("flag_shares_gt_out", fgt),
                      ("flag_no_shares", fns), ("any_flag", anyf)):
            flags[nm] += v

        meetings_linked.add(mkey)
        firms_linked.add((tbl, cusip))
        out.append([
            "iss", tbl, co_id, (name or "").replace("\t", " "), ticker or "", cusip, c8,
            int(year) if year is not None else "", mtg,
            (fullname or "").replace("\t", " "), cls or "", ownless1 or "",
            "" if sh is None else ("%d" % round(sh)),
            "" if pc is None else ("%.4f" % pc),
            "" if so is None else ("%.1f" % so),
            "" if implied is None else ("%d" % round(implied)),
            f100, fgt, fns, anyf,
            cik, acc, fdate, rel, (mtg - fdate).days,
        ])

    print("\n[join] ISS -> DEF 14A (denominator = %d deduped ISS director rows)" % n_rows_in)
    print("  dropped, no cusip on the ISS row     : %d (%.2f%%)" % (n_no_cusip, 100 * n_no_cusip / n_rows_in))
    print("  dropped, cusip not in wciklink_cusip : %d (%.2f%%)" % (n_no_cik, 100 * n_no_cik / n_rows_in))
    print("  dropped, no DEF 14A in [mtg-%dd, mtg-%dd] : %d (%.2f%%)" % (
        args.win_lo_days, args.win_hi_days, n_no_filing, 100 * n_no_filing / n_rows_in))
    print("  cusip -> >1 cik                      : %d rows" % n_amb_cik)
    print("  of those, >1 cik with a filing in win : %d rows (contested)" % n_contested)
    print("  contested and NOT settled by coname   : %d rows" % n_contested_unresolved)
    print("  LINKED director rows                 : %d (%.2f%%)" % (len(out), 100 * len(out) / n_rows_in))
    print("  meetings: %d of %d linked (%.2f%%)" % (
        len(meetings_linked), len(meetings_seen), 100 * len(meetings_linked) / len(meetings_seen)))
    print("  firms   : %d of %d (table,cusip) linked (%.2f%%)" % (
        len(firms_linked), len(firms_seen), 100 * len(firms_linked) / len(firms_seen)))
    filings = {(r[20], r[21]) for r in out}
    ciks = {r[20] for r in out}
    print("  distinct DEF 14A filings linked      : %d" % len(filings))
    print("  distinct CIKs linked                 : %d" % len(ciks))
    print("  shrout unavailable (defect detector) : %d of %d linked rows (%.2f%%)" % (
        n_shrout_missing, len(out), 100 * n_shrout_missing / len(out)))

    print("\n[defect flags] denominator = %d linked ISS director rows" % len(out))
    for nm in ("flag_shares_100x", "flag_shares_gt_out", "flag_no_shares", "any_flag"):
        print("  %-22s %6d (%.2f%%)" % (nm, flags[nm], 100 * flags[nm] / len(out)))

    # per-year table
    by_year = defaultdict(lambda: [0, 0, 0, 0])
    for r in out:
        b = by_year[r[7]]
        b[0] += 1
        b[1] += 1 if r[12] != "" else 0
        b[2] += 1 if r[13] != "" else 0
        b[3] += r[19]
    print("\n[by year] linked rows / with shares / with pcnt / flagged")
    for y in sorted(by_year):
        b = by_year[y]
        print("  %s  %6d %6d %6d %5d" % (y, b[0], b[1], b[2], b[3]))

    out.sort(key=lambda r: (r[20], str(r[22]), r[21], r[9]))
    op = os.path.join(g, "gold_iss_all.tsv.gz")
    with gzip.open(op, "wt") as fh:
        fh.write("\t".join(COLS) + "\n")
        for r in out:
            fh.write("\t".join(str(x) for x in r) + "\n")
    print("\n[out] %s: %d rows x %d cols" % (op, len(out), len(COLS)))

    side = {
        "artifact": os.path.basename(op),
        "gold_set": "iss",
        "source": "risk_directors.rmdirectors (2007-2024) + risk_directors.directors (2002-2006)",
        "sql": {"rmdirectors": " ".join(SQL_RM.split()),
                "directors": " ".join(SQL_LEGACY.split()),
                "wciklink_cusip": " ".join(SQL_WCIK.split()),
                "shrout": " ".join(SQL_SHROUT.split())},
        "params": {"meetingdate_window": [args.start, args.end],
                   "filing_window": "[meetingdate-%dd, meetingdate-%dd]" % (
                       args.win_lo_days, args.win_hi_days),
                   "def14a_index": args.index},
        "wrds_account": args.user,
        "pull_date": dt.datetime.now().astimezone().isoformat(),
        "rows_in_rmdirectors": len(rm), "rows_in_directors": len(lg),
        "rows_deduped": n_rows_in, "duplicates_dropped": n_dupe,
        "rows": len(out),
        "dropped": {"no_cusip": n_no_cusip, "cusip_not_in_wciklink": n_no_cik,
                    "no_def14a_in_window": n_no_filing},
        "ambiguous_cusip_to_cik": n_amb_cik,
        "contested": n_contested, "contested_not_settled_by_coname": n_contested_unresolved,
        "meetings_linked": len(meetings_linked), "meetings_total": len(meetings_seen),
        "filings_linked": len(filings), "ciks_linked": len(ciks),
        "shrout_missing_rows": n_shrout_missing,
        "defect_flags": dict(flags),
        "sha256": sha256_of(op),
    }
    sc = os.path.join(g, "gold_iss_all.json")
    with open(sc, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True, default=str)
        fh.write("\n")
    print("[out] %s sha256=%s" % (sc, side["sha256"]))


if __name__ == "__main__":
    main()
