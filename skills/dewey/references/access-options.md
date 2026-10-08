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

## Projects: the access unit (web app, measured 2026-10-08)

Bulk API access to a table requires adding it to a **project**. Each project has one API URL per table (`https://api.deweydata.io/api/v1/external/data/prj_...`); the API key is used with that URL.

**Limits on the UVA subscription:**

- 3 active projects. At 3 of 3, "New Project" is disabled everywhere: on `/projects` ("You have reached your maximum number of active projects. Update or archive existing project statuses to create a new project.") and inside the add-to-project modal.
- At most 5 datasets per project. Several tables from one dataset count as ONE: Nevada entity status shows "Total Datasets 2/5" with 3 GovFiles tables plus 4 BrightQuery tables. A full project shows "(this project has reached its dataset limit)".
- The "Personal Project" accepts only free tables.
- Project terms: "the use of this data is limited to this specific project and for academic purposes only". Pick or describe the project to match the research use.

**Add-to-project flow:**

1. Dataset page `/data/<Provider>/<dataset>?datasetSlug=<table>`: table selector, Get Sample, Get Data.
2. PRIMARY table: Get Data opens "Customize Data" (filters, columns, preview) with "Add Table to Project", which leads to "Select projects" (file type, checkboxes, Continue).
3. SUPPLEMENTARY table: Get Data opens `Get Data from "<table>"` (file type select, project checkboxes, Save).
4. After saving the app goes to `/get-data/<projectId>/<slug>?skipCustomization=true`, offering "Download File(s) (<fmt>) N files (zipped)" and "Bulk API".
5. Bulk API shows the API URL, "Issue New Key" and a deweypy one-liner: `uvx --python 3.13 --from deweypy dewey --api-key KEY speedy-download <prj_id>`. A key is displayed once and issuing a new one may revoke the old one: ask the user before rotating.

A "Data Request Form" modal that appears beside the download dialog is not a block: see `brightquery-delaware-stock-filings.md`.

**Driving the app over CDP:** chrome-devtools click-by-uid times out on these Radix modals ("did not become interactive"); `element.click()` through `evaluate_script` works. The table-selector options are not in the DOM until opened, so navigate by `datasetSlug`. Iframes of app pages are blocked. Use `evaluate_script` with `filePath` to capture an API URL without printing it.

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
