# Using DuckDB with Dewey

DuckDB is the **selective-pull** path: it queries Dewey's **remote Parquet** files over presigned URLs and writes only the columns/rows you need to disk — instead of downloading hundreds of GB and filtering afterward. This is the cheapest way to work with the large datasets (SafeGraph Patterns, Advan) and the right default whenever you need a subset.

## Pattern: filter remote Parquet, write subset to disk

```python
import duckdb
from deweypy.auth import set_api_key
from deweypy.download.synchronous import get_dataset_files

set_api_key(api_key)                       # api_key from env/file — never hardcoded

# 1. Resolve presigned URLs, scoped to the date-partition window
urls = get_dataset_files(
    data_id,
    partition_key_after="2020-01-01",
    partition_key_before="2024-12-31",
    to_list=True,
)

# 2. DuckDB with HTTP support
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")

# 3. Project columns + filter rows, COPY straight to disk (do NOT .df() the whole thing).
#    NOTE: SafeGraph Places columns are UPPERCASE, NAICS_CODE is a STRING, and BRANDS
#    is a JSON-array string -> extract the brand name, don't '=' match it.
arr = "[" + ",".join("'"+u.replace("'","''")+"'" for u in urls) + "]"  # inline the list
con.execute(f"""
  COPY (
    SELECT PLACEKEY, LOCATION_NAME,
           json_extract_string(BRANDS,'$[0].safegraph_brand_name') AS brand_name,
           LATITUDE, LONGITUDE, STREET_ADDRESS, CITY, REGION, POSTAL_CODE,
           NAICS_CODE, TOP_CATEGORY, OPENED_ON, CLOSED_ON
    FROM read_parquet({arr})
    WHERE ISO_COUNTRY_CODE='US'
      AND ( NAICS_CODE='522320'
            OR regexp_matches(lower(LOCATION_NAME),'bitcoin|crypto') )
  )
  TO '/path/to/out'
  (FORMAT PARQUET, PARTITION_BY (REGION), COMPRESSION ZSTD, OVERWRITE_OR_IGNORE 1)
""")
```

> `read_parquet($urls)` with a bound list param works in a plain `SELECT`, but **fails inside `CREATE VIEW` / some `COPY` forms** ("Unexpected prepared parameter"). Safest is to **inline the URL list** into the SQL string as shown.

### Key principles
- **Always `COPY TO` disk** for the result, rather than materializing a DataFrame — it persists durably and survives the 24h link window because the read happens during the COPY.
- **Project columns** in the `SELECT` — POI/patterns tables are wide; pulling all columns defeats the purpose.
- **Push filters into the `WHERE`** — DuckDB only fetches the row groups it needs from remote Parquet.
- **Partition the output** (`PARTITION_BY`) on a column you'll filter on later (e.g. `region`/state) for fast downstream reads.

## Pattern: query files already on disk

```python
import duckdb
con = duckdb.connect()
df = con.execute("""
  SELECT * FROM read_parquet('/path/to/out/**/*.parquet')
  WHERE region = 'TX'
""").df()
```

CSV.gz instead of Parquet:
```python
con.execute("SELECT * FROM read_csv_auto('/path/to/out/*.csv.gz')")
```

## Notes
- `read_parquet($urls)` accepts the **list** of presigned URLs from `get_dataset_files(..., to_list=True)`.
- Column names and case vary by provider/release — **sample first** (`read_sample` / MCP `sample_dataset`) so your `SELECT`/`WHERE` reference real columns. `opened_on`/`closed_on` may not exist on every dataset.
- For downstream analysis, load the resulting Parquet into polars lazy frames (`pl.scan_parquet`) or DuckDB rather than eager pandas when the subset is still large.
