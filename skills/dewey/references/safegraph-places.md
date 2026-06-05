# SafeGraph Global Places — and the Bitcoin-ATM Worked Example

SafeGraph **Global Places** is the POI master: one row per point of interest, keyed by `PLACEKEY`, joinable to SafeGraph **Spend** (card transactions) and **Patterns** (foot-traffic visits) on the same `PLACEKEY`. Free under the UVA/NYU Platform Subscription. The release on Dewey (product `prj_xsou9usy__fldr_b7faazxwmt47zdme8`) is **Global Places + Geometry** — it includes building footprints (`POLYGON_WKT`) — ~81M global POIs across 140 parquet shards, ~581k rows each.

## Schema (verified against the live release — columns are UPPERCASE)

| Column | Type | Meaning |
|--------|------|---------|
| `PLACEKEY` | VARCHAR | Stable unique POI id — join key across SafeGraph products |
| `PARENT_PLACEKEY` | VARCHAR | Parent POI (e.g. a kiosk inside a host store) |
| `LOCATION_NAME` | VARCHAR | POI name (e.g. "Bitcoin Depot Bitcoin ATM") |
| `BRANDS` | VARCHAR | **JSON-array string**: `[{"safegraph_brand_id":"…","safegraph_brand_name":"…"}]`. **Exact `=` match fails** — extract with `json_extract_string(BRANDS,'$[0].safegraph_brand_name')` |
| `STORE_ID` | VARCHAR | Operator's internal store id, when provided |
| `STREET_ADDRESS`,`CITY`,`REGION`,`POSTAL_CODE`,`ISO_COUNTRY_CODE` | VARCHAR | Address (`REGION` = 2-letter US state; filter `ISO_COUNTRY_CODE='US'`) |
| `LATITUDE`,`LONGITUDE` | DOUBLE | Coordinates |
| `NAICS_CODE`, `NAICS_CODE_2022` | **VARCHAR** | 6-digit NAICS (string, not int → `NAICS_CODE='522320'`) |
| `TOP_CATEGORY`,`SUB_CATEGORY` (+ `_2022`) | VARCHAR | Category labels |
| `OPENED_ON`,`CLOSED_ON`,`TRACKING_CLOSED_SINCE` | DATE | Open/close dates **— exist but are NULL for BTM rows in this release (see below)** |
| `POLYGON_WKT`,`GEOMETRY_TYPE`,`WKT_AREA_SQ_METERS`,`ENCLOSED` | — | Geometry/footprint fields |
| `PHONE_NUMBER`,`WEBSITE`,`DOMAINS`,`OPEN_HOURS`,`CATEGORY_TAGS` | VARCHAR | Misc enrichment |

> Columns are UPPERCASE and `NAICS_CODE` is a **string**. `BRANDS` is JSON, not plain text. **Always sample and print columns before writing filters** — case, types, and population vary by release.

## The Bitcoin-ATM (BTM) question — RESOLVED

**Goal (for `~/projects/batm/`):** a historical **operator × state × month** panel of BTM locations with **open/close dates** — to power a Bitcoin Depot bankruptcy event study. The project already has a *single* CoinATMRadar snapshot (20,355 US ATMs, Jun 2026) but **no time series**.

### Findings (verified against the live release)
1. **YES — crypto ATMs exist as standalone POIs.** Filed under **`NAICS_CODE='522320'`** (SafeGraph labels it *"Activities Related to Credit Intermediation"*, `TOP_CATEGORY`). Each operator's machines are individual POIs with their own `PLACEKEY`, address, lat/long, and state.
2. **All 7 target operators are present**, as these `safegraph_brand_name` values:
   `Bitcoin Depot Bitcoin ATM`, `CoinFlip Bitcoin ATM`, `Athena Bitcoin`, `RockitCoin Bitcoin ATM`, `Bitstop Bitcoin ATM`, `Coinhub ATM`, `Byte Federal Bitcoin ATM`.
   Plus ~20 more BTM brands: `LibertyX Bitcoin ATM`, `Coinme`, `Crypto Dispensers`, `CoinCloud Bitcoin ATM`, `Bitcoin of America`, `Coinsource Bitcoin ATM`, `DigitalMint Bitcoin ATM`, `Cash2Bitcoin`, `National Bitcoin ATM`, `Margo Bitcoin ATM`, etc. (NAICS 522320 also sweeps in `ecoATM`, `Ria Money Transfer`, `Coinstar` — filter these out by brand if you want pure BTM.)
