#!/usr/bin/env python3
"""
Acceptance test for the `dewey` skill: pull the US Bitcoin-ATM (BTM) subset of
SafeGraph Global Places and export it for the batm bankruptcy event study.

Follows the SKILL Iron Law: META -> SAMPLE -> FILTER -> DOWNLOAD.
Nothing is hardcoded that shouldn't be:
  - API key  : read from $DEWEY_API_KEY or ~/.config/dewey/apikey  (NEVER committed)
  - Product  : $DEWEY_SAFEGRAPH_PLACES_ID  (SafeGraph Global Places + Geometry;
               the working value is prj_xsou9usy__fldr_b7faazxwmt47zdme8 — get yours
               from the dataset's "Get Data -> Connect to API -> API URL", or via
               the Dewey MCP `search_datasets`)

Verified facts about this release (June 2026):
  - 140 parquet shards, ~581k rows each, ~81M global POIs, NO date partition.
  - Columns are UPPERCASE. NAICS_CODE is a VARCHAR ('522320', not int).
  - BRANDS is a JSON-array string: [{"safegraph_brand_id":..,"safegraph_brand_name":..}]
    -> exact '=' match fails; extract with json_extract_string.
  - BTMs ARE standalone POIs under NAICS_CODE='522320'. All 7 target operators present.
  - OPENED_ON / CLOSED_ON are NULL for BTM rows -> cross-section, NOT a time series.

Usage:
    export DEWEY_API_KEY=...                       # or ~/.config/dewey/apikey
    export DEWEY_SAFEGRAPH_PLACES_ID=prj_...
    python btm_safegraph_pull.py --sample          # META + schema + BTM probe, NO bulk pull
    python btm_safegraph_pull.py --pull            # filtered US BTM pull -> ~/projects/batm/

Run via uv if deweypy/duckdb aren't in the project env:
    uvx --python 3.13 --with duckdb --with pandas --from deweypy python btm_safegraph_pull.py --sample

Dependencies: deweypy, duckdb, pandas
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys

# canonical 7 BTM operators (for the batm event study) + their SafeGraph brand names
TARGET_OPERATORS = {
    "Bitcoin Depot": "bitcoin depot",
    "CoinFlip": "coinflip",
    "Athena Bitcoin": "athena",
    "RockItCoin": "rockit",
    "Bitstop": "bitstop",
    "Coinhub": "coinhub",
    "Byte Federal": "byte federal",
}
# wide-net regex to catch BTM POIs by brand name OR location name
BTM_REGEX = ("bitcoin|crypto|coinflip|rockit|bitstop|coinhub|byte federal|"
             "athena|coinme|libertyx|digitalmint|coinsource")
BTM_NAICS = "522320"  # SafeGraph: "Activities Related to Credit Intermediation"

OUT_DIR = pathlib.Path("~/projects/batm/safegraph_btm").expanduser()


def get_api_key() -> str:
    key = os.environ.get("DEWEY_API_KEY")
    if not key:
        p = pathlib.Path("~/.config/dewey/apikey").expanduser()
        if p.exists():
            key = p.read_text().strip()
    if not key:
        sys.exit("ERROR: no Dewey API key. Set $DEWEY_API_KEY or write ~/.config/dewey/apikey. "
                 "Get one at app.deweydata.io -> Connections -> Add Connection -> API Key.")
    return key


def get_product_id() -> str:
    pid = os.environ.get("DEWEY_SAFEGRAPH_PLACES_ID")
    if not pid:
        sys.exit("ERROR: set $DEWEY_SAFEGRAPH_PLACES_ID to the SafeGraph Global Places product id "
                 "(e.g. prj_xsou9usy__fldr_b7faazxwmt47zdme8).")
    return pid


def resolve_urls(api_key: str, data_id: str):
    from deweypy.auth import set_api_key
    from deweypy.download.synchronous import get_dataset_files
    set_api_key(api_key)
    return get_dataset_files(data_id, to_list=True)


def _url_array(urls) -> str:
    # DuckDB can't bind a list param to read_parquet inside CREATE VIEW; inline it.
    return "[" + ",".join("'" + u.replace("'", "''") + "'" for u in urls) + "]"


def step_sample(api_key: str, data_id: str) -> None:
    """META + SAMPLE: schema + BTM probe on the first few shards (no bulk pull)."""
    import duckdb
    import pandas as pd
    urls = resolve_urls(api_key, data_id)
    print(f"[meta] {len(urls)} file(s) in dataset")
    if not urls:
        sys.exit("No files returned — check the product id and your subscription access.")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    cols = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{urls[0]}')").df()
    print("\n[schema]")
    print(cols[["column_name", "column_type"]].to_string(index=False))

    pd.set_option("display.max_columns", None, "display.width", 220)
    probe = _url_array(urls[:12])
    sample = con.execute(f"""
        SELECT LOCATION_NAME,
               json_extract_string(BRANDS,'$[0].safegraph_brand_name') AS brand_name,
               NAICS_CODE, TOP_CATEGORY, REGION, OPENED_ON, CLOSED_ON
        FROM read_parquet({probe})
        WHERE ISO_COUNTRY_CODE='US'
          AND ( NAICS_CODE='{BTM_NAICS}'
                OR regexp_matches(lower(LOCATION_NAME), '{BTM_REGEX}') )
        LIMIT 25
    """).df()
    print(f"\n[sample] candidate BTM rows (first 12 shards):")
    print(sample.to_string(index=False))
    print("\nNote: OPENED_ON/CLOSED_ON are NULL for BTMs in this release -> cross-section, "
          "not a time series. See references/safegraph-places.md 'Building the panel'.")


def step_pull(api_key: str, data_id: str) -> None:
    """FILTER + DOWNLOAD: US BTM subset -> parquet partitioned by state, into ~/projects/batm/."""
    import duckdb
    urls = resolve_urls(api_key, data_id)
    if not urls:
        sys.exit("No files returned — check the product id and access.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    arr = _url_array(urls)

    print(f"[pull] scanning {len(urls)} remote shard(s) -> {OUT_DIR}")
    con.execute(f"""
        COPY (
            SELECT
                PLACEKEY, PARENT_PLACEKEY, LOCATION_NAME,
                json_extract_string(BRANDS,'$[0].safegraph_brand_name') AS brand_name,
                json_extract_string(BRANDS,'$[0].safegraph_brand_id')   AS brand_id,
                STORE_ID, STREET_ADDRESS, CITY, REGION, POSTAL_CODE, ISO_COUNTRY_CODE,
                LATITUDE, LONGITUDE, NAICS_CODE, NAICS_CODE_2022,
                TOP_CATEGORY, SUB_CATEGORY, OPENED_ON, CLOSED_ON, TRACKING_CLOSED_SINCE
            FROM read_parquet({arr})
            WHERE ISO_COUNTRY_CODE='US'
              AND ( NAICS_CODE='{BTM_NAICS}' OR NAICS_CODE_2022='{BTM_NAICS}'
                    OR regexp_matches(lower(LOCATION_NAME), '{BTM_REGEX}')
                    OR regexp_matches(
                         lower(coalesce(json_extract_string(BRANDS,'$[0].safegraph_brand_name'),'')),
                         '{BTM_REGEX}') )
        )
        TO '{OUT_DIR}'
        (FORMAT PARQUET, PARTITION_BY (REGION), COMPRESSION ZSTD, OVERWRITE_OR_IGNORE 1)
    """)

    n = con.execute(f"SELECT count(*) FROM read_parquet('{OUT_DIR}/**/*.parquet')").fetchone()[0]
    by_brand = con.execute(f"""
        SELECT brand_name, count(*) n FROM read_parquet('{OUT_DIR}/**/*.parquet')
        GROUP BY brand_name ORDER BY n DESC LIMIT 25
    """).df()
    print(f"\n[done] {n:,} US BTM POIs written under {OUT_DIR}")
    print(by_brand.to_string(index=False))
    print("\nNext: classify brand_name -> canonical operator, aggregate operator x REGION "
          "(cross-section). For a time series, stack dated SafeGraph Places vintages "
          "(OPENED_ON/CLOSED_ON are null here). See references/safegraph-places.md.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sample", action="store_true", help="META + schema + BTM probe, no bulk pull")
    g.add_argument("--pull", action="store_true", help="filtered US BTM pull -> ~/projects/batm/")
    args = ap.parse_args()

    api_key = get_api_key()
    data_id = get_product_id()
    (step_sample if args.sample else step_pull)(api_key, data_id)


if __name__ == "__main__":
    main()
