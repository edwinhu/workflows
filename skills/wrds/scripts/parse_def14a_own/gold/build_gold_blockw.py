#!/usr/bin/env python3
"""build_gold_blockw.py — gold set (a): WRDS Blockholders, 1996-2001.

Dlugosz, Fahlenbrach, Gompers & Metrick's cleaned IRRC blockholder file
(`block_all.blockw`). It IS the proxy Security Ownership table, hand-cleaned,
one row per (company, blockholder, IRRC year), with a PERMNO on every row and an
explicit "Firm has no blockholder" encoding for the negatives.

Link chain, each leg with row counts and a match rate printed (E3):
    blockw.permno
      -> crsp.stocknames.ncusip valid at mtgdate            (permno -> 8-char cusip)
      -> wrdssec.wciklink_cusip.cusip                       (cusip  -> cik)
      -> def14a_index (cik, filing_date)                     (cik    -> the DEF 14A)

Filing choice: the DEF 14A with the LATEST filing_date that is <= mtgdate and
>= shrsrcd - 45 days. `shrsrcd` is the date of the ownership source (the record
date the proxy's table is stated as of), so a filing inside that window is the
proxy those holdings came out of. Where shrsrcd is null the window is
[mtgdate - 180, mtgdate].

Output (outside git):
    $GOLD_DIR/gold_blockw.tsv.gz      one row per gold holder row, linked
    $GOLD_DIR/gold_blockw.json        sidecar: SQL, params, pull date, rows, sha256
"""

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os

import psycopg2

SQL_BLOCKW = """
select firm_id, compname, ticker, permno, irrcyear, mtgdate, shrsrcd, shrsrc,
       sh_name, shpct, sh_dir, sh_off, aflin, esopblk, out, dir, officer,
       sumblks, numblks, sumdir, sumoff
from block_all.blockw
order by permno, irrcyear, sh_name
"""

SQL_STOCKNAMES = """
select permno, namedt, nameenddt, ncusip, cusip, comnam, shrcd
from crsp.stocknames
where ncusip is not null and nameenddt >= %(d0)s and namedt <= %(d1)s
"""

