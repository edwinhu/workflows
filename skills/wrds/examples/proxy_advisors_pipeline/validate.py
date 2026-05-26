"""Validate our mgmt_cd × year panel against the chongshu published CSV.

Loads:
    - ours:   link_fundmgmt_proxyadvisor.csv from aggregate.py
    - theirs: link_fundmgmt_proxyadvisor.csv from chongshu/proxy-advisor-customers

Reports per-advisor (ISS, GL, EJ):
    - exact-match rate over (mgmt_cd, year) tuples
    - false-positive count (we say 1, paper says 0)
    - false-negative count (we say 0, paper says 1)
    - confusion matrix
    - per-year breakdown so we can see whether divergences cluster

Decision rule: ≥98% exact match per advisor for the paper's coverage window
(2007–2021) → pass. Below that, investigate disagreements before claiming
done. Likely culprits in order: word-boundary vs spaced " iss " pattern,
HTML stripping differences, CRSP mgmt_cd snapshot drift.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ADVISORS = [("ISS_prospectus", "iss"),
            ("GL_prospectus",  "gl"),
            ("EJ_prospectus",  "ej")]
PASS_THRESHOLD = 0.98
PAPER_WINDOW = (2007, 2021)


def load(path: Path, label: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    needed = {"mgmt_cd", "year"} | {c for c, _ in ADVISORS}
    missing = needed - set(df.columns)
    if missing:
        sys.exit(f"[{label}] missing columns: {sorted(missing)}")
    df["mgmt_cd"] = df["mgmt_cd"].astype(str).str.strip()
    df["year"] = df["year"].astype(int)
    return df


def compare(ours: pd.DataFrame, theirs: pd.DataFrame) -> dict:
    """Outer-merge on (mgmt_cd, year) and report disagreement counts."""
    on = ["mgmt_cd", "year"]
    merged = ours.merge(theirs, on=on, how="outer", suffixes=("_us", "_them"),
                        indicator=True)
    for col, _ in ADVISORS:
        merged[f"{col}_us"] = merged[f"{col}_us"].fillna(0).astype(int)
        merged[f"{col}_them"] = merged[f"{col}_them"].fillna(0).astype(int)

    summary = {}
    print("\n=== Coverage ===")
    print(merged["_merge"].value_counts().to_string())

    in_both = merged[merged["_merge"] == "both"].copy()
    print(f"\n=== In-both rows: {len(in_both):,} ===")

    for col, short in ADVISORS:
        agree = (in_both[f"{col}_us"] == in_both[f"{col}_them"]).mean()
        fp = ((in_both[f"{col}_us"] == 1) & (in_both[f"{col}_them"] == 0)).sum()
        fn = ((in_both[f"{col}_us"] == 0) & (in_both[f"{col}_them"] == 1)).sum()
        tp = ((in_both[f"{col}_us"] == 1) & (in_both[f"{col}_them"] == 1)).sum()
        tn = ((in_both[f"{col}_us"] == 0) & (in_both[f"{col}_them"] == 0)).sum()
        summary[short] = {"agree": agree, "fp": fp, "fn": fn,
                          "tp": tp, "tn": tn}
        verdict = "PASS" if agree >= PASS_THRESHOLD else "FAIL"
        print(f"\n[{short}] agreement={agree:.4f}  TP={tp:,}  TN={tn:,}  "
              f"FP={fp:,}  FN={fn:,}  → {verdict}")

    return {"summary": summary, "merged": merged}


def per_year_breakdown(merged: pd.DataFrame) -> None:
    in_both = merged[merged["_merge"] == "both"].copy()
    print("\n=== Per-year agreement (paper window) ===")
    rows = []
    lo, hi = PAPER_WINDOW
    for year, sub in in_both[(in_both["year"] >= lo) & (in_both["year"] <= hi)].groupby("year"):
        row = {"year": year, "n": len(sub)}
        for col, short in ADVISORS:
            row[short] = (sub[f"{col}_us"] == sub[f"{col}_them"]).mean()
        rows.append(row)
    print(pd.DataFrame(rows).to_string(index=False, float_format=lambda x: f"{x:.4f}"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ours", type=Path, required=True)
    ap.add_argument("--theirs", type=Path, required=True,
                    help="link_fundmgmt_proxyadvisor.csv from chongshu repo.")
    args = ap.parse_args()

    ours = load(args.ours, "ours")
    theirs = load(args.theirs, "theirs")
    result = compare(ours, theirs)
    per_year_breakdown(result["merged"])

    import math
    fails = [s for s, v in result["summary"].items()
             if math.isnan(v["agree"]) or v["agree"] < PASS_THRESHOLD]
    if fails:
        print(f"\nFAIL: advisors below {PASS_THRESHOLD:.0%} threshold: {fails}")
        sys.exit(1)
    print(f"\nPASS: all advisors ≥ {PASS_THRESHOLD:.0%}")


if __name__ == "__main__":
    main()
