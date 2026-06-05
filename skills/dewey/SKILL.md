---
name: dewey
version: 1.0
description: Use when "query Dewey Data", "deweydata.io", "SafeGraph places/patterns/spend", "Advan foot traffic", "POI / points of interest", "mobility data", "dataplor", "Veraset", "PassBy", "crypto/Bitcoin ATM locations", or any pull from the Dewey Data academic marketplace (UVA/NYU Platform Subscription) via the deweypy/deweydatapy client, DuckDB, or the Dewey MCP server.
user-invocable: false
---

## Contents

- [What Dewey Is](#what-dewey-is)
- [Credential Enforcement](#credential-enforcement)
- [Download Enforcement](#download-enforcement)
- [Access Method Decision Table](#access-method-decision-table)
- [Authentication](#authentication)
- [Quick Reference: Featured Datasets](#quick-reference-featured-datasets)
- [SafeGraph Global Places Quick Reference](#safegraph-global-places-quick-reference)
- [Additional Resources](#additional-resources)

## What Dewey Is

[Dewey Data](https://www.deweydata.io) is an academic **data marketplace** — one institutional Platform Subscription unlocks a catalog of ~300 datasets from ~40 providers (foot traffic, POI, mobility, consumer transactions, real estate, labor). **UVA Library** and **NYU** both hold the institutional subscription; SafeGraph and most providers are free under it.

Dewey is **not** a SQL warehouse like WRDS. Data is delivered as **partitioned Parquet/CSV.gz files** downloaded via an API key. You discover datasets, read metadata, sample, filter (by date partition + columns), then download. Think "S3 of presigned Parquet links," not "PostgreSQL."

| | WRDS | Dewey |
|---|---|---|
| Data | Finance/accounting | POI, foot traffic, mobility, consumer, real estate |
| Access | PostgreSQL / SAS on the grid | File download (Parquet/CSV.gz) via API key |
| Query engine | server-side SQL | **DuckDB over the files** (local or remote presigned URLs) |
| Licensing | per-vendor, negotiated | one platform subscription unlocks the catalog |
| AI access | none | **MCP server** (`api.deweydata.io/mcp`) |

## Credential Enforcement

### IRON LAW: NEVER GUESS, INVENT, OR HARDCODE THE API KEY

<EXTREMELY-IMPORTANT>
The Dewey API key belongs to the **user's** account (`app.deweydata.io` → Connections → Add Connection → API Key). It is shown **once**. You do not have it and cannot derive it.

- **ALWAYS** ask the user for the key before any real data pull. No exceptions.
- **NEVER** write a placeholder like `apikey = "your_api_key"` and run it — it will 401 and waste a round trip. Read from `DEWEY_API_KEY` env var or a gitignored file (`~/.config/dewey/apikey`).
- **NEVER** commit the key, echo it back, or paste it into a script that gets committed.

**Guessing or hardcoding the key is NOT HELPFUL — every call 401s, and a committed key is a security incident the user must rotate.**
</EXTREMELY-IMPORTANT>

Each **product** (dataset) has its own **product path / project ID** (`prj_…`), obtained from the dataset page: **Get Data → (Skip filtering) → Connect to API / Bulk API → API URL**. One API key, many product paths. If you don't have the product path, discover it via the [MCP server](references/mcp.md) (`search_datasets`) rather than guessing.

## Download Enforcement

### IRON LAW: NO BULK DOWNLOAD WITHOUT METADATA + SAMPLE + FILTER FIRST

Before downloading ANY Dewey dataset, you MUST:
1. **IDENTIFY** the product path and what partitions/columns you actually need
2. **META** — call `get_meta` (deweydatapy) / `get_download_info` (MCP) to learn partition columns, date range, file count, total size
3. **SAMPLE** — pull 100 rows (`read_sample` / MCP `sample_dataset`) and INSPECT the schema before committing to a full pull
4. **FILTER** — restrict by date partition (`partition_key_after/before`) AND columns; for selective pulls use **DuckDB `COPY TO`** over the presigned URLs, never download the whole catalog
5. **DOWNLOAD** the filtered subset, then verify row counts / NULLs / date range on disk

This is not negotiable. Skipping the sample-and-filter step is NOT HELPFUL — Dewey datasets are routinely **hundreds of GB to multiple TB**; an unfiltered pull burns hours of bandwidth and disk for data you'll immediately throw away.

### Rationalization Table — STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll just download everything and filter in pandas" | SafeGraph Patterns is multi-TB; you'll fill the disk | DuckDB `COPY TO` with WHERE on remote parquet — pull only the rows/cols you need |
| "I don't need to check the schema first" | Column names differ by provider/release (`naics_code` vs `NAICS_CODE`, `opened_on` may not exist) | `read_sample(nrows=100)` BEFORE the full pull |
| "No date filter needed, I want all of it" | Most datasets are date-partitioned; "all" = every weekly file ever | Set `partition_key_after/before` to your study window |
| "The download started, so it's correct" | A started download ≠ the right columns | Inspect a sample on disk before claiming success |
| "Presigned links are fine for a long job" | Links expire in **24h** (`download_files0`) | Use `download_files1` (page-by-page, refreshes links) for large multi-day pulls |
| "I'll hardcode the product path I think it is" | Wrong `prj_` → 404 or someone else's data | Get it from Connect to API, or MCP `search_datasets` |

### Red Flags — STOP Immediately If You're About To:

- **Call `download_files*` without first calling `get_meta` + `read_sample`** → STOP. Meta + sample first.
- **Download a dataset with no `start_date`/`end_date` / partition filter** → STOP. Scope the date range.
- **Load a whole remote dataset into a DataFrame** → STOP. Use DuckDB `COPY TO … (FORMAT PARQUET, PARTITION_BY …)` to persist a filtered subset to disk.
- **Run a pull with `apikey="your_api_key"` or any guessed key** → STOP. Ask the user; read from env/file.
- **Write the API key into a script you'll commit** → STOP. Env var or gitignored file only.

## Access Method Decision Table

| Need | Method | Reference |
|------|--------|-----------|
| Discover/search datasets, check schema, sample — from inside Claude | **MCP server** (`api.deweydata.io/mcp`) | `references/mcp.md` |
| Scripted Python bulk download | **deweypy** (recommended) or **deweydatapy** (legacy, product_path API) | `references/deweypy-client.md` |
| Selective pull — specific columns/rows from huge datasets | **DuckDB** over presigned URLs (`read_parquet($urls)` + `COPY TO`) | `references/duckdb.md` |
| R workflow | **deweyr** (`download_dewey()`) | `references/deweypy-client.md` |
| One-off, dataset < 2.0 GB | UI CSV download (platform → project) | `references/access-options.md` |
| Analyze data already on disk | DuckDB / pandas / polars over `*.parquet` or `*.csv.gz` | `references/access-options.md` |

## Authentication

Get the key once from `app.deweydata.io` → **Connections → Add Connection → API Key**. Store it out of source control:

```bash
mkdir -p ~/.config/dewey && echo 'YOUR_KEY' > ~/.config/dewey/apikey && chmod 600 ~/.config/dewey/apikey
# or: export DEWEY_API_KEY=...   (add to .envrc, which should be gitignored)
```

```python
import os, pathlib
apikey = os.environ.get("DEWEY_API_KEY") or pathlib.Path("~/.config/dewey/apikey").expanduser().read_text().strip()
```

Institutional login (to browse the catalog / create the key) is via **UVA NetBadge** (use your UVA email) or NYU SSO. The Platform Subscription is what makes SafeGraph etc. free — see `references/datasets.md`.

## Quick Reference: Featured Datasets

| Provider | Dataset(s) | What it is |
|----------|------------|------------|
| **SafeGraph** | Global Places (POI), Geometry, Spend, **Patterns** | POI master, building footprints, card spend, foot-traffic visit patterns |
| **Advan Research** | Monthly/Weekly Patterns, Home Panel | Foot traffic aggregated to place & census-block |
| **dataplor** | POI | Global POI, strong emerging-markets coverage |
| **Veraset** | Movement | Device-level mobility (institutional license only) |
| **PassBy** | Foot Traffic | Per-POI foot-traffic analytics |
| Consumer Edge / PDI | Spend / transactions | Card & product-level purchasing |
| LinkUp | Job postings | Labor-market activity |
| ATTOM / Dwellsy / RentHub | Real estate | Property records, rentals |

**Full catalog (all ~250 datasets):** `references/catalog.md` — every dataset grouped by category with time coverage, row count, size, and download access (machine-readable: `references/catalog.csv`). Featured-dataset detail + discovery workflow: `references/datasets.md`.

## SafeGraph Global Places Quick Reference

Core POI schema — **columns are UPPERCASE**, `NAICS_CODE` is a **string**, `BRANDS` is a **JSON-array string** (extract with `json_extract_string(BRANDS,'$[0].safegraph_brand_name')`). Always sample before filtering.

| Column | Meaning |
|--------|---------|
| `PLACEKEY` | Stable unique POI id (join key across SafeGraph products) |
| `LOCATION_NAME` | POI name |
| `BRANDS` | JSON array: `[{"safegraph_brand_name":"…"}]` — **not** plain text |
| `STREET_ADDRESS`,`CITY`,`REGION`,`POSTAL_CODE`,`ISO_COUNTRY_CODE` | Address (`REGION`=US state) |
| `LATITUDE`,`LONGITUDE` | Coordinates |
| `NAICS_CODE`,`NAICS_CODE_2022` | 6-digit NAICS (string) |
| `TOP_CATEGORY`,`SUB_CATEGORY` | Category labels |
| `OPENED_ON`,`CLOSED_ON`,`TRACKING_CLOSED_SINCE` | Open/close dates **(exist but sparsely populated — NULL for BTMs)** |

**Resolved empirically:** crypto/Bitcoin ATMs **do** exist as standalone POIs under `NAICS_CODE='522320'`; all major operators are present. But `OPENED_ON`/`CLOSED_ON` are **NULL for BTMs** in the current release → it's a cross-section, not a time series. Full details, the 7 BTM operators, and the worked example: `references/safegraph-places.md` and `examples/btm_safegraph_pull.py`.

## Additional Resources

### Reference Files

- **`references/access-options.md`** — all download methods (UI, deweypy, deweydatapy, DuckDB, MCP, R), 24h link expiry, partitioning, reading data on disk
- **`references/deweypy-client.md`** — `deweypy` (modern CLI + `auth`/`download`) and `deweydatapy` (`get_meta`, `get_file_list`, `read_sample`, `download_files0/1`) function reference; `deweyr` for R
- **`references/duckdb.md`** — selective remote-Parquet pulls, `COPY TO … PARTITION_BY` pattern, querying downloaded files
- **`references/mcp.md`** — Dewey MCP server URL, JSON config, the 9 tools, discovery → schema → sample workflow
- **`references/datasets.md`** — featured-dataset catalog, UVA NetBadge / NYU institutional access, discovery workflow
- **`references/catalog.md`** + **`catalog.csv`** — full enumerated catalog (~250 datasets / 39 partners) by category, with coverage / rows / size / access
- **`references/safegraph-places.md`** — Global Places schema, NAICS 522320, BTM operator brands, opened_on/closed_on, the Bitcoin-ATM worked example

### Example Files

- **`examples/btm_safegraph_pull.py`** — acceptance test: filter SafeGraph Global Places to the 7 BTM operator brands + NAICS 522320, verify standalone-POI / open-close coverage, export the US subset to `~/projects/batm/`
