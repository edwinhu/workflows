# Dewey Clients: deweypy, deweydatapy, deweyr

Two Python packages exist. **`deweypy`** is the newer, recommended "Dewey Client" (CLI + module API, project-ID based, DuckDB-friendly). **`deweydatapy`** is the older GitHub API (function-based, `product_path`-style) — still widely used and well documented. Pick one per project; don't mix.

> The API key is the user's and is read from `DEWEY_API_KEY` / `~/.config/dewey/apikey` — never hardcode. See SKILL.md "Credential Enforcement".

---

## deweypy (recommended)

### Install / run
```bash
pip install deweypy            # CLI entry point is `dewey`
# or zero-install via uv (recommended — pins Python 3.13):
uvx --python 3.13 --from deweypy dewey --help
```

### CLI — quickest bulk download
The CLI command is **`dewey`** (not `python -m deweypy`). Subcommands: `download`, `speedy-download`, `speed-test`.
```bash
uvx --python 3.13 --from deweypy dewey \
    --api-key "$DEWEY_API_KEY" \
    --download-directory ~/data/safegraph \
    speedy-download prj_xsou9usy__fldr_b7faazxwmt47zdme8
```
Top-level options: `--api-key` (or set **`DEWEY_API_KEY`** env — `deweypy.auth.resolve_api_key` reads it), `--download-directory` (default `./dewey-downloads`), `--auto-create-download-directory/--no-…`, `--print-debug-info`. If `--api-key` is omitted and the env var is unset, the CLI **prompts** for the key (hidden input). `speedy-download` does parallel multi-threaded downloads; `download` is the simpler synchronous path.

### Module API (used with DuckDB)
```python
from deweypy.auth import set_api_key
from deweypy.download.synchronous import get_dataset_files

set_api_key(api_key)                      # api_key read from env/file
urls = get_dataset_files(
    data_id,                              # the project/dataset id
    partition_key_after="2020-01-01",     # date partition window
    partition_key_before="2024-12-31",
    to_list=True,                         # return a list of presigned URLs
)
```
`urls` is then handed to DuckDB `read_parquet($urls)` for selective column/row pulls — see `duckdb.md`.

`get_dataset_files` returns presigned URLs of the form
`https://downloads.deweydata.io/api/v2/downloads/<uuid>.csv.gz?secret=…` (CSV.gz for
ConsumerEdge; parquet for SafeGraph). For CSV.gz datasets, DuckDB needs the explicit
codec: `read_csv(urls, compression='gzip', union_by_name=true)`.

### Resilient filter-in-flight pull (TESTED 2026-06-10)

Dewey's download service throws **transient HTTP 500s** on individual presigned URLs, and
the URLs **expire**. A single bad file aborts a whole-batch DuckDB `COPY … read_csv([...])`.
So don't COPY hundreds of URLs in one query. Instead:

1. **Chunk** the URL list (~20 files/chunk) and COPY each chunk to its own `chunk_NNN.parquet`.
2. **Retry** each chunk a few times, **re-minting fresh URLs** each attempt (`get_dataset_files`
   again — old secrets expire/regenerate).
3. On persistent failure, fall back to **file-by-file**, skipping (and logging) the one bad file.
4. **Restartable:** skip chunks whose parquet already exists; combine at the end with
   `read_parquet('out/**/chunk_*.parquet')`.
5. Set DuckDB `SET http_timeout=120000; SET http_retries=3;`.

Filter happens in the SQL (`WHERE BRAND_NAME IN (…)`), so only the filtered subset lands on
disk — e.g. CE "Daily Spend by Brand & State" is 8.3 GB / 450M rows full, but a ~23-brand
filtered pull is tens of MB. Worked example: `~/projects/batm/scratch/dewey_pull_ce_spend.py`.

---

## deweydatapy (legacy, function API)

> ⚠️ **DEAD ENDPOINT (confirmed 2026-06-10):** `deweydatapy.get_meta` / `get_file_list` hit
> the old `app.deweydata.io/external-api/v3/...` API, which now returns non-JSON / HTTP 500
> → `JSONDecodeError: Expecting value`. **Prefer `deweypy.get_dataset_files`** (live
> `downloads.deweydata.io/api/v2` service). Only use deweydatapy if you confirm its endpoint
> is back.

### Install
```bash
pip install "deweydatapy@git+https://github.com/Dewey-Data/deweydatapy"
```

```python
import deweydatapy as ddp
apikey       = "..."            # from env/file
product_path = "..."            # dataset's Connect-to-API path
```

### Functions

| Function | Purpose |
|----------|---------|
| `get_meta(apikey, product_path, print_meta=False)` | Metadata: partition columns, available date range. **Step 1, always.** |
| `get_file_list(apikey, product_path, start_date=None, end_date=None, print_info=False)` | DataFrame of downloadable files (with `link` column) in a date window |
| `read_sample(file_link, nrows=100)` | Sample N rows from a given file link (inspect schema) |
| `read_sample0(apikey, product_path, nrows=100)` | Sample from the dataset's first file |
| `download_files(files_df, dest, filename_prefix='', skip_exists=False)` | Download files from a `get_file_list` DataFrame |
| `download_files0(apikey, product_path, dest, start_date, end_date)` | Collect all links upfront, then download. **Links valid 24h** — short jobs only |
| `download_files1(apikey, product_path, dest, start_date, end_date)` | Page-by-page, **refreshes links** — use for large multi-day pulls |
| `read_local(file_path, nrows=100)` | Read a downloaded `.csv.gz` / `.csv` |

### Canonical flow
```python
import deweydatapy as ddp

# 1. META
meta = ddp.get_meta(apikey, product_path, print_meta=True)

# 2. FILE LIST (scoped to study window)
files = ddp.get_file_list(apikey, product_path,
                          start_date="2020-01-01", end_date="2024-12-31",
                          print_info=True)

# 3. SAMPLE + INSPECT before committing
samp = ddp.read_sample(files["link"][0], nrows=100)
print(samp.columns.tolist()); print(samp.head())

# 4. DOWNLOAD the filtered subset
ddp.download_files(files, "/path/to/dest", filename_prefix="sg_places_", skip_exists=True)
```

---

## deweyr (R)

```r
# install
devtools::install_github("Dewey-Data/deweyr")

library(deweyr)
download_dewey(api_key = Sys.getenv("DEWEY_API_KEY"),
               folder_id = "prj_...",          # from Get Data > Skip filtering > Bulk API > API URL
               download_path = "~/data",
               num_workers = 16)
```

| Function | Purpose |
|----------|---------|
| `download_dewey()` | Recommended; uses **uv** to auto-manage a Python env |
| `download_dewey_py()` | Uses an existing Python install |
| `download_dewey_duck()` | DuckDB-filtered download (columns/rows before download) |

**`folder_id`** comes from the **Projects page API URL** (the `prj_…`), not the dataset landing page: *Get Data → Skip filtering → Bulk API → API URL*.
