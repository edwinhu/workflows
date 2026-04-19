"""Redo the TR personid -> SEC owner CIK bridge end-to-end.

Prior `bridge_insider_names.py` applied the name bridge to panel rows
whose blockholder_CIK happened to land in the TR personid range — which
false-positive matched legitimate Volkova rows (e.g. Bankers Trust
CIK 9749 coincidentally equal to a TR personid). The fix: work from the
raw add-on file directly, not the post-merge panel.

Bridge priority (highest quality first):
  1. Form 4 XML bridge (issuer_cik, norm_name) -> rpt_owner_cik
       Source: form4_owner_bridge.parquet (76K pairs from 540K filings)
  2. Volkova name bridge (company_CIK, norm_name) -> blockholder_CIK
       Source: Volkova individual/other rows in prebridge panel
  3. Synthetic offset (personid + 1e9) for still-unmatched

Output: data/processed/blockholders_final.parquet (backs up prior).
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

PROJ = Path(__file__).resolve().parent.parent
ADDON = PROJ / "data/processed/insider_addon_2019_2024.parquet"
PREBRIDGE = PROJ / "data/processed/blockholders_final_prebridge.parquet"
FORM4 = PROJ / "data/processed/form4_owner_bridge.parquet"
TR = PROJ / "data/processed/tr_insider_all.parquet"
OUT = PROJ / "data/processed/blockholders_final.parquet"
BACKUP = PROJ / "data/processed/blockholders_final_buggy_backup.parquet"

SYNTHETIC_OFFSET = 1_000_000_000


SUFFIX_RE = re.compile(
    r"\b(JR|SR|II|III|IV|V|MD|PHD|ESQ|CPA|MR|MRS|MS|DR|"
    r"LP|LLP|LLC|LTD|INC|CORP|CORPORATION|COMPANY|CO|GP|PLC|"
    r"NV|SA|AG|TRUST|PARTNERS|PARTNERSHIP|ADVISORS|ADVISERS|"
    r"CAPITAL|MANAGEMENT|GROUP|HOLDINGS|FUND|FUNDS|ASSOCIATES|"
    r"INVESTMENTS|INVESTMENT)\b"
)


def normalize_name(s: str) -> str:
    if not isinstance(s, str) or not s.strip():
        return ""
    s = s.upper()
    s = re.sub(r"[.,'\"()/\\&]", " ", s)
    # Collapse entity-suffix letter runs: L L C -> LLC, L P -> LP
    s = re.sub(r"\bL\s*L\s*C\b", "LLC", s)
    s = re.sub(r"\bL\s*P\b", "LP", s)
    s = re.sub(r"\bL\s*L\s*P\b", "LLP", s)
    s = SUFFIX_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_form4_lookup(bridge: pd.DataFrame) -> pd.DataFrame:
    bridge = bridge.copy()
    bridge["issuer_cik"] = bridge["issuer_cik"].astype("int64")
    bridge["rpt_owner_cik"] = bridge["rpt_owner_cik"].astype("int64")
    # Re-normalize with the tightened rules (parquet was built with old rules).
    bridge["norm_name"] = bridge["rpt_owner_name"].map(normalize_name)
    bridge = bridge[bridge["norm_name"].str.len() > 0]
    lookup = (
        bridge.groupby(["issuer_cik", "norm_name"])
        .agg(rpt_owner_cik=("rpt_owner_cik", lambda x: x.mode().iloc[0]))
        .reset_index()
        .rename(columns={"issuer_cik": "company_CIK"})
    )
    return lookup


def build_volkova_lookup(panel: pd.DataFrame) -> pd.DataFrame:
    cand = panel[
        panel["block_type"].isin(["individual", "other"])
        & panel["blockholder_name"].notna()
        & panel["blockholder_CIK"].notna()
    ].copy()
    cand["norm_name"] = cand["blockholder_name"].map(normalize_name)
    cand = cand[cand["norm_name"].str.len() > 0]
    cand["company_CIK"] = cand["company_CIK"].astype("int64")
    cand["blockholder_CIK"] = cand["blockholder_CIK"].astype("int64")
    lookup = (
        cand.groupby(["company_CIK", "norm_name"])
        .agg(
            vol_cik=("blockholder_CIK", lambda x: x.mode().iloc[0]),
            vol_block_type=("block_type", lambda x: x.mode().iloc[0]),
        )
        .reset_index()
    )
    return lookup


def main():
    print(f"Loading add-on from {ADDON.name}")
    addon = pd.read_parquet(ADDON)
    addon["company_CIK"] = addon["company_CIK"].astype("int64")
    addon["blockholder_CIK"] = addon["blockholder_CIK"].astype("int64")
    addon["norm_name"] = addon["blockholder_name"].map(normalize_name)
    print(f"  add-on rows: {len(addon):,}")
    print(f"  unique personids: {addon['blockholder_CIK'].nunique():,}")

    print(f"\nLoading Form 4 bridge from {FORM4.name}")
    form4 = pd.read_parquet(FORM4)
    f4_lookup = build_form4_lookup(form4)
    print(f"  Form 4 lookup size: {len(f4_lookup):,} (issuer, norm_name) pairs")

    print(f"\nLoading prebridge panel from {PREBRIDGE.name}")
    pre = pd.read_parquet(PREBRIDGE)
    pre["company_CIK"] = pre["company_CIK"].astype("int64")
    pre["blockholder_CIK"] = pre["blockholder_CIK"].astype("int64")
    print(f"  prebridge rows: {len(pre):,}")

    print(f"\nBuilding Volkova name lookup")
    vol_lookup = build_volkova_lookup(pre)
    print(f"  Volkova lookup size: {len(vol_lookup):,}")

    print(f"\nApplying Form 4 bridge (scoped by issuer)...")
    addon = addon.merge(f4_lookup, on=["company_CIK", "norm_name"], how="left")
    f4_hit = addon["rpt_owner_cik"].notna()
    print(f"  Form 4 scoped hits: {f4_hit.sum():,} / {len(addon):,} ({f4_hit.mean():.1%})")

    # Global unambiguous fallback: a norm_name that maps to exactly one
    # rpt_owner_cik across ALL issuers can be used even when our addon's
    # issuer isn't in that person's Form 4 history (e.g., they filed F4 for
    # other biotechs they advise but we detected >5% on a third company).
    print(f"\nBuilding global unambiguous Form 4 lookup...")
    form4_norm = form4.copy()
    form4_norm["norm_name"] = form4_norm["rpt_owner_name"].map(normalize_name)
    form4_norm = form4_norm[form4_norm["norm_name"].str.len() > 0]
    global_counts = (
        form4_norm.groupby("norm_name")["rpt_owner_cik"]
        .nunique()
        .reset_index(name="n_ciks")
    )
    unique_names = global_counts[global_counts["n_ciks"] == 1]["norm_name"]
    global_lookup = (
        form4_norm[form4_norm["norm_name"].isin(unique_names)]
        .groupby("norm_name")["rpt_owner_cik"]
        .first()
        .reset_index()
        .rename(columns={"rpt_owner_cik": "global_rpt_cik"})
    )
    print(f"  global unambiguous names: {len(global_lookup):,}")

    addon = addon.merge(global_lookup, on="norm_name", how="left")
    global_hit = addon["rpt_owner_cik"].isna() & addon["global_rpt_cik"].notna()
    addon.loc[global_hit, "rpt_owner_cik"] = addon.loc[global_hit, "global_rpt_cik"]
    f4_hit = addon["rpt_owner_cik"].notna()
    print(f"  Form 4 global hits: +{global_hit.sum():,}")
    print(f"  Form 4 total hits: {f4_hit.sum():,} / {len(addon):,} ({f4_hit.mean():.1%})")

    print(f"\nApplying Volkova name bridge to F4 misses...")
    addon = addon.merge(vol_lookup, on=["company_CIK", "norm_name"], how="left")
    vol_hit = addon["rpt_owner_cik"].isna() & addon["vol_cik"].notna()
    print(f"  Volkova hits: {vol_hit.sum():,} / {(~f4_hit).sum():,} F4-misses")

    # ---- TF-IDF char-ngram fuzzy match (ING banks recipe) ----
    # Fit vectorizer on the union of F4 and Volkova norm_names. Match
    # unmatched addon rows against F4 side (richer) scoped by issuer,
    # then globally.
    miss_mask = addon["rpt_owner_cik"].isna() & addon["vol_cik"].isna()
    n_miss = miss_mask.sum()
    print(f"\nFuzzy-matching {n_miss:,} still-unmatched rows (TF-IDF char 3-grams)...")

    SIM_SCOPED = 0.80
    SIM_GLOBAL = 0.90

    # Right side: Form 4 pairs
    f4_norm = form4.copy()
    f4_norm["issuer_cik"] = f4_norm["issuer_cik"].astype("int64")
    f4_norm["rpt_owner_cik"] = f4_norm["rpt_owner_cik"].astype("int64")
    f4_norm["norm_name"] = f4_norm["rpt_owner_name"].map(normalize_name)
    f4_norm = f4_norm[f4_norm["norm_name"].str.len() > 0].reset_index(drop=True)

    left = addon.loc[miss_mask, ["company_CIK", "norm_name"]].reset_index()
    left = left[left["norm_name"].str.len() > 0]

    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
    vec.fit(pd.concat([left["norm_name"], f4_norm["norm_name"]], ignore_index=True))

    fuzzy_cik = pd.Series(pd.NA, index=addon.index, dtype="Int64")
    fuzzy_score = pd.Series(np.nan, index=addon.index)

    # Scoped pass: for each issuer with misses, fuzzy-match within that
    # issuer's F4 candidate pool at SIM_SCOPED threshold.
    print(f"  scoped pass (threshold {SIM_SCOPED})...")
    scoped_hits = 0
    for cik, sub in left.groupby("company_CIK"):
        cand = f4_norm[f4_norm["issuer_cik"] == cik]
        if cand.empty:
            continue
        L = vec.transform(sub["norm_name"])
        R = vec.transform(cand["norm_name"])
        top = sp_matmul_topn(L, R.T, top_n=1, threshold=SIM_SCOPED, sort=True)
        coo = top.tocoo()
        for li, ri, score in zip(coo.row, coo.col, coo.data):
            idx_in_addon = sub["index"].iloc[li]
            fuzzy_cik.at[idx_in_addon] = int(cand["rpt_owner_cik"].iloc[ri])
            fuzzy_score.at[idx_in_addon] = float(score)
            scoped_hits += 1
    print(f"    scoped fuzzy hits: {scoped_hits:,}")

    # Global pass: remaining misses against ALL F4 norm_names, stricter threshold.
    still_miss = miss_mask & fuzzy_cik.isna()
    sub = addon.loc[still_miss, ["norm_name"]].reset_index()
    sub = sub[sub["norm_name"].str.len() > 0]
    if len(sub):
        print(f"  global pass (threshold {SIM_GLOBAL}) on {len(sub):,} rows...")
        # Collapse F4 to (norm_name -> modal rpt_owner_cik) for a one-row-per-name right side
        f4_global = (
            f4_norm.groupby("norm_name")["rpt_owner_cik"]
            .agg(lambda x: x.mode().iloc[0])
            .reset_index()
        )
        L = vec.transform(sub["norm_name"])
        R = vec.transform(f4_global["norm_name"])
        top = sp_matmul_topn(L, R.T, top_n=1, threshold=SIM_GLOBAL, sort=True)
        coo = top.tocoo()
        global_hits = 0
        for li, ri, score in zip(coo.row, coo.col, coo.data):
            idx_in_addon = sub["index"].iloc[li]
            fuzzy_cik.at[idx_in_addon] = int(f4_global["rpt_owner_cik"].iloc[ri])
            fuzzy_score.at[idx_in_addon] = float(score)
            global_hits += 1
        print(f"    global fuzzy hits: {global_hits:,}")

    fuzzy_hit = fuzzy_cik.notna()
    print(f"  total fuzzy hits: {fuzzy_hit.sum():,} / {n_miss:,}")

    addon["fuzzy_cik"] = fuzzy_cik
    addon["fuzzy_score"] = fuzzy_score

    # Resolve final CIK: F4 scoped/global > Volkova name > TF-IDF fuzzy > synthetic
    final_cik = addon["blockholder_CIK"].astype("int64") + SYNTHETIC_OFFSET
    final_cik = final_cik.where(~fuzzy_hit, addon["fuzzy_cik"])
    final_cik = final_cik.where(~vol_hit, addon["vol_cik"])
    final_cik = final_cik.where(~f4_hit, addon["rpt_owner_cik"])
    addon["blockholder_CIK"] = final_cik.astype("int64")

    # Inherit Volkova block_type where matched via name bridge
    addon.loc[vol_hit, "block_type"] = addon.loc[vol_hit, "vol_block_type"]

    n_synth = (addon["blockholder_CIK"] >= SYNTHETIC_OFFSET).sum()
    print(f"\nFinal add-on CIK source breakdown:")
    print(f"  Form 4:     {f4_hit.sum():,} ({f4_hit.mean():.1%})")
    print(f"  Volkova:    {vol_hit.sum():,} ({vol_hit.mean():.1%})")
    print(f"  Fuzzy:      {fuzzy_hit.sum():,} ({fuzzy_hit.mean():.1%})")
    print(f"  Synthetic:  {n_synth:,} ({n_synth/len(addon):.1%})")

    addon_out = addon[
        [
            "blockholder_CIK", "blockholder_name", "company_CIK", "company_name",
            "year", "position", "block_type", "files_13F",
        ]
    ].copy()

    # Tag prior add-on rows in prebridge by personid membership and DROP them.
    # (They were added by the same pipeline with blockholder_CIK = personid.)
    tr = pd.read_parquet(TR)
    personids = set(tr["personid"].dropna().astype("int64"))
    print(f"\n  TR personid universe: {len(personids):,}")
    prior_addon_mask = (
        pre["blockholder_CIK"].isin(personids)
        & pre["year"].between(2019, 2024)
    )
    print(f"  prebridge rows flagged as prior add-on: {prior_addon_mask.sum():,}")
    base = pre[~prior_addon_mask].copy()
    print(f"  base (non-addon) rows: {len(base):,}")

    combined = pd.concat([base, addon_out], ignore_index=True)
    before = len(combined)
    combined = combined.drop_duplicates(subset=["company_CIK", "blockholder_CIK", "year"])
    print(f"\n  combined: {before:,} -> dedup {len(combined):,}")

    post_synth = (combined["blockholder_CIK"] >= SYNTHETIC_OFFSET).sum()
    print(f"  final synthetic CIKs: {post_synth:,}")
    print(f"  final real SEC CIKs:  {len(combined) - post_synth:,}")

    if OUT.exists():
        shutil.copy2(OUT, BACKUP)
        print(f"\n  Backed up prior output -> {BACKUP.name}")
    combined.to_parquet(OUT)
    print(f"  Wrote {OUT.relative_to(PROJ)} ({len(combined):,} rows)")


if __name__ == "__main__":
    main()
