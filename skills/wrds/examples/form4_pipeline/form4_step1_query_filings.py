"""Step 1: Build file list of all Form 3/4/5 XMLs for issuers relevant to
TR add-on personids (2019-2024).

Rationale for pulling wide (all forms per issuer, not just exact fdate
matches): TR's `fdate` does not always match SEC's `fdate` in
`wrdssec_all.wrds_forms` (often differs by 1-3 days for after-hours
filings). A fuzzy ±3-day match gets complicated. Instead, pull ALL
Form 3/4/5 for each candidate issuer in the window (~540K filings,
~500MB compressed as tar.gz). Parsing builds:

    (issuer_cik, normalize(rptOwnerName)) -> rptOwnerCik

…which then joins to TR add-on rows by (company_CIK, normalize(owner)).

Output:
  data/processed/form4_filings_to_pull.parquet — metadata (cik, form,
      fdate, accession, fname)
  data/raw/form4_xmls/files_to_download.txt   — rclone-relative paths
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

PROJ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJ))
from src.wrds_pull import connect as wrds_connect  # noqa: E402

TR = PROJ / "data/processed/tr_insider_all.parquet"
ADDON = PROJ / "data/processed/insider_addon_2019_2024.parquet"
CUSIP_MAP = PROJ / "data/processed/cusip6_cik_map.parquet"
OUT_META = PROJ / "data/processed/form4_filings_to_pull.parquet"
OUT_LIST = PROJ / "data/raw/form4_xmls/files_to_download.txt"

YEAR_MIN = 2019
YEAR_MAX = 2024


def fname_to_rclone_path(fname: str) -> str:
    parts = fname.split("/")
    cik_int = parts[2]
    filename = parts[3]
    parent = cik_int.zfill(10)[:6]
    return f"{parent}/{cik_int}/{filename}"


def main():
    print(f"Loading add-on personids from {ADDON.name}")
    addon = pd.read_parquet(ADDON)
    pids = set(addon["blockholder_CIK"].astype("int64"))
    print(f"  unique personids: {len(pids):,}")

    print(f"Loading TR filings")
    tr = pd.read_parquet(TR)
    tr = tr[tr["personid"].isin(pids)].copy()
    cusip6_set = set(tr["cusip6"].dropna().unique())
    print(f"  cusip6s involved: {len(cusip6_set):,}")

    print(f"Resolving cusip6 → issuer CIK")
    cmap = pd.read_parquet(CUSIP_MAP)[["cusip6", "cik"]].drop_duplicates("cusip6")
    ciks = sorted(
        {int(c) for c in cmap[cmap["cusip6"].isin(cusip6_set)]["cik"].dropna().unique()}
    )
    print(f"  candidate issuer CIKs: {len(ciks):,}")

    print(f"Connecting to WRDS")
    conn = wrds_connect()

    sql = """
        SELECT cik::bigint AS cik, accession, form, fdate, fname, fsize
        FROM wrdssec_all.wrds_forms
        WHERE cik::bigint = ANY(%(ciks)s)
          AND form IN ('3', '4', '5', '3/A', '4/A', '5/A')
          AND fdate BETWEEN %(min_d)s AND %(max_d)s
    """
    min_d = f"{YEAR_MIN}-01-01"
    max_d = f"{YEAR_MAX}-12-31"
    print(f"Executing wrds_forms query ({min_d} → {max_d}, {len(ciks):,} CIKs)…")
    forms = pd.read_sql(
        sql, conn, params={"ciks": ciks, "min_d": min_d, "max_d": max_d}
    )
    conn.close()
    print(f"  total Form 3/4/5 filings: {len(forms):,}")
    print(f"  total fsize: {forms['fsize'].sum() / 1e9:.2f} GB")

    forms["fdate"] = pd.to_datetime(forms["fdate"])

    OUT_LIST.parent.mkdir(parents=True, exist_ok=True)
    unique_fnames = forms["fname"].drop_duplicates()
    with OUT_LIST.open("w") as f:
        for fname in unique_fnames:
            f.write(fname_to_rclone_path(fname) + "\n")
    print(f"Wrote {OUT_LIST.relative_to(PROJ)} ({len(unique_fnames):,} filings)")

    forms.to_parquet(OUT_META)
    print(f"Wrote {OUT_META.relative_to(PROJ)} ({len(forms):,} rows)")


if __name__ == "__main__":
    main()
