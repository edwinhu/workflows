#!/usr/bin/env python3
"""Reduce scan_covers `quorum` output to one threshold per (cik, meeting_year).

Reads:  the scan_covers TSV (filepath, accession, form_type, filed_date, cik,
        company_name, quorum) plus the staging index written by stage.py, which
        carries meeting_year — the scanner sees only the filing, not the meeting
        it belongs to.
Writes: <out>/quorum_bylaws.parquet
          cik, meeting_year, threshold, confidence, accession, filing_date, match_text

Usage:
    python build_panel.py --scan quorum_raw.tsv --index quorum_filings.tsv \
                          --out data/processed
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

# Dedup ranking, best first. A firm can file several proxies for one meeting
# year (definitive plus a supplement), and they will not agree: the supplement
# usually has no quorum text at all and lands on `default-noquorum`.
#
# ORDER MATTERS AND IT IS NOT THE THRESHOLD ORDER. `default` outranks
# `default-noquorum` because "we read the proxy, it discussed quorum, we could
# not extract a number" is better evidence than "there was no quorum text to
# read" — both return 0.50, but only the first one looked. Collapsing them
# would make an absence look like a reading.
CONF_ORDER = {"high": 0, "med": 1, "default": 2, "default-noquorum": 3,
              "low": 4, "none": 5}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True, help="scan_covers profile=quorum TSV")
    ap.add_argument("--index", required=True, help="stage.py index TSV (has meeting_year)")
    ap.add_argument("--out", default="data/processed")
    args = ap.parse_args()

    # scan_covers writes NO header row — the first line is data. Supplying names
    # is required, not defensive: with header inference the first filing is
    # silently consumed as column labels and the panel comes out one row short
    # with garbage column names.
    # Order must match the Fields list in profiles_quorum.go; `scan_covers -list`
    # prints it.
    SCAN_COLS = ["filepath", "accession", "form_type", "filed_date", "cik",
                 "company_name", "quorum"]
    scan = pd.read_csv(args.scan, sep="\t", dtype=str, header=None,
                       names=SCAN_COLS).fillna("")
    idx = pd.read_csv(args.index, sep="\t", dtype=str).fillna("")
    print(f"[scan]  {len(scan):,} rows")
    print(f"[index] {len(idx):,} staged filings")

    # The Custom field packs three correlated outputs into one column, because it
    # is one full-body proximity scan and three Custom fields would run it three
    # times. Split on the FIRST TWO pipes only — the snippet is pipe-sanitised in
    # Go, but n=2 makes that belt-and-braces rather than load-bearing.
    parts = scan["quorum"].str.split("|", n=2, expand=True)
    if parts.shape[1] != 3:
        raise SystemExit(
            f"quorum column did not split into 3 parts (got {parts.shape[1]}). "
            "Expected 'threshold|confidence|match_text' from extractQuorum.")
    scan["threshold"] = pd.to_numeric(parts[0], errors="coerce")
    scan["confidence"] = parts[1]
    scan["match_text"] = parts[2]

    bad = scan["threshold"].isna().sum()
    if bad:
        print(f"[warn] {bad:,} rows have an unparseable threshold — dropped")
        scan = scan[scan["threshold"].notna()]

    # meeting_year comes from the staging index, joined on the path the scanner
    # echoes back. Left join, so a staged filing the scanner skipped (wrong form
    # type) simply drops out rather than silently becoming year-less.
    key = "filepath" if "filepath" in scan.columns else scan.columns[0]
    df = scan.merge(idx[["path", "meeting_year"]], left_on=key, right_on="path",
                    how="inner")
    print(f"[join]  {len(df):,} rows carry a meeting_year")
    if len(df) < len(scan):
        print(f"        ({len(scan) - len(df):,} scanned rows had no index match)")

    n_before = len(df)
    df["conf_rank"] = df["confidence"].map(CONF_ORDER).fillna(99)
    df = (df.sort_values(["cik", "meeting_year", "conf_rank", "threshold", "filed_date"],
                         ascending=[True, True, True, False, False])
            .drop_duplicates(["cik", "meeting_year"], keep="first")
            .drop(columns=["conf_rank"]))
    print(f"[dedup] {n_before:,} -> {len(df):,} (cik, meeting_year) rows "
          f"({100*(len(df)-n_before)/max(n_before,1):+.1f}%)")

    df = df.rename(columns={"filed_date": "filing_date"})
    df = df[["cik", "meeting_year", "threshold", "confidence",
             "accession", "filing_date", "match_text"]]

    # DEN: every rate printed with its base, so a coverage claim cannot be read
    # off a shrinking denominator.
    n = len(df)
    explicit = df["confidence"].isin(["high", "med"]).sum()
    print(f"\n[DEN] explicit parse = {explicit:,}/{n:,} = {100*explicit/max(n,1):.1f}%")
    print("[DQ] confidence mix:")
    print(df["confidence"].value_counts().to_string())
    print("[DQ] threshold mix:")
    print(df["threshold"].value_counts().sort_index().to_string())

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    dest = outdir / "quorum_bylaws.parquet"
    df.to_parquet(dest, index=False)
    print(f"\n[out] {dest} ({len(df):,} rows)")


if __name__ == "__main__":
    main()
