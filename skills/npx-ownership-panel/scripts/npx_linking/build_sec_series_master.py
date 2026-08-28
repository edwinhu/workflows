"""L2a — Consolidate the SEC Investment Company Series/Class annual masters.

Provenance
----------
Source: SEC "Investment Company Series and Class Information" annual files,
    https://www.sec.gov/data-research/sec-markets-data/investment-company-series-class-information
    (downloaded by `scripts/download_sec_series_class.py` into
    `data/raw/sec_series_class/investment_company_series_class_<YYYY>.csv`).

Series (S000...) and Class (C000...) identifiers are **mandatory since Feb 6, 2006**
for registrants filing on Forms N-1A, N-3, N-4 and N-6 — i.e. for the open-end
funds and variable-annuity separate accounts that make up the N-PX voting
universe. Every fund that voted in our sample therefore has an SEC series ID,
even in the pre-2010 years for which the SEC publishes no master file.

Each annual file is a **point-in-time snapshot of then-active registrants**, not a
cumulative history: a fund liquidated (or merged away) before a given year is
simply absent from that year's file. Consequently
  * `year_first_seen` / `year_last_seen` bound a fund's *observed* life in these
    snapshots, not its true birth/death dates (both are censored by the
    2010-2025 window);
  * a series present in only a few years is usually short-lived, not a data error;
  * names and tickers get **reused and restated** over time, so the current name is
    not sufficient to match a 2012-vintage ISS `fundname`. That is why this script
    also emits a long name-history table (see Outputs).

2016 has no file on the SEC page (see `scripts/download_sec_series_class.py`), so
the panel is 15 years: 2010-2015 and 2017-2025.

Header layouts differ across vintages (five distinct column-naming conventions,
preamble/rule/blank lines before the header, a UTF-8 BOM in 2025, padded fields
in 2014, and three different null sentinels). All of that is normalized here; see
`COLUMN_ALIASES` and `read_year`.

Outputs
-------
`data/processed/sec_series_master.parquet`
    CLASS grain (one row per `class_id`) — the finest identifier and the one that
    carries the ticker. Names/tickers are the MOST RECENT non-null observation.
`data/processed/sec_series_names_long.parquet`
    Contemporaneous identity, one row per `(class_id, file_year)`: every
    `series_name`, `class_name`, `class_ticker` and `entity_name` a fund carried
    in each vintage. Used to match a fund's *contemporaneous* name/ticker when
    linking pre-2023 ISS N-PX records, which carry no series ID. Class grain
    because ISS `fundname` values routinely name the share class; the distinct
    `(series_id, series_name, class_ticker, file_year)` tuples are its projection.
`data/processed/sec_series_master_series.parquet`
    SERIES grain (one row per `series_id`) with class count and ticker list.

Usage
-----
  python scripts/linking/build_sec_series_master.py
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import pandas as pd

PROJ = Path(__file__).resolve().parents[2]
RAW = PROJ / "data" / "raw" / "sec_series_class"
OUT = PROJ / "data" / "processed"

RAW_GLOB = "investment_company_series_class_*.csv"
YEAR_RE = re.compile(r"(20\d{2})")

MASTER_CLASS_PATH = OUT / "sec_series_master.parquet"
NAMES_LONG_PATH = OUT / "sec_series_names_long.parquet"
MASTER_SERIES_PATH = OUT / "sec_series_master_series.parquet"

# Values the SEC uses for "no value" across vintages (2012-13 "NULL", 2017+ "[NULL]").
NULL_SENTINELS = {"", "NULL", "[NULL]", "N/A", "NA", "NONE", "-"}

# Identifier formats, asserted at the end of the build.
SERIES_ID_RE = re.compile(r"^S000\d+$")
CLASS_ID_RE = re.compile(r"^C000\d+$")

# CIK is a zero-padded 10-digit string on EDGAR; some vintages ship it unpadded.
CIK_WIDTH = 10

# Canonical snake_case names, keyed by the snake_cased raw header of every vintage.
COLUMN_ALIASES = {
    # reporting_file_number: 1940-Act file number, e.g. "811-01829"
    "reporting_file_number": "reporting_file_number",
    "file_no": "reporting_file_number",
    "rep_file_num": "reporting_file_number",
    # cik
    "cik": "cik",
    "cik_number": "cik",
    # entity_name (the registrant / trust)
    "entity_name": "entity_name",
    "registrant_name": "entity_name",
    "name_of_registrant": "entity_name",
    "name_of_investment_company": "entity_name",
    "name_of_registered_investment_company": "entity_name",
    # entity_org_type (30 = management company, 32/33 = separate account, ...)
    "entity_org_type": "entity_org_type",
    "org_type": "entity_org_type",
    # identifiers and names
    "series_id": "series_id",
    "series_name": "series_name",
    "class_id": "class_id",
    "class_name": "class_name",
    "class_ticker": "class_ticker",
    "class_ticker_symbol": "class_ticker",
    # address block
    "address_1": "address_1",
    "street1": "address_1",
    "address_2": "address_2",
    "street2": "address_2",
    "city": "city",
    "state": "state",
    "state_code": "state",
    "zip_code": "zip_code",
    "zip": "zip_code",
}

CANONICAL_COLUMNS = [
    "reporting_file_number",
    "cik",
    "entity_name",
    "entity_org_type",
    "series_id",
    "series_name",
    "class_id",
    "class_name",
    "class_ticker",
    "address_1",
    "address_2",
    "city",
    "state",
    "zip_code",
]

# Columns whose most-recent non-null value becomes canonical in the class master.
CLASS_ATTRS = [
    "series_id",
    "cik",
    "entity_name",
    "series_name",
    "class_name",
    "class_ticker",
]


def snake(name: str) -> str:
    """Lowercase, strip BOM/whitespace/punctuation, collapse to snake_case."""
    s = unicodedata.normalize("NFKC", str(name)).replace("﻿", "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def find_header_row(path: Path) -> int:
    """Index of the header line: the first line naming a series-ID column.

    Some vintages prepend a report title (2012, 2017), a blank line (2015), or a
    row of dashes under the header (2012).
    """
    with path.open(encoding="utf-8-sig", errors="replace") as fh:
        for i, line in enumerate(fh):
            fields = {snake(f) for f in line.split(",")}
            if "series_id" in {COLUMN_ALIASES.get(f) for f in fields}:
                return i
    raise ValueError(f"no header row with a series-ID column in {path.name}")


def clean_str(s: pd.Series) -> pd.Series:
    """Strip padding, map the vintage-specific null sentinels to NA."""
    out = s.astype("string").str.strip()
    return out.mask(out.str.upper().isin(NULL_SENTINELS))


def read_year(path: Path, year: int) -> pd.DataFrame:
    """Read one annual CSV into the canonical schema, adding `file_year`."""
    skiprows = find_header_row(path)
    df = pd.read_csv(
        path,
        skiprows=skiprows,
        dtype=str,
        keep_default_na=False,
        encoding="utf-8-sig",
        encoding_errors="replace",
        engine="python",
    )
    raw_cols = list(df.columns)
    df.columns = [COLUMN_ALIASES.get(snake(c), snake(c)) for c in raw_cols]

    # 2014 carries two unnamed trailing columns; drop anything not in the schema.
    df = df.loc[:, [c for c in df.columns if c in CANONICAL_COLUMNS]]
    df = df.loc[:, ~df.columns.duplicated()]
    for col in CANONICAL_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA
    df = df[CANONICAL_COLUMNS]

    for col in CANONICAL_COLUMNS:
        df[col] = clean_str(df[col])

    # 2012 puts a row of dashes under the header; drop it and any id-less rows.
    df = df[df["series_id"].notna() & df["class_id"].notna()]
    df = df[df["series_id"].str.startswith("S", na=False)]
    df = df[df["class_id"].str.startswith("C", na=False)]

    df["cik"] = df["cik"].str.zfill(CIK_WIDTH)
    df["class_ticker"] = df["class_ticker"].str.upper()
    df["file_year"] = year
    return df.reset_index(drop=True)


def most_recent(df: pd.DataFrame, keys: list[str], cols: list[str]) -> pd.DataFrame:
    """Per key, the last non-null value of each col in `file_year` order."""
    ordered = df.sort_values([*keys, "file_year"], kind="mergesort")
    return ordered.groupby(keys, as_index=False, sort=True)[cols].last()


def build_class_master(long: pd.DataFrame) -> pd.DataFrame:
    canon = most_recent(long, ["class_id"], CLASS_ATTRS)
    span = long.groupby("class_id", as_index=False, sort=True).agg(
        year_first_seen=("file_year", "min"),
        year_last_seen=("file_year", "max"),
        n_years=("file_year", "nunique"),
    )
    master = canon.merge(span, on="class_id", validate="one_to_one")
    cols = [
        "class_id",
        "series_id",
        "cik",
        "entity_name",
        "series_name",
        "class_name",
        "class_ticker",
        "year_first_seen",
        "year_last_seen",
        "n_years",
    ]
    return master[cols].sort_values("class_id").reset_index(drop=True)


def build_names_long(long: pd.DataFrame) -> pd.DataFrame:
    """Contemporaneous fund identity, one row per (class_id, file_year).

    Pre-2023 ISS N-PX carries no series ID, so a 2012 `fundname` must be matched
    against the fund's 2012-vintage name — not its current one.

    CLASS grain, not series grain: ISS `fundname` values routinely name the share
    class ("Vanguard 500 Index Fund Admiral Shares"), so the bridge needs the
    contemporaneous `class_name` and `class_id` alongside the series fields.
    Series-level matching is unaffected — the distinct
    (series_id, series_name, class_ticker, file_year) tuples are the projection
    of this table.
    """
    cols = [
        "series_id", "series_name", "class_id", "class_name",
        "class_ticker", "cik", "entity_name", "file_year",
    ]
    return (
        long[cols]
        .drop_duplicates()
        .sort_values(["series_id", "class_id", "file_year"], na_position="last")
        .reset_index(drop=True)
    )


def build_name_variants(long: pd.DataFrame,
                        header_names: pd.DataFrame | None = None) -> pd.DataFrame:
    """Long-form match vocabulary: one row per (series_id, name, name_source, file_year).

    The fuzzy tier matches an ISS `fundname` against series names, and two
    measured defects live in the vocabulary rather than in the matcher:

    `sec_entity_series` -- the SEC report frequently carries a BARE strategy
        name (S000000042 is 'Equity Income Portfolio'), which dozens of families
        share and no matcher can resolve. The registrant sits in the same row,
        so the qualified variant is free. It is a separate ROW, not a
        replacement: ISS sometimes carries the bare name too.

    `header` -- names observed in 40-Act SGML headers. ISS holds the name a fund
        carried WHEN IT VOTED, and a rename (Dreyfus -> BNY Mellon) or
        sub-adviser branding (a Northwestern Mutual portfolio sold as 'T. Rowe
        Price Equity Income Portfolio') is recoverable from no current field.
        Measured 2026-08-28 over the untagged fundids: +4,580 name strings for
        series the SEC report already has, coverage 72.9% -> 75.5% of vote rows,
        and the UNAMBIGUOUS count rose 13,249 -> 14,195 -- more matches without
        more collisions. Optional: absent a header scan the vocabulary still
        builds, one source lighter.

    Every row keeps `file_year` so a match can prefer the name that was current
    in the year the fund actually voted.
    """
    frames = []

    base = long[["series_id", "series_name", "file_year"]].copy()
    base = base.rename(columns={"series_name": "name"})
    base["name_source"] = "sec_series"
    frames.append(base)

    if "entity_name" in long.columns:
        qual = long[["series_id", "entity_name", "series_name", "file_year"]].copy()
        qual = qual[qual["entity_name"].notna() & qual["series_name"].notna()]
        qual["name"] = (qual["entity_name"].astype(str).str.strip() + " "
                        + qual["series_name"].astype(str).str.strip())
        qual["name_source"] = "sec_entity_series"
        frames.append(qual[["series_id", "name", "file_year", "name_source"]])

    if header_names is not None and len(header_names):
        hdr = header_names[["series_id", "series_name", "file_year"]].copy()
        hdr = hdr.rename(columns={"series_name": "name"})
        hdr["name_source"] = "header"
        frames.append(hdr)

    out = pd.concat(frames, ignore_index=True)
    out["name"] = (out["name"].astype(str)
                   .str.replace(r"\s+", " ", regex=True).str.strip())
    out = out[out["name"].ne("") & out["name"].ne("nan")]
    return (
        out[["series_id", "name", "name_source", "file_year"]]
        .drop_duplicates()
        .sort_values(["series_id", "name_source", "file_year", "name"],
                     na_position="last")
        .reset_index(drop=True)
    )


def build_series_master(long: pd.DataFrame, class_master: pd.DataFrame) -> pd.DataFrame:
    canon = most_recent(long, ["series_id"], ["cik", "entity_name", "series_name"])
    span = long.groupby("series_id", as_index=False, sort=True).agg(
        year_first_seen=("file_year", "min"),
        year_last_seen=("file_year", "max"),
        n_years=("file_year", "nunique"),
    )
    n_classes = (
        class_master.groupby("series_id", as_index=False, sort=True)["class_id"]
        .nunique()
        .rename(columns={"class_id": "n_classes"})
    )
    tickers = (
        class_master.loc[class_master["class_ticker"].notna(), ["series_id", "class_ticker"]]
        .drop_duplicates()
        .sort_values(["series_id", "class_ticker"])
        .groupby("series_id", as_index=False, sort=True)["class_ticker"]
        .agg(lambda s: sorted(s.tolist()))
        .rename(columns={"class_ticker": "tickers"})
    )
    out = (
        canon.merge(span, on="series_id", validate="one_to_one")
        .merge(n_classes, on="series_id", how="left", validate="one_to_one")
        .merge(tickers, on="series_id", how="left", validate="one_to_one")
    )
    # Series whose every class is ticker-less (variable-annuity portfolios,
    # institutional-only share classes) merge to NA; give them an empty list.
    out["tickers"] = out["tickers"].apply(lambda v: [] if v is None or v is pd.NA else list(v))
    cols = [
        "series_id",
        "cik",
        "entity_name",
        "series_name",
        "n_classes",
        "tickers",
        "year_first_seen",
        "year_last_seen",
        "n_years",
    ]
    return out[cols].sort_values("series_id").reset_index(drop=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    paths = sorted(RAW.glob(RAW_GLOB))
    years = [int(YEAR_RE.search(p.name).group(1)) for p in paths]
    expected = set(range(min(years), max(years) + 1))
    missing = sorted(expected - set(years))

    print("=" * 78)
    print("L2a — SEC Series/Class master consolidation")
    print("=" * 78)
    print(f"Files found: {len(paths)}  years {min(years)}-{max(years)}")
    print(f"Missing year(s) in span: {missing if missing else 'none'}")

    print("\n--- Per-year schema profile ---")
    frames = []
    for path, year in zip(paths, years):
        hdr = find_header_row(path)
        with path.open(encoding="utf-8-sig", errors="replace") as fh:
            for _ in range(hdr):
                fh.readline()
            raw_header = fh.readline().rstrip("\n")
        df = read_year(path, year)
        frames.append(df)
        unknown = sorted(
            {snake(c) for c in raw_header.split(",")}
            - set(COLUMN_ALIASES)
            - {""}
        )
        quirks = []
        if hdr:
            quirks.append(f"header on line {hdr + 1}")
        if unknown:
            quirks.append(f"unmapped: {unknown}")
        print(
            f"  {year}: rows={len(df):>6,}  "
            f"cols={len(raw_header.split(','))}  "
            f"{'; '.join(quirks) if quirks else 'standard header, line 1'}"
        )
        print(f"        header: {raw_header[:150]}")

    long = pd.concat(frames, ignore_index=True)

    print("\n--- Sample of the stacked long table (first year) ---")
    print(frames[0].head(3).to_string())
    print("\nDtypes:")
    print(long.dtypes.to_string())

    class_master = build_class_master(long)
    names_long = build_names_long(long)
    series_master = build_series_master(long, class_master)

    class_master.to_parquet(MASTER_CLASS_PATH, index=False)
    names_long.to_parquet(NAMES_LONG_PATH, index=False)
    series_master.to_parquet(MASTER_SERIES_PATH, index=False)

    # ---------------- verification ----------------
    n_years_files = len(paths)
    print("\n" + "=" * 78)
    print("VERIFICATION")
    print("=" * 78)
    print(f"stacked long rows (class x year) : {len(long):,}")
    print(f"class master rows (1/class_id)   : {len(class_master):,}")
    print(f"series master rows (1/series_id) : {len(series_master):,}")
    print(f"names-long rows (class x year)   : {len(names_long):,}")
    # The series-level view callers had before the grain widened, so a
    # series-only matcher can confirm nothing was lost or duplicated.
    series_proj = names_long[
        ["series_id", "series_name", "class_ticker", "file_year"]
    ].drop_duplicates()
    print(f"  series-level projection        : {len(series_proj):,}")
    print(f"distinct class_id                : {long['class_id'].nunique():,}")
    print(f"distinct series_id               : {long['series_id'].nunique():,}")
    print(f"distinct cik                     : {long['cik'].nunique():,}")

    all_years = int((series_master["n_years"] == n_years_files).sum())
    print(
        f"\nseries in ALL {n_years_files} files          : {all_years:,} "
        f"({all_years / len(series_master):.1%})"
    )
    print(f"series in exactly 1 file         : {int((series_master['n_years'] == 1).sum()):,}")
    print("series n_years distribution:")
    print(series_master["n_years"].value_counts().sort_index().to_string())

    tick = class_master["class_ticker"].notna().mean()
    print(f"\nclasses with non-null ticker     : {tick:.1%}")
    n_tick = series_master["tickers"].apply(len)
    print(f"series with >=1 ticker           : {n_tick.gt(0).mean():.1%}")
    print(f"mean tickers per series          : {n_tick.mean():.2f}")

    # Name history: the reason `sec_series_names_long` exists.
    per_series_names = names_long.groupby("series_id")["series_name"].nunique()
    changed = int((per_series_names > 1).sum())
    print(
        f"\nseries with >1 distinct name     : {changed:,} "
        f"({changed / len(per_series_names):.1%}) "
        "-> contemporaneous-name matching is required for pre-2023 ISS names"
    )
    print(f"max distinct names for a series  : {int(per_series_names.max())}")
    per_class_tickers = (
        long.loc[long["class_ticker"].notna()].groupby("class_id")["class_ticker"].nunique()
    )
    reticker = int((per_class_tickers > 1).sum())
    print(
        f"classes with >1 distinct ticker  : {reticker:,} "
        f"({reticker / len(per_class_tickers):.1%})"
    )

    print("\n--- 10 sample rows: class master ---")
    print(class_master.head(10).to_string())
    print("\n--- 10 sample rows: series master ---")
    print(series_master.head(10).to_string())
    print("\n--- 10 sample rows: names long (the most-renamed ticker-bearing series) ---")
    with_ticker = set(names_long.loc[names_long["class_ticker"].notna(), "series_id"])
    renamed = per_series_names[per_series_names.index.isin(with_ticker)].idxmax()
    print(names_long[names_long["series_id"] == renamed].head(10).to_string())

    # A class must belong to exactly one series for the class-grain master to be a
    # valid bridge; check rather than assume, since names/CIKs do drift.
    per_class_series = long.groupby("class_id")["series_id"].nunique()
    unstable = int((per_class_series > 1).sum())
    print(f"\nclasses mapping to >1 series_id  : {unstable:,} (must be 0)")

    print("\n--- Rows per file_year ---")
    print(long.groupby("file_year").size().to_string())

    print("\n--- Spot check: large index-fund families (series master) ---")
    for pat in ("VANGUARD 500 INDEX", "SPDR S&P 500", "ISHARES CORE S&P 500"):
        hit = series_master[
            series_master["series_name"].str.upper().str.contains(pat, regex=False, na=False)
        ]
        print(f"  {pat}: {len(hit)} series")
        if len(hit):
            print(hit.head(2).to_string(index=False))

    # Assertions
    assert class_master["class_id"].is_unique, "class_id not unique in class master"
    assert series_master["series_id"].is_unique, "series_id not unique in series master"
    assert class_master["series_id"].notna().all(), "class master has null series_id"
    bad_s = class_master.loc[~class_master["series_id"].str.match(SERIES_ID_RE), "series_id"]
    bad_c = class_master.loc[~class_master["class_id"].str.match(CLASS_ID_RE), "class_id"]
    assert bad_s.empty, f"series_id format violations: {bad_s.head().tolist()}"
    assert bad_c.empty, f"class_id format violations: {bad_c.head().tolist()}"
    bad_ns = names_long.loc[~names_long["series_id"].str.match(SERIES_ID_RE), "series_id"]
    assert bad_ns.empty, f"names_long series_id violations: {bad_ns.head().tolist()}"
    assert set(series_master["series_id"]) == set(class_master["series_id"]), (
        "series/class master series_id sets disagree"
    )
    assert unstable == 0, f"{unstable} class_ids map to more than one series_id"
    print("\nAll assertions passed.")

    print("\n--- Outputs ---")
    for path, df in (
        (MASTER_CLASS_PATH, class_master),
        (NAMES_LONG_PATH, names_long),
        (MASTER_SERIES_PATH, series_master),
    ):
        print(f"{path}  ({len(df):,} rows x {df.shape[1]} cols)")
        print("  " + ", ".join(f"{c}:{t}" for c, t in df.dtypes.items()))


if __name__ == "__main__":
    main()
