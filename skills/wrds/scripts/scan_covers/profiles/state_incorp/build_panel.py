"""Build the state-of-incorporation panel from parser output.

Reads: scripts/state_incorp_go/state_incorp_raw.tsv (Go parser output)
Writes: data/processed/state_incorp.parquet

Post-processing corrections applied:
  1. Transient flip smoothing: A->B->A patterns (1-year or 2-year) are
     overridden to A. Real reincorporations are persistent.
  2. HQ-suspect override: when header state == HQ state and != DE,
     and the CIK has a different modal state with 80%+ prevalence,
     override with the modal state.

Usage:
    pixi run python scripts/state_incorp_go/build_panel.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
PROC = HERE.parent.parent / "data" / "processed"


def smooth_transient_flips(df: pd.DataFrame) -> pd.DataFrame:
    """Override 1-year and 2-year transient state changes (A->B->A)."""
    df = df.sort_values(["cik", "fiscal_year"]).copy()
    fixed = 0

    for cik, grp in df.groupby("cik"):
        if len(grp) < 3:
            continue
        idx = grp.index.tolist()
        states = grp["state"].tolist()

        # 1-year flips: A->B->A
        for i in range(1, len(states) - 1):
            if states[i - 1] == states[i + 1] and states[i] != states[i - 1]:
                df.loc[idx[i], "state"] = states[i - 1]
                df.loc[idx[i], "confidence"] = "smoothed_1yr"
                states[i] = states[i - 1]  # update for subsequent checks
                fixed += 1

        # 2-year flips: A->B->B->A
        if len(states) >= 4:
            for i in range(1, len(states) - 2):
                if (states[i - 1] == states[i + 2]
                        and states[i] == states[i + 1]
                        and states[i] != states[i - 1]):
                    df.loc[idx[i], "state"] = states[i - 1]
                    df.loc[idx[i], "confidence"] = "smoothed_2yr"
                    df.loc[idx[i + 1], "state"] = states[i - 1]
                    df.loc[idx[i + 1], "confidence"] = "smoothed_2yr"
                    states[i] = states[i - 1]
                    states[i + 1] = states[i - 1]
                    fixed += 2

    print(f"  Transient flip smoothing: {fixed:,} rows fixed")
    return df


def fix_hq_suspects(df: pd.DataFrame) -> pd.DataFrame:
    """Override HQ-suspect rows using the CIK's modal state."""
    # Compute modal state from non-suspect rows only
    clean = df[df["confidence"] != "hq_suspect"]
    if len(clean) == 0:
        return df

    modal = (clean.groupby("cik")["state"]
             .agg(lambda x: x.mode()[0] if len(x.mode()) > 0 else "")
             .rename("modal_state"))
    modal_pct = (clean.groupby("cik")["state"]
                 .agg(lambda x: (x == x.mode()[0]).mean() if len(x.mode()) > 0 else 0)
                 .rename("modal_pct"))
    modal_n = clean.groupby("cik").size().rename("n_clean")
    stats = pd.concat([modal, modal_pct, modal_n], axis=1).reset_index()

    df = df.merge(stats, on="cik", how="left")

    # Override HQ-suspect when modal is strong (>=80%) and based on 3+ clean obs
    suspect = (
        (df["confidence"] == "hq_suspect")
        & (df["modal_pct"] >= 0.8)
        & (df["n_clean"] >= 3)
        & (df["modal_state"] != "")
        & (df["state"] != df["modal_state"])
    )
    df.loc[suspect, "state"] = df.loc[suspect, "modal_state"]
    df.loc[suspect, "confidence"] = "hq_suspect_overridden"
    print(f"  HQ-suspect override: {suspect.sum():,} rows fixed")

    df = df.drop(columns=["modal_state", "modal_pct", "n_clean"])
    return df


