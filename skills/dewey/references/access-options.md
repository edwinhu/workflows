# Dewey Download Options

Dewey delivers data as **partitioned files** (Parquet or CSV.gz), not SQL result sets. Every method below ultimately resolves a dataset's **product path / project ID** + your **API key** into a list of **presigned file URLs**, which you then sample, filter, and download.

## The six methods

| Method | Tool | When | Notes |
|--------|------|------|-------|
| **UI CSV download** | platform → project → Download | one-off, dataset **< 2.0 GB** | filter in the web UI, click download |
| **Dewey Client (recommended)** | `deweypy` | scripted bulk download, parallel | newest, fastest; CLI `speedy-download` + Python `auth`/`download` modules |
| **Legacy Python API** | `deweydatapy` | scripted, product_path-style | `get_meta`/`get_file_list`/`read_sample`/`download_files0/1` — see `deweypy-client.md` |
| **DuckDB selective pull** | `duckdb` + `httpfs` | huge datasets, need few columns/rows | query remote parquet, `COPY TO` only what you need — see `duckdb.md` |
| **R** | `deweyr` | R workflows | `download_dewey()` (uv-managed), `download_dewey_duck()` |
| **MCP server** | `api.deweydata.io/mcp` | discovery, schema, sampling from inside Claude | 9 tools — see `mcp.md` |

## Partitioning and date filtering

Most Dewey datasets are **date-partitioned** (a file per day/week/month). The two universal levers:

- **Date partition window** — `start_date`/`end_date` (deweydatapy) or `partition_key_after`/`partition_key_before` (deweypy). Always scope to your study window; "all" means every file ever published.
- **Columns** — only DuckDB lets you project columns *before* download. The file clients download whole files; you drop columns after.

Some datasets (static reference tables) have **no partition column** and ignore date parameters — `get_meta` tells you.

## Presigned link expiry (critical)

Download links are **presigned URLs valid for 24 hours**.

- `download_files0` / `get_file_list` then `download_files` — collects **all** links upfront. Fine for short jobs; a multi-day pull will hit expired links partway through.
- `download_files1` — paginates and **refreshes links as it goes**. Use this for large, long-running downloads.

## Reading data already on disk

After download you have `*.parquet` or `*.csv.gz`. Query with DuckDB (preferred), pandas, or polars:

```python
import duckdb
con = duckdb.connect()
# Parquet
df = con.execute("SELECT * FROM read_parquet('DIR/*.parquet')").df()
# CSV.gz
df = con.execute("SELECT * FROM read_csv_auto('DIR/*.csv.gz')").df()
```

For big local sets, prefer DuckDB SQL (or polars `scan_parquet` lazy frames) over loading everything into pandas. Quick diagnostics after load:

```python
print(df.shape); print(df.isna().sum()); print(df.nunique())
```

## Recommended flow (maps to the SKILL Iron Law)

1. **Discover** the product path — MCP `search_datasets`, or the dataset's *Connect to API* URL.
2. **Meta** — `get_meta` / MCP `get_download_info`: partition column, date range, file count, size.
3. **Sample** — `read_sample(nrows=100)` / MCP `sample_dataset`: confirm columns and values.
4. **Filter** — date window + columns; DuckDB `COPY TO` for selective pulls.
5. **Download** the subset; verify on disk.