3. **⚠️ `OPENED_ON`/`CLOSED_ON`/`TRACKING_CLOSED_SINCE` are NULL for BTM rows** in this release. The columns exist but aren't populated for this category → **this single release is a cross-sectional snapshot, NOT a time series.** It cannot, by itself, yield the open/close panel. See "Building the panel" for the fallback.
4. **Bitcoin Depot is still listed** in this SafeGraph release (thousands of "Bitcoin Depot Bitcoin ATM" POIs) — consistent with its historical fleet — while the Jun 2026 CoinATMRadar scrape shows ~0 live. The two sources **bracket the bankruptcy** in time.

### Operator brands — match via JSON-extracted brand name (fuzzy, lowercased)
SafeGraph names differ from CoinATMRadar (they append "Bitcoin ATM"). Match on
`json_extract_string(BRANDS,'$[0].safegraph_brand_name')` and/or `LOCATION_NAME` with a regex like
`bitcoin|crypto|coinflip|rockit|bitstop|coinhub|byte federal|athena|coinme|libertyx|digitalmint|coinsource`,
then map to the canonical 7 operators downstream.

### NAICS
`NAICS_CODE='522320'` (string) — the BTM/credit-intermediation code SafeGraph uses. Cast a wide net (NAICS OR brand-name regex OR `LOCATION_NAME` regex), then classify operator from the extracted brand name.

## Pull strategy (follows the SKILL Iron Law)

1. **Discover** the product path — here `prj_xsou9usy__fldr_b7faazxwmt47zdme8` (SafeGraph Global Places + Geometry).
2. **Meta** — `get_dataset_files(pid, to_list=True)` → 140 parquet shards, no date partition (single release).
3. **Sample** — `DESCRIBE` the first shard for the schema; query a handful of shards for BTM rows (confirmed above).
4. **Filter + pull** — DuckDB `COPY TO` over the 140 remote shards: `WHERE ISO_COUNTRY_CODE='US' AND (NAICS_CODE='522320' OR brand/name regex)`, projecting needed columns, `PARTITION_BY (REGION)`.
5. **Export** the US subset to `~/projects/batm/safegraph_btm/` and build the operator × state cross-section.

The runnable version is `examples/btm_safegraph_pull.py`.

## Building the panel for the event study

Because `OPENED_ON`/`CLOSED_ON` are **NULL for BTMs in this release**, this snapshot yields a **cross-section**, not a time series:
- **operator** = canonical brand from `json_extract_string(BRANDS,'$[0].safegraph_brand_name')` (map variants → 7 targets + "other").
- **state** = `REGION` (US 2-letter).
- Aggregate to **operator × state counts** → a current map of the BTM fleet by operator.

To get the **time series** the event study needs, do NOT fabricate dates from the null columns. Instead:
- **Stack dated SafeGraph Places vintages** — Dewey typically offers monthly Places releases; pulling several vintages and stacking them gives an operator×state×month panel (a POI present in month *t* but gone in *t+1* ⇒ closure). Check the Dewey catalog / MCP `get_related_datasets` for dated Places products.
- **Or** combine this SafeGraph cross-section (pre-collapse fleet, incl. Bitcoin Depot) with the project's Jun 2026 CoinATMRadar snapshot (post-collapse, Depot ~0) as **two bracketing time points**.
- Cross-check operator counts against CoinATMRadar (CoinFlip ~4,105, Athena ~3,380, Bitstop ~2,584, RockItCoin ~2,313, Coinhub ~1,921, Byte Federal ~1,259 as of Jun 2026).

State this limitation explicitly in any analysis rather than treating the snapshot as panel data.