def fill_from_adjacent_year(df: pd.DataFrame) -> pd.DataFrame:
    """Fill year-shifted gaps: a 10-K filed March 2020 for FYE Dec 2019 appears
    as fiscal_year=2020 in our data but fiscal_year=2019 in some datasets.
    For each (cik, year), also create a year-1 duplicate. If the CIK has
    observations for both year Y and Y-1, prefer the original; otherwise
    fill from Y+1's filing."""
    prev = df[["cik", "fiscal_year", "state"]].copy()
    prev["fiscal_year"] = prev["fiscal_year"] - 1
    prev = prev.rename(columns={"state": "state_prev"})
    df = df.merge(prev, on=["cik", "fiscal_year"], how="left")
    df["state_prev"] = df["state_prev"].fillna("")
    print(f"  Year-shift fill: {(df['state_prev'] != '').sum():,} rows have prev-year data")
    df = df.drop(columns=["state_prev"])
    return df


def fix_modal_outliers(df: pd.DataFrame) -> pd.DataFrame:
    """For CIKs with a strong modal state (100% of non-suspect years, 5+ obs),
    override single-year outliers where the outlier state matches the HQ state
    (likely HQ contamination on that specific filing)."""
    clean = df[df["confidence"].isin(["header", "smoothed_1yr", "smoothed_2yr"])]
    if len(clean) == 0:
        return df
    stats = clean.groupby("cik").agg(
        modal=("state", lambda x: x.mode()[0] if len(x.mode()) > 0 else ""),
        n_unique=("state", "nunique"),
        n_obs=("state", "count"),
    ).reset_index()
    # Only CIKs that are unanimous in all clean observations AND have 5+ obs
    unanimous = stats[(stats["n_unique"] == 1) & (stats["n_obs"] >= 5)]
    df = df.merge(unanimous[["cik", "modal"]], on="cik", how="left")
    fix = (
        df["modal"].notna()
        & (df["modal"] != "")
        & (df["state"] != df["modal"])
        & (df["state"] == df["hq_state"])  # outlier matches HQ — likely contamination
    )
    df.loc[fix, "state"] = df.loc[fix, "modal"]
    df.loc[fix, "confidence"] = "modal_outlier_fixed"
    print(f"  Modal outlier fix (unanimous clean + outlier==HQ): {fix.sum():,} rows")
    df = df.drop(columns=["modal"])
    return df


def main():
    src = HERE / "state_incorp_raw.tsv"
    dst = PROC / "state_incorp.parquet"

    df = pd.read_csv(src, sep="\t", dtype={
        "cik": int, "accession": str, "fdate": str,
        "fiscal_year": int, "state": str, "hq_state": str,
        "confidence": str, "match_text": str,
    }).fillna({"state": "", "hq_state": "", "match_text": ""})
    print(f"Loaded {len(df):,} rows from {src.name}")

    # Filter to rows where we found a state
    has_state = df[df["state"] != ""].copy()
    print(f"  With state: {len(has_state):,} ({len(has_state)/len(df)*100:.1f}%)")

    # Deduplicate: one per (cik, fiscal_year)
    conf_order = {"header": 0, "hq_suspect": 1, "body": 2, "body_abbrev": 3,
                  "header_unknown": 4, "low": 5, "none": 6}
    has_state["conf_rank"] = has_state["confidence"].map(conf_order).fillna(99)
    deduped = (has_state
        .sort_values(["cik", "fiscal_year", "conf_rank", "fdate"],
                     ascending=[True, True, True, False])
        .drop_duplicates(["cik", "fiscal_year"], keep="first")
        .drop(columns=["conf_rank"]))
    print(f"  After dedupe: {len(deduped):,} CIK-year rows")

    # Apply corrections
    print("\nApplying corrections:")
    deduped = smooth_transient_flips(deduped)
    # HQ-suspect override and modal outlier fix both disabled:
    # The header is 97.8% accurate for hq_suspect rows. Both override
    # strategies fix ~100 rows but break ~800+ (net negative).
    # The remaining ~1.5% disagreement with Barzuza is irreducible
    # without body text parsing improvements or manual corrections.

    print(f"\n  State distribution (top 10):")
    print(deduped["state"].value_counts().head(10).to_string())
    print(f"\n  Confidence distribution:")
    print(deduped["confidence"].value_counts().to_string())

    out = deduped[["cik", "fiscal_year", "state", "hq_state", "confidence"]].copy()
    out.to_parquet(dst, index=False)
    print(f"\nWrote {dst}")


if __name__ == "__main__":
    main()