SQL_WCIK = """
select cik, cusip, coname, cikdate1, cikdate2
from wrdssec.wciklink_cusip
where cusip is not null and cik <> '0000000000'
"""


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_index(gold_dir):
    """DEF 14A index -> {cik: [(filing_date, accession, relpath, coname), ...]}"""
    by_cik = {}
    with gzip.open(os.path.join(gold_dir, "def14a_index.tsv.gz"), "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            by_cik.setdefault(r["cik"], []).append(
                (dt.date.fromisoformat(r["filing_date"]), r["accession"], r["relpath"], r["coname"])
            )
    for v in by_cik.values():
        v.sort()
    return by_cik


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--user", default="eddyhu")
    args = ap.parse_args()

    con = psycopg2.connect(
        host="wrds-pgdata.wharton.upenn.edu", port=9737, database="wrds",
        user=args.user, sslmode="require",
    )
    cur = con.cursor()

    cur.execute(SQL_BLOCKW)
    block = cur.fetchall()
    print("[in ] block_all.blockw: %d rows" % len(block))

    cur.execute(SQL_STOCKNAMES, {"d0": "1995-01-01", "d1": "2002-12-31"})
    names = cur.fetchall()
    print("[in ] crsp.stocknames (1995-2002 overlap): %d rows" % len(names))

    cur.execute(SQL_WCIK)
    wcik = cur.fetchall()
    print("[in ] wrdssec.wciklink_cusip: %d rows" % len(wcik))
    con.close()

    # permno -> [(namedt, nameenddt, ncusip)]
    by_permno = {}
    for permno, namedt, nameenddt, ncusip, _cusip, _comnam, _shrcd in names:
        by_permno.setdefault(int(permno), []).append((namedt, nameenddt, ncusip))

    # cusip8 -> set(cik)
    cik_by_cusip = {}
    for cik, cusip, _coname, _d1, _d2 in wcik:
        cik_by_cusip.setdefault(cusip.strip(), set()).add(cik)

    index = load_index(args.gold_dir)
    print("[in ] def14a_index: %d ciks" % len(index))

    out_path = os.path.join(args.gold_dir, "gold_blockw.tsv.gz")
    cols = [
        "gold_set", "firm_id", "compname", "ticker", "permno", "gold_year", "mtgdate",
        "shrsrcd", "shrsrc", "holder_name", "holder_pct", "is_director", "is_officer",
        "is_affiliated", "is_esop", "is_outside", "sum_blocks_pct", "n_blocks",
        "sum_dir_pct", "sum_off_pct", "no_blockholder", "cusip", "cik", "accession",
        "filing_date", "relpath",
    ]

    n_no_permno_name = n_no_cik = n_no_filing = n_amb_cik = n_amb_resolved = n_amb_unresolved = 0
    linked_rows = []
    permnos_seen, permnos_linked = set(), set()
    firmyears_seen, firmyears_linked = set(), set()

    for rec in block:
        (firm_id, compname, ticker, permno, irrcyear, mtgdate, shrsrcd, shrsrc,
         sh_name, shpct, sh_dir, sh_off, aflin, esopblk, out, _dir, _officer,
         sumblks, numblks, sumdir, sumoff) = rec
        permno = int(permno)
        year = int(irrcyear)
        permnos_seen.add(permno)
        firmyears_seen.add((permno, year))

        # permno -> ncusip valid at the meeting date
        cusip = None
        for namedt, nameenddt, ncusip in by_permno.get(permno, []):
            if mtgdate and namedt <= mtgdate <= nameenddt:
                cusip = ncusip
                break
        if cusip is None and by_permno.get(permno):
            cusip = by_permno[permno][-1][2]  # last known cusip for the permno
        if cusip is None:
            n_no_permno_name += 1
            continue

        ciks = cik_by_cusip.get(cusip, set())
        if not ciks:
            n_no_cik += 1
            continue
        if len(ciks) > 1:
            n_amb_cik += 1

        lo = (shrsrcd - dt.timedelta(days=45)) if shrsrcd else (mtgdate - dt.timedelta(days=180))
        hi = mtgdate
        # Candidate (cik, filing) pairs inside the window. A cusip mapping to more
        # than one cik is common (47% of rows), so the tiebreak matters: prefer the
        # cik whose EDGAR company name matches blockw's compname, then the latest
        # filing. Both the contested count and the name-unresolved residual are
        # reported, because a wrong cik here is a wrong proxy scored as a miss.
        cands = []
        for cik in sorted(ciks):
            for fdate, acc, rel, coname in index.get(cik, []):
                if lo <= fdate <= hi:
                    cands.append((cik, fdate, acc, rel, coname))
        ciks_with_filing = {c[0] for c in cands}
        contested = len(ciks_with_filing) > 1
        if contested:
            n_amb_resolved += 1
        if not cands:
            n_no_filing += 1
            continue
        target = normname(compname)
        named = [c for c in cands if namematch(normname(c[4]), target)]
        if contested:
            if {c[0] for c in named} == set() or len({c[0] for c in named}) > 1:
                n_amb_unresolved += 1
        pool = named or cands
        pool.sort(key=lambda c: (c[1], c[0]))
        best_cik, bf, bacc, brel, _bconame = pool[-1]
        best = (bf, bacc, brel)
        permnos_linked.add(permno)
        firmyears_linked.add((permno, year))
        linked_rows.append([
            "blockw", str(firm_id), (compname or "").replace("\t", " "), ticker or "",
            permno, year, mtgdate, shrsrcd or "", shrsrc or "",
            (sh_name or "").replace("\t", " "),
            "" if shpct is None else shpct,
            fmt_flag(sh_dir), fmt_flag(sh_off), fmt_flag(aflin), fmt_flag(esopblk), fmt_flag(out),
            "" if sumblks is None else sumblks, "" if numblks is None else numblks,
            "" if sumdir is None else sumdir, "" if sumoff is None else sumoff,
            1 if (sh_name or "").lower().startswith("firm has no blockholder") else 0,
            cusip, best_cik, best[1], best[0], best[2],
        ])

    n_in = len(block)
    print("\n[join] blockw -> gold (denominator = %d blockw rows)" % n_in)
    print("  dropped, permno has no CRSP name row : %d (%.2f%%)" % (n_no_permno_name, 100 * n_no_permno_name / n_in))
    print("  dropped, cusip not in wciklink_cusip : %d (%.2f%%)" % (n_no_cik, 100 * n_no_cik / n_in))
    print("  dropped, no DEF 14A in the window    : %d (%.2f%%)" % (n_no_filing, 100 * n_no_filing / n_in))
    print("  cusip -> >1 cik                      : %d rows" % n_amb_cik)
    print("  of those, >1 cik with a filing in win : %d rows (contested)" % n_amb_resolved)
    print("  contested and NOT settled by coname   : %d rows" % n_amb_unresolved)
    print("  LINKED holder rows                   : %d (%.2f%%)" % (len(linked_rows), 100 * len(linked_rows) / n_in))
    print("  firms   : %d of %d permnos linked (%.2f%%)" % (
        len(permnos_linked), len(permnos_seen), 100 * len(permnos_linked) / len(permnos_seen)))
    print("  firm-yrs: %d of %d linked (%.2f%%)" % (
        len(firmyears_linked), len(firmyears_seen), 100 * len(firmyears_linked) / len(firmyears_seen)))
    filings = {(r[22], r[23]) for r in linked_rows}
    print("  distinct DEF 14A filings linked      : %d" % len(filings))

    linked_rows.sort(key=lambda r: (r[22], str(r[24]), r[23], r[9]))  # cik, fdate, accession, holder
    with gzip.open(out_path, "wt") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in linked_rows:
            fh.write("\t".join(str(x) for x in r) + "\n")
    print("\n[out] %s: %d rows x %d cols" % (out_path, len(linked_rows), len(cols)))

    side = {
        "artifact": os.path.basename(out_path),
        "gold_set": "blockw",
        "source": "block_all.blockw (Dlugosz, Fahlenbrach, Gompers & Metrick)",
        "sql": {"blockw": " ".join(SQL_BLOCKW.split()),
                "stocknames": " ".join(SQL_STOCKNAMES.split()),
                "wciklink_cusip": " ".join(SQL_WCIK.split())},
        "params": {"stocknames_window": ["1995-01-01", "2002-12-31"],
                   "filing_window": "shrsrcd-45d .. mtgdate (fallback mtgdate-180d .. mtgdate)"},
        "wrds_account": args.user,
        "pull_date": dt.datetime.now().astimezone().isoformat(),
        "rows_in": n_in,
        "rows": len(linked_rows),
        "dropped": {"no_crsp_name_row": n_no_permno_name, "cusip_not_in_wciklink": n_no_cik,
                    "no_def14a_in_window": n_no_filing},
        "ambiguous_cusip_to_cik": n_amb_cik,
        "ambiguous_and_still_contested": n_amb_resolved,
        "contested_not_settled_by_coname": n_amb_unresolved,
        "firms_linked": len(permnos_linked), "firms_total": len(permnos_seen),
        "firmyears_linked": len(firmyears_linked), "firmyears_total": len(firmyears_seen),
        "filings_linked": len(filings),
        "sha256": sha256_of(out_path),
    }
    sc = os.path.join(args.gold_dir, "gold_blockw.json")
    with open(sc, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True, default=str)
        fh.write("\n")
    print("[out] %s sha256=%s" % (sc, side["sha256"]))


def normname(s):
    """Fold a company name to comparable tokens: case, punctuation, corporate suffixes."""
    s = (s or "").upper()
    for ch in ".,;&/'\"()-":
        s = s.replace(ch, " ")
    drop = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LP", "LLC", "PLC",
            "HOLDINGS", "HOLDING", "GROUP", "THE", "NEW", "CL", "A", "B"}
    return [t for t in s.split() if t not in drop]


def namematch(a, b):
    """True when the two names share their first significant token."""
    return bool(a) and bool(b) and a[0] == b[0]


def fmt_flag(v):
    if v is None:
        return ""
    try:
        return str(int(float(v)))
    except (TypeError, ValueError):
        return str(v)


if __name__ == "__main__":
    main()
