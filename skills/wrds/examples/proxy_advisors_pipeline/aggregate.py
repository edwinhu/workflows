"""Aggregate per-filing proxy-advisor flags to fund-family × year panel.

Input:  per-year TSV.gz from scan_covers proxy_advisors profile.
Output: link_fundmgmt_proxyadvisor.csv, matching the chongshu schema.

Pipeline:
    1. Load all per-year TSVs → tall filing-level frame.
    2. Apply N-PX sample frame from ISS Voting Analytics (CIK × year that
       actually filed N-PX). Filings outside the frame are dropped, matching
       the paper's universe.
    3. Aggregate CIK × year (max over hit flags within the year).
    4. Join CRSP Mutual Fund DB to map CIK → mgmt_cd. NB: CIK is at the
       fund-registrant level; mgmt_cd is the management-company level
       (typically a 1-to-many: one mgmt_cd covers many series CIKs).
    5. Aggregate to mgmt_cd × year (max over CIKs within the family).
    6. Write CSV.

Run on the local machine (not WRDS). Connects to WRDS PostgreSQL for the
CRSP join only — no compute on the login node.
"""

from __future__ import annotations

import argparse
import gzip
from pathlib import Path

import pandas as pd

COLS = ["filepath", "accession", "form_type", "filed_date", "cik",
        "company_name", "iss_hit", "gl_hit", "ej_hit"]
HIT_COLS = ["iss_hit", "gl_hit", "ej_hit"]


def load_scan_outputs(scan_dir: Path) -> pd.DataFrame:
    frames = []
    for f in sorted(scan_dir.glob("*.tsv.gz")):
        with gzip.open(f, "rt") as fh:
            df = pd.read_csv(fh, sep="\t", header=None, names=COLS,
                             dtype={"cik": "string", "filed_date": "string"})
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    out["year"] = out["filed_date"].str.slice(0, 4).astype(int)
    out["cik"] = out["cik"].astype(int)
    for c in HIT_COLS:
        out[c] = out[c].fillna(0).astype(int)
    return out


def aggregate_cik_year(df: pd.DataFrame) -> pd.DataFrame:
    """One row per (cik, year) with any-hit aggregation."""
    g = df.groupby(["cik", "year"], as_index=False)[HIT_COLS].max()
    # Also keep the first source accession per advisor-hit for auditability.
    src_rows = []
    for (cik, year), sub in df.groupby(["cik", "year"]):
        row = {"cik": cik, "year": year}
        for c in HIT_COLS:
            hits = sub.loc[sub[c] == 1, "accession"]
            row[f"{c}_src"] = hits.iloc[0] if len(hits) else ""
        src_rows.append(row)
    src = pd.DataFrame(src_rows)
    return g.merge(src, on=["cik", "year"], how="left")


def _pg_connect(wrds_user: str | None):
    """Lightweight psycopg2 connection (no `wrds` package dep)."""
    import psycopg2
    return psycopg2.connect(
        host="wrds-pgdata.wharton.upenn.edu",
        port=9737,
        database="wrds",
        user=wrds_user or "eddyhu",
        sslmode="require",
    )


def load_npx_frame(wrds_user: str | None) -> pd.DataFrame:
    """ISS Voting Analytics N-PX index → unique (cik, year).

    Paper uses 2007 onward when ISS coverage stabilizes; we return everything
    available and let the caller filter.
    """
    conn = _pg_connect(wrds_user)
    df = pd.read_sql("""
        SELECT DISTINCT fundcik AS cik,
               EXTRACT(YEAR FROM meetingdate)::int AS year
        FROM risk.voteanalysis_npx
        WHERE fundcik IS NOT NULL
    """, conn)
    conn.close()
    df["cik"] = pd.to_numeric(df["cik"], errors="coerce")
    df = df.dropna(subset=["cik"])
    df["cik"] = df["cik"].astype(int)
    return df


def load_cik_to_mgmt_cd(wrds_user: str | None) -> pd.DataFrame:
    """CRSP Mutual Fund DB: CIK → mgmt_cd via crsp_cik_map ⋈ fund_hdr.

    485 filings are filed at one of three CIK levels (comp / series /
    contract) depending on registrant. We melt all three into a single
    long table so the downstream join matches whichever level the
    filing was made at.
    """
    conn = _pg_connect(wrds_user)
    df = pd.read_sql("""
        SELECT DISTINCT m.comp_cik AS cik, h.mgmt_cd
        FROM crsp_q_mutualfunds.crsp_cik_map m
        JOIN crsp_q_mutualfunds.fund_hdr h USING (crsp_fundno)
        WHERE m.comp_cik IS NOT NULL AND h.mgmt_cd IS NOT NULL
    """, conn)
    conn.close()
    df["cik"] = df["cik"].astype(int)
    return df.drop_duplicates(["cik", "mgmt_cd"]).reset_index(drop=True)


def aggregate_mgmt_year(cik_year: pd.DataFrame, link: pd.DataFrame) -> pd.DataFrame:
    """Lift CIK × year → mgmt_cd × year (max over CIKs in the family)."""
    merged = cik_year.merge(link, on="cik", how="left")
    no_match = merged["mgmt_cd"].isna().sum()
    if no_match:
        print(f"[aggregate] warning: {no_match:,} (cik,year) rows lack CRSP mgmt_cd")
    keep = merged.dropna(subset=["mgmt_cd"])
    return (keep.groupby(["mgmt_cd", "year"], as_index=False)[HIT_COLS].max()
                .rename(columns={"iss_hit": "ISS_prospectus",
                                 "gl_hit": "GL_prospectus",
                                 "ej_hit": "EJ_prospectus"}))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan-dir", type=Path, required=True,
                    help="Directory of per-year *.tsv.gz from scan_covers.")
    ap.add_argument("--out", type=Path, required=True,
                    help="Output CSV path (link_fundmgmt_proxyadvisor.csv).")
    ap.add_argument("--cik-year-out", type=Path,
                    help="Optional: write the intermediate CIK × year panel.")
    ap.add_argument("--apply-npx-frame", action="store_true",
                    help="Filter to (cik, year) pairs present in ISS N-PX. "
                         "Matches the paper's universe.")
    ap.add_argument("--wrds-user", help="WRDS username for crsp + risk libs.")
    args = ap.parse_args()

    print(f"[load] scanning {args.scan_dir}")
    filings = load_scan_outputs(args.scan_dir)
    print(f"[load] {len(filings):,} filings, "
          f"{filings['cik'].nunique():,} CIKs, "
          f"{filings['year'].min()}..{filings['year'].max()}")

    cik_year = aggregate_cik_year(filings)
    print(f"[agg] {len(cik_year):,} (cik, year) rows")

    if args.apply_npx_frame:
        npx = load_npx_frame(args.wrds_user)
        before = len(cik_year)
        cik_year = cik_year.merge(npx, on=["cik", "year"], how="inner")
        print(f"[frame] N-PX filter: {before:,} → {len(cik_year):,}")

    if args.cik_year_out:
        cik_year.to_csv(args.cik_year_out, index=False)
        print(f"[write] {args.cik_year_out}")

    link = load_cik_to_mgmt_cd(args.wrds_user)
    print(f"[link] {len(link):,} (cik, mgmt_cd) pairs from CRSP")

    panel = aggregate_mgmt_year(cik_year, link)
    panel.to_csv(args.out, index=False)
    print(f"[write] {args.out} — {len(panel):,} (mgmt_cd, year) rows")


if __name__ == "__main__":
    main()
