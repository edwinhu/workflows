#!/usr/bin/env python3
"""Reduce scan_covers `def14a_independence` output to one row per (cik, meeting_year).

Reads:  the scan TSV (filepath, accession, form_type, filed_date, cik,
        company_name, n_directors, slate, indep) plus stage.py's index, which
        carries meeting_year -- the scanner sees a filing, not the meeting.
Writes: <out>/def14a_independence.parquet

Resolution of surname-only rosters ("Messrs. Belk, Goergen, McDowell") to full
names is attempted against the filing's own slate and reported with its hit
rate; it is NOT silently dropped when it fails, because a surname roster is
still a usable count and a usable within-firm change.

Usage:
    python build_panel.py --scan indep_raw.tsv --index indep_filings.tsv \
                          --out data/processed
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

SCAN_COLS = ["filepath", "accession", "form_type", "filed_date", "cik",
             "company_name", "n_directors", "slate", "indep"]
IND_COLS = ["det_form", "name_style", "indep_names", "n_indep", "n_board",
            "exchange", "rule_cited", "catstd_loc", "considered",
            "considered_names", "match_text"]

# Dedup ranking, best first. A firm can file several proxies for one meeting
# year (definitive plus a supplement); the supplement usually restates nothing
# and lands on `none`.
FORM_ORDER = {"named": 0, "except_named": 1, "all_nonemployee": 2,
              "count_only": 3, "none": 4}


def resolve(names: str, slate: str) -> tuple[str, int, int]:
    """Match roster tokens against the filing's slate. Returns
    (resolved;joined, n_matched, n_tokens)."""
    toks = [t for t in names.split(";") if t]
    slate_names = [s for s in slate.split("|") if s]
    if not toks:
        return "", 0, 0
    out, hit = [], 0
    for t in toks:
        parts = t.split()
        cand = [s for s in slate_names
                if s.split()[-1] == parts[-1] or (len(parts) == 1 and parts[0] in s.split())]
        if len(cand) == 1:
            out.append(cand[0])
            hit += 1
        else:
            out.append(t)
    return ";".join(out), hit, len(toks)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True)
    ap.add_argument("--index", required=True)
    ap.add_argument("--out", default="data/processed")
    args = ap.parse_args()

    # scan_covers writes NO header row. Supplying names is required, not
    # defensive: with header inference the first filing becomes column labels.
    scan = pd.read_csv(args.scan, sep="\t", header=None, names=SCAN_COLS,
                       dtype=str).fillna("")
    idx = pd.read_csv(args.index, sep="\t", dtype=str).fillna("")
    print(f"[scan]  {len(scan):,} rows")
    print(f"[index] {len(idx):,} staged filings")

    parts = scan["indep"].str.split("|", n=10, expand=True)
    if parts.shape[1] != len(IND_COLS):
        raise SystemExit(
            f"indep column split into {parts.shape[1]} parts, expected "
            f"{len(IND_COLS)}. extractIndependence's layout changed.")
    for i, c in enumerate(IND_COLS):
        scan[c] = parts[i]
    scan["n_indep"] = pd.to_numeric(scan["n_indep"], errors="coerce").fillna(0).astype(int)
    scan["n_board"] = pd.to_numeric(scan["n_board"], errors="coerce").fillna(0).astype(int)
    scan["n_directors"] = pd.to_numeric(scan["n_directors"], errors="coerce").fillna(0).astype(int)

    # E3: join audit -- rows in, rows out, match rate.
    n_in = len(scan)
    df = scan.merge(idx[["path", "meeting_year"]], left_on="filepath",
                    right_on="path", how="inner")
    print(f"[join]  scan {n_in:,} x index {len(idx):,} -> {len(df):,} "
          f"(match rate {100*len(df)/max(n_in,1):.1f}% of scanned rows)")
    if len(df) < n_in:
        print(f"        {n_in-len(df):,} scanned rows had no index match")

    res = df.apply(lambda r: resolve(r["indep_names"], r["slate"]), axis=1)
    df["indep_names_resolved"] = [x[0] for x in res]
    df["n_name_resolved"] = [x[1] for x in res]
    df["n_name_tokens"] = [x[2] for x in res]

    n_before = len(df)
    df["form_rank"] = df["det_form"].map(FORM_ORDER).fillna(99)
    df = (df.sort_values(["cik", "meeting_year", "form_rank", "n_indep", "filed_date"],
                         ascending=[True, True, True, False, False])
            .drop_duplicates(["cik", "meeting_year"], keep="first")
            .drop(columns=["form_rank", "path"]))
    print(f"[dedup] {n_before:,} -> {len(df):,} (cik, meeting_year) rows")

    n = len(df)
    named = df["det_form"].isin(["named", "except_named"]).sum()
    print(f"\n[DEN] roster named          {named:,}/{n:,} = {100*named/max(n,1):.1f}%")
    for c in ("det_form", "name_style", "exchange", "rule_cited", "catstd_loc",
              "considered"):
        print(f"[DQ] {c}:")
        print(df[c].value_counts(dropna=False).to_string())
    tok = df["n_name_tokens"].sum()
    print(f"\n[DEN] surname->slate resolution {df['n_name_resolved'].sum():,}/{tok:,} "
          f"= {100*df['n_name_resolved'].sum()/max(tok,1):.1f}% of roster tokens")
    haveb = (df["n_board"] > 0).sum()
    print(f"[DEN] board size stated in text {haveb:,}/{n:,} = {100*haveb/max(n,1):.1f}%")

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    dest = outdir / "def14a_independence.parquet"
    df.sort_values(["cik", "meeting_year"]).to_parquet(dest, index=False)
    print(f"\n[out] {dest} ({len(df):,} rows)")


if __name__ == "__main__":
    main()
