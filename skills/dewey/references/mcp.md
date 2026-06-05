# Dewey MCP Server

Dewey ships an MCP server so you can **discover datasets, read schemas, and sample data from inside Claude** — without writing client code. Use it for the *discovery → schema → sample* phase; use `deweypy`/DuckDB for the actual bulk pull.

## Server

**URL:** `https://api.deweydata.io/mcp`
**Auth:** HTTP header `X-API-KEY: <YOUR_API_KEY>` (note: header, not env var, for this integration).

## Config (Claude / Cursor)

```json
"mcpServers": {
  "dewey-prod": {
    "type": "http",
    "url": "https://api.deweydata.io/mcp",
    "headers": {
      "X-API-KEY": "{YOUR_API_KEY_HERE}"
    }
  }
}
```

In Claude Code, add it with the key kept out of the committed config (use an env-substituted value or your local settings):

```bash
claude mcp add --transport http dewey-prod https://api.deweydata.io/mcp \
  --header "X-API-KEY: $DEWEY_API_KEY"
```

> The key is the user's. Don't paste it into a file that gets committed.

## The 9 tools

**Search & discovery**
| Tool | Purpose |
|------|---------|
| `search_datasets` | Keyword/trigram search with filters |
| `semantically_search_datasets` | Vector/concept search |
| `list_categories` | Dataset categories |
| `list_data_partners` | Providers and their containers |

**Dataset details**
| Tool | Purpose |
|------|---------|
| `get_dataset_details` | Full metadata by slug |
| `get_dataset_schema` | Column names, types, descriptions |
| `get_related_datasets` | Supplementary / joinable datasets |

**Access & sampling**
| Tool | Purpose |
|------|---------|
| `get_download_info` | Permissions, size, format — the "meta" step |
| `sample_dataset` | Up to **2,000 rows** (JSON/CSV) |

## Discovery workflow

1. `search_datasets("SafeGraph places")` or `semantically_search_datasets(...)` → find the dataset slug.
2. `get_dataset_schema(slug)` → confirm columns (e.g. does `opened_on`/`closed_on` exist? is it `naics_code` or `NAICS_CODE`?).
3. `sample_dataset(slug, n=…)` → eyeball real rows; confirm brands/NAICS appear as expected.
4. `get_download_info(slug)` → size, format, your access permission, and the product path for the bulk pull.
5. Hand the product path to `deweypy`/DuckDB for the filtered download.

## Example prompts
- "Search Dewey for consumer transaction datasets covering 2023–2024."
- "What columns are in the SafeGraph Global Places dataset?"
- "Sample 10 rows of SafeGraph Places where brand = 'Bitcoin Depot'."
- "Find datasets related to foot traffic I can join to SafeGraph Places on placekey."
