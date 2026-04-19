"""Aggregate parsed filings to the company-blockholder-year panel.

Mirrors Volkova's R scripts 7-9:

- **Script 7 (`combine_annual_file.R`)** — `build_panel`:
  - Year assignment with 13G cut-off and Jan-14 roll-back
  - Drop max_prc <= 4.5 and missing fil_cik rows
  - Dedup per (fil_cik, sbj_cik, year): ascending sort on `Jan1 - DATE`
    keeps the **latest** filing within a year (amendments roll forward)
  - Gap-fill: if a (fil, sbj) pair has YEAR gaps of 2/3/4, forward-fill
    intermediate years with a duplicate row (assumes still-holding blockholder)
  - 13F join: files_13F = 1 if blockholder filed any 13F in that year
  - block_type collapsed to {individual, institution, other}

- **Script 8 (`Download Insider Forms.R`)** — `insider_addon_from_ownership`:
  - Volkova scrapes `https://www.sec.gov/cgi-bin/own-disp?action=getissuer&CIK=…`
    for every Compustat-linked CIK and saves the Form 3/4/5 ownership table
    per company. This produces one CSV per issuer CIK keyed by insider CIK
    with `Num_Own` (cumulative shares owned).
  - We expose `insider_addon_from_ownership(...)` that takes the already-scraped
    tables + a CRSP SHROUT dataframe and yields insider blocks. **The scrape
    itself is not ported** (5–10% of published rows, rate-limited at SEC; see
    docstring for the URL pattern if we ever want to run it).

- **Script 9 (`add insider data.R`)** — `merge_insider_addon`:
  - Computes `prc_own = 100 * Num_Own / (1000 * SHROUT)` (CRSP SHROUT is in
    thousands). Filters `max_prc_own >= 4.5`. Groups co-filers by accession
    and appends any `(blockholder_CIK, company_CIK, year)` triples NOT already
    in the 13D/13G panel, with `files_13F = 0`.
"""

from __future__ import annotations

import pandas as pd
import numpy as np


def _parse_date(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, format="%Y%m%d", errors="coerce")


def assign_year(filings: pd.DataFrame) -> pd.DataFrame:
    """Annual year assignment mirroring Volkova script 7."""
    df = filings.copy()
    df["file_date_dt"] = _parse_date(df["file_date"])
    df["filing_year"] = df["file_date_dt"].dt.year
    df["year"] = df["filing_year"]

    # 13G with max_prc<10 & filed by Feb 14 → YEAR - 1
    g_mask = (
        df["form_type"].str.contains(r"SC 13G", regex=True, na=False)
        & (df["max_prc"] < 10)
        & (df["file_date_dt"] - pd.to_datetime(df["filing_year"].astype(str) + "-02-14")
           <= pd.Timedelta(days=10))
    )
    df.loc[g_mask, "year"] = df.loc[g_mask, "filing_year"] - 1

    # Anyone filed in first 14 days of year → previous year
    jan_mask = (
        df["file_date_dt"] - pd.to_datetime(df["filing_year"].astype(str) + "-01-01")
        <= pd.Timedelta(days=14)
    )
    df.loc[jan_mask, "year"] = df.loc[jan_mask, "filing_year"] - 1

    return df


def _to_int_cik(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.str.lstrip("0").replace("", "0"), errors="coerce").astype("Int64")


def dedup_panel(df: pd.DataFrame) -> pd.DataFrame:
    """Keep the LATEST filing per (fil_cik, sbj_cik, year) triple.

    Mirrors: setkey(forms, fil_CIK, sbj_CIK, YEAR, dif); forms[!duplicated(...)]
    where dif = Jan 1 of YEAR - DATE. dif is negative for filings after Jan 1,
    so ascending sort on dif puts the LATEST filing first → kept by dedup.

    The latest amendment supersedes earlier filings within the year.
    """
    df = df[(df["max_prc"] > 4.5) & df["fil_cik"].notna()].copy()
    df["fil_cik_i"] = _to_int_cik(df["fil_cik"])
    df["sbj_cik_i"] = _to_int_cik(df["sbj_cik"])
    df = df[df["fil_cik_i"].notna() & df["sbj_cik_i"].notna()]
    # Sort so that the LATEST file_date within each (fil, sbj, year) triple comes first
    df = df.sort_values(["fil_cik_i", "sbj_cik_i", "year", "file_date_dt"],
                        ascending=[True, True, True, False])
    df = df.drop_duplicates(subset=["fil_cik_i", "sbj_cik_i", "year"], keep="first")
    return df


def gap_fill(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill gaps of 2/3/4 years per (fil, sbj) pair."""
    df = df.sort_values(["fil_cik_i", "sbj_cik_i", "year"]).reset_index(drop=True)
    for step in (4, 3, 2):
        df["_next_year"] = df.groupby(["fil_cik_i", "sbj_cik_i"])["year"].shift(-1)
        df["_gap"] = df["_next_year"] - df["year"]
        add = df[df["_gap"] == step].copy()
        add["year"] = add["year"] + 1
        df = pd.concat([df, add], ignore_index=True)
        df = df.sort_values(["fil_cik_i", "sbj_cik_i", "year"]).reset_index(drop=True)
    df = df.drop(columns=["_next_year", "_gap"])
    return df


def attach_13f_flag(df: pd.DataFrame, thirteenf: pd.DataFrame) -> pd.DataFrame:
    """Mark files_13F=1 if blockholder CIK appears in the 13F index for that year."""
    pairs = set(zip(thirteenf["cik_int"].astype(int).tolist(),
                    thirteenf["year"].astype(int).tolist()))
    df["files_13F"] = [
        1 if (int(c), int(y)) in pairs else 0
        for c, y in zip(df["fil_cik_i"].fillna(0).astype(int),
                         df["year"].fillna(0).astype(int))
    ]
    return df


def classify_block_type(df: pd.DataFrame) -> pd.DataFrame:
    """Volkova's 4-flag classification + collapsed `block_type` for back-compat.

    Four mutually-exclusive flags (lines 128-132 of Volkova's script 7):
      individual   = (item12 == 'in')
      active_inst  = 13D filer & files_13F & not individual
      passive_inst = 13G filer & files_13F & not individual
      other        = 1 - individual - active_inst - passive_inst

    `filing_type ∈ {'13D', '13G'}` is derived from the retained filing's
    `form_type` (post-dedup, so it reflects the LATEST filing of the year).
    """
    ft = df["form_type"].fillna("")
    df["filing_type"] = np.where(
        ft.str.contains("13D", regex=False), "13D",
        np.where(ft.str.contains("13G", regex=False), "13G", pd.NA),
    )

    is_individual = df["item12"].fillna("").eq("in")
    is_13d = df["filing_type"].eq("13D")
    is_13g = df["filing_type"].eq("13G")
    is_13f = df["files_13F"] == 1

    df["individual"] = is_individual.astype("int8")
    df["active_inst"] = ((~is_individual) & is_13d & is_13f).astype("int8")
    df["passive_inst"] = ((~is_individual) & is_13g & is_13f).astype("int8")
    df["other"] = (1 - df["individual"] - df["active_inst"] - df["passive_inst"]).astype("int8")

    is_institution = (~is_individual) & is_13f
    df["block_type"] = np.where(
        is_individual, "individual",
        np.where(is_institution, "institution", "other"),
    )
    return df


def to_output_schema(df: pd.DataFrame) -> pd.DataFrame:
    """Match Volkova public CSV columns exactly."""
    df = df.copy()
    df["blockholder_CIK"] = df["fil_cik_i"].astype(int)
    df["company_CIK"] = df["sbj_cik_i"].astype(int)
    df["blockholder_name"] = df["fil_name"]
    df["company_name"] = df["sbj_name"]
    df["position"] = df["max_prc"].round(2)
    return df[[
        "blockholder_CIK", "blockholder_name",
        "company_CIK", "company_name",
        "year", "position", "block_type", "files_13F",
        "filing_type", "individual", "active_inst", "passive_inst", "other",
    ]]


def build_panel(filings: pd.DataFrame, thirteenf: pd.DataFrame, skip_gap_fill: bool = False) -> pd.DataFrame:
    """Full pipeline: filings DataFrame → Volkova-shaped panel."""
    df = assign_year(filings)
    df = dedup_panel(df)
    if not skip_gap_fill:
        df = gap_fill(df)
    df = attach_13f_flag(df, thirteenf)
    df = classify_block_type(df)
    return to_output_schema(df)


# ---------------------------------------------------------------------------
# Scripts 8 & 9 — insider add-on
#
# Volkova's scripts 8-9 add ~5-10% of the published rows by scraping SEC
# Form 3/4/5 insider data. Two data sources are supported:
#
#   (a) SEC own-disp per-CIK scrapes (legacy, Volkova's original approach).
#       Tables conform to ``OWN_DISP_COLUMNS``; issuer keyed by CIK.
#   (b) WRDS ``tr_insiders.table1`` (preferred — see
#       ``scripts/pull_insider_ownership.py``). Tables are keyed by cusip6 with
#       TR's ``personid`` as insider identifier and ``sharesheld`` (adj)
#       as cumulative shares owned.
#
# ``find_blocks`` handles both by normalising into a common schema. ``cusip6
# → company_CIK`` resolution uses the CRSP-Compustat link (same table used in
# ``pull_crsp_msf.py``).
# ---------------------------------------------------------------------------


OWN_DISP_URL = (
    "https://www.sec.gov/cgi-bin/own-disp?action=getissuer&CIK={cik:08d}"
)
OWN_DISP_COLUMNS = [
    "A_D", "TrDate", "ExDate", "blockholder_name", "Form", "Type",
    "D_I", "Num_Tr", "Num_Own", "Line", "blockholder_CIK", "Security",
]


def find_blocks(company_cik: int, insider_df: pd.DataFrame,
                crsp_msf: pd.DataFrame) -> pd.DataFrame:
    """Compute max-percent blocks for one company from insider Form 3/4/5 rows.

    Mirrors Volkova's R ``find_blocks`` in script 9 exactly:
      prc_own = 100 * Num_Own / (1000 * SHROUT)   # SHROUT is in thousands
      filter Security == "Common Stock"
      keep max(prc_own) per (blockholder_CIK, year)
      keep only blockholders whose lifetime max_prc >= 4.5
      caller should further filter to position > 5

    Parameters
    ----------
    company_cik : int
    insider_df : pd.DataFrame
        Either the OWN_DISP layout or TR layout. Must include one of:
        (TrDate, Num_Own, Security, blockholder_CIK, blockholder_name) OR
        (trandate, sharesheld, sectitle, personid, owner).
    crsp_msf : pd.DataFrame
        Must have columns ('cik', 'year_month', 'SHROUT') filtered to
        company_cik OR pre-filtered already.
    """
    if insider_df is None or len(insider_df) < 2:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    o = insider_df.copy()
    # Normalise to (date, shares, blockholder_id, blockholder_name, security)
    if "trandate" in o.columns:                # TR layout
        o = o.rename(columns={
            "trandate": "date",
            "sharesheld": "Num_Own",
            "personid": "blockholder_CIK",
            "owner": "blockholder_name",
            "sectitle": "Security",
        })
        # TR's "COM" means common stock
        o = o[o["Security"] == "COM"]
    else:                                      # OWN_DISP layout
        o = o.rename(columns={"TrDate": "date"})
        o = o[o["Security"] == "Common Stock"]

    o["date"] = pd.to_datetime(o["date"], errors="coerce")
    o = o.dropna(subset=["date", "Num_Own", "blockholder_CIK"])
    if o.empty:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    o["year_month"] = o["date"].values.astype("datetime64[M]")
    o["Num_Own"] = pd.to_numeric(o["Num_Own"], errors="coerce")
    o = o.dropna(subset=["Num_Own"])

    shrout = crsp_msf
    if "cik" in shrout.columns:
        shrout = shrout[shrout["cik"] == company_cik]
    shrout = shrout[["year_month", "SHROUT"]].copy()
    if shrout.empty:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    merged = o.merge(shrout, on="year_month", how="inner")
    if merged.empty:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    merged["prc_own"] = 100 * merged["Num_Own"] / (1000 * merged["SHROUT"])
    merged["max_prc"] = merged.groupby("blockholder_CIK")["prc_own"] \
                               .transform("max")
    merged = merged[merged["max_prc"] >= 4.5]
    if merged.empty:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    merged["year"] = merged["date"].dt.year
    g = (
        merged.sort_values(["blockholder_CIK", "date"])
              .groupby(["blockholder_CIK", "year"], as_index=False)
              .agg(position=("prc_own", "max"),
                   blockholder_name=("blockholder_name", "first"))
    )
    g["company_CIK"] = company_cik
    g["blockholder_CIK"] = pd.to_numeric(g["blockholder_CIK"], errors="coerce") \
                              .astype("Int64")
    return g[["company_CIK", "blockholder_CIK", "blockholder_name",
              "year", "position"]]


def compute_insider_addon(
    annual_panel: pd.DataFrame,
    tr_insider: pd.DataFrame,
    crsp_msf: pd.DataFrame,
    cusip6_to_cik: dict | pd.DataFrame,
    year_range: tuple[int, int] = (1994, 2024),
    position_threshold: float = 5.0,
) -> pd.DataFrame:
    """Compute insider-derived blocks across all companies in tr_insider.

    Mirrors the body of script 9 after the per-company ``find_blocks`` loop
    (co-filer grouping omitted — TR already flattens Form 3/4/5 reporters
    into separate rows, so the grouping step is a no-op in TR's layout).

    Parameters
    ----------
    annual_panel : pd.DataFrame
        The existing 13D/G-derived Volkova panel. Rows from the add-on that
        already appear in ``annual_panel`` as ``(company_CIK, blockholder_CIK,
        year)`` are dropped.
    tr_insider : pd.DataFrame
        Output of ``scripts/pull_insider_ownership.py`` — per-row insider
        filings with cusip6, personid, sharesheld, trandate.
    crsp_msf : pd.DataFrame
        Output of ``scripts/pull_crsp_msf.py``. Must include cik, year_month,
        SHROUT.
    cusip6_to_cik : dict or DataFrame
        Map from cusip6 to issuer CIK. DataFrame form expects columns
        ('cusip6', 'cik').
    year_range : (int, int)
        Keep only blocks with year in this range.
    position_threshold : float
        Final min position cutoff (Volkova: > 5).
    """
    # Build cusip6 → cik dict
    if isinstance(cusip6_to_cik, pd.DataFrame):
        m = cusip6_to_cik[["cusip6", "cik"]].drop_duplicates("cusip6")
        cusip_map = dict(zip(m["cusip6"].astype(str), m["cik"].astype(int)))
    else:
        cusip_map = {str(k): int(v) for k, v in cusip6_to_cik.items()}

    tr = tr_insider.copy()
    tr["cusip6"] = tr["cusip6"].astype(str)
    tr["company_CIK"] = tr["cusip6"].map(cusip_map)
    tr = tr.dropna(subset=["company_CIK"])
    tr["company_CIK"] = tr["company_CIK"].astype(int)

    # Pre-index shrout by cik for fast subset
    shrout_by_cik = {
        int(g_cik): sub[["year_month", "SHROUT"]]
        for g_cik, sub in crsp_msf.groupby("cik")
    }

    blocks_list: list[pd.DataFrame] = []
    grouped = tr.groupby("company_CIK", sort=False)
    n = grouped.ngroups
    for i, (cik, sub) in enumerate(grouped):
        shrout = shrout_by_cik.get(int(cik))
        if shrout is None or shrout.empty:
            continue
        b = find_blocks(int(cik), sub, shrout)
        if not b.empty:
            blocks_list.append(b)
        if (i + 1) % 1000 == 0:
            print(f"  [find_blocks] {i+1}/{n} cos, accumulated={sum(len(x) for x in blocks_list):,}")

    if not blocks_list:
        return pd.DataFrame(columns=[
            "blockholder_CIK", "blockholder_name", "company_CIK", "company_name",
            "year", "position", "block_type", "files_13F",
        ])

    blocks = pd.concat(blocks_list, ignore_index=True)
    blocks = blocks[blocks["position"] > position_threshold]
    blocks = blocks[blocks["year"].between(*year_range)]

    # Dedup against annual panel on (company, blockholder, year)
    key_panel = set(zip(
        annual_panel["company_CIK"].astype(int),
        annual_panel["blockholder_CIK"].astype(int),
        annual_panel["year"].astype(int),
    ))
    blocks["_key"] = list(zip(
        blocks["company_CIK"].astype(int),
        blocks["blockholder_CIK"].astype(int),
        blocks["year"].astype(int),
    ))
    blocks = blocks[~blocks["_key"].isin(key_panel)]
    blocks = blocks.drop_duplicates(subset=["_key"]).drop(columns=["_key"])

    # Shape to panel schema
    blocks["company_name"] = pd.NA
    blocks["block_type"] = "individual"
    blocks["files_13F"] = 0
    blocks["filing_type"] = pd.NA
    blocks["individual"] = np.int8(1)
    blocks["active_inst"] = np.int8(0)
    blocks["passive_inst"] = np.int8(0)
    blocks["other"] = np.int8(0)
    return blocks[[
        "blockholder_CIK", "blockholder_name", "company_CIK", "company_name",
        "year", "position", "block_type", "files_13F",
        "filing_type", "individual", "active_inst", "passive_inst", "other",
    ]]


def insider_addon_from_ownership(
    ownership_by_company: dict[int, pd.DataFrame],
    crsp_shrout: pd.DataFrame,
) -> pd.DataFrame:
    """Compute insider-derived blocks (Volkova script 9 `find_blocks`).

    Parameters
    ----------
    ownership_by_company
        ``{company_CIK: DataFrame}`` keyed by issuer CIK. Each DataFrame has
        columns from the SEC own-disp table (see ``OWN_DISP_COLUMNS``).
    crsp_shrout
        CRSP MSF with at least columns ``['cik', 'year_month', 'SHROUT']``
        where ``SHROUT`` is in thousands of shares and ``year_month`` is the
        first-of-month timestamp.

    Returns
    -------
    DataFrame with columns
    ``['company_CIK', 'blockholder_CIK', 'blockholder_name', 'year',
       'position']``.
    """
    if not ownership_by_company:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )

    shrout = crsp_shrout[["cik", "year_month", "SHROUT"]].copy()
    out: list[pd.DataFrame] = []

    for company_cik, own in ownership_by_company.items():
        if len(own) < 2:
            continue
        tmp = shrout[shrout["cik"] == company_cik]
        if tmp.empty:
            continue

        o = own.copy()
        o.columns = OWN_DISP_COLUMNS[: len(o.columns)]
        o = o[o["Security"] == "Common Stock"].copy()
        o["date"] = pd.to_datetime(o["TrDate"], errors="coerce")
        o = o.dropna(subset=["date"])
        o["year_month"] = o["date"].values.astype("datetime64[M]")
        o["Num_Own"] = pd.to_numeric(o["Num_Own"], errors="coerce")

        merged = o.merge(tmp, on="year_month", how="inner")
        merged["prc_own"] = 100 * merged["Num_Own"] / (1000 * merged["SHROUT"])
        merged["max_prc"] = merged.groupby("blockholder_CIK")["prc_own"] \
                                   .transform("max")
        merged = merged[merged["max_prc"] >= 4.5]
        if merged.empty:
            continue

        merged["year"] = merged["date"].dt.year
        g = (
            merged.sort_values(["blockholder_CIK", "date"])
                  .groupby(["blockholder_CIK", "year"], as_index=False)
                  .agg(position=("prc_own", "max"),
                       blockholder_name=("blockholder_name", "first"))
        )
        g["company_CIK"] = company_cik
        out.append(g)

    if not out:
        return pd.DataFrame(
            columns=["company_CIK", "blockholder_CIK", "blockholder_name",
                     "year", "position"]
        )
    return pd.concat(out, ignore_index=True)


def merge_insider_addon(annual: pd.DataFrame, addon: pd.DataFrame,
                        year_range: tuple[int, int] = (1994, 2023)) -> pd.DataFrame:
    """Append insider-derived blocks to the annual panel (Volkova script 9 tail).

    Rows are kept only if (company_CIK, blockholder_CIK, year) is NOT already
    in `annual` and `position > 5` and year is in range.

    `files_13F` on add-on rows is forced to 0 because insider CIKs rarely
    match the 13F filer universe.
    """
    if addon.empty:
        return annual

    annual = annual.copy()
    annual["_key"] = (annual["company_CIK"].astype(str) + "|" +
                      annual["blockholder_CIK"].astype(str) + "|" +
                      annual["year"].astype(str))

    add = addon.copy()
    add["_key"] = (add["company_CIK"].astype(str) + "|" +
                   add["blockholder_CIK"].astype(str) + "|" +
                   add["year"].astype(str))
    add = add[~add["_key"].isin(set(annual["_key"]))]
    add = add[(add["year"] >= year_range[0]) & (add["year"] <= year_range[1])]
    add = add[add["position"] > 5]
    add = add.drop_duplicates(subset=["_key"])
    add["files_13F"] = 0
    add["block_type"] = "individual"  # insider CIKs default to individual
    add["company_name"] = pd.NA
    add["filing_type"] = pd.NA
    add["individual"] = np.int8(1)
    add["active_inst"] = np.int8(0)
    add["passive_inst"] = np.int8(0)
    add["other"] = np.int8(0)

    # Align to annual schema
    cols = [c for c in annual.columns if c != "_key"]
    for c in cols:
        if c not in add.columns:
            add[c] = pd.NA
    add = add[cols]

    out = pd.concat([annual.drop(columns=["_key"]), add], ignore_index=True)
    return out
