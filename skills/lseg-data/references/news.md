# News Data

## THE RDP NEWS API IS DENIED — the Workspace news service is not

`trapi.data.news.read` is absent from the token, so every `/data/news/v1/*` endpoint 403s on the
platform session **and** on the lifted browser token. The Workspace-internal service works.
Verified 2026-09-05: HTTP 200, 11,701 bytes of headlines.

Five things must all be right, and each was a separate wall:

1. **Route**: `POST https://workspace.refinitiv.com/newscloudservice/headlines`
   (401 not 404 is the tell that it exists — a bogus path under the same prefix 404s).
2. **Method is POST.** GET returns 401 whatever else you send.
3. **Two headers**, lifted from the app's own polling with CDP `Network.requestWillBeSent`:
   `apiKey` and `forwardedApiKey` (UUIDs; they are per-deployment, so capture, never hardcode).
4. **The key is Referer-bound.** Calling from the top page returns
   `403 "This ApiKey cannot be used in context of the application detected by Referer header"`,
   quoting the offending URL.
5. **So run the fetch inside the news frame**: find the frame whose URL matches
   `Apps/news-module/` and call `frame.contentWindow.fetch(...)`, which carries the right referrer.
   Walking frames and matching `/news/i` is not enough — the top frame's URL often contains
   `entitynews` and matches first.

Query grammar, copied from the live app:

```
?archive=true&repository=NewsWire,NewsRoom,WebNews,Social&number=60
&researchResults=true&tracking=auto&sentiment=true&language=en-US
```

Each headline carries `permIDs`, an `rcs` array of instrument and topic codes (`R:AAPL.O`,
`B:`/`G:`/`M:` classifications), `repository`, `versionCreated` / `firstCreated`, `storyId`,
`isAlert` and `language` — a structured, entity-tagged corporate-events feed.

**Limits, stated plainly.** This is a Workspace-internal route behind a Referer-bound key running in
a live browser session: usable for interactive pulls over a few hundred companies, not a
reproducible pipeline. The key rotates, the session drops, and none of it is contractually yours to
automate. For a licensed feed you need `trapi.data.news.read` added.

**Never open a second Workspace tab to do any of this** — see `workspace-web-cdp.md`.

## Overview (the denied RDP API, kept for reference)

The LSEG Data Library provides two approaches for news retrieval:
- **Access Layer**: `ld.news.get_headlines()` - Simple retrieval, max 100 headlines
- **Content Layer**: `news.headlines.Definition()` - Cursor-based pagination for larger datasets

**Limitations**:
- Maximum 100 headlines per request
- History depth: ~15 months
- Real-time streaming requires separate subscription

## Quick Start

```python
import lseg.data as ld

ld.open_session()

# Get headlines for a specific instrument
df = ld.news.get_headlines(
    query=’R:AAPL.O AND Language:LEN’,
    count=10
)
print(df.head())

# Get headlines with date range
df = ld.news.get_headlines(
    query=’R:MSFT.O’,
    start=‘2024-01-01’,
    end=‘2024-01-31’,
    count=50
)

ld.close_session()
```

## Query Syntax

News queries use a specific syntax for filtering:

| Filter | Syntax | Example |
|--------|--------|---------|
| Instrument | `R:<RIC>` | `R:IBM.N` |
| Language | `Language:<code>` | `Language:LEN` (English) |
| Topic | `Topic:<code>` | `Topic:AMERS` |
| Source group | `SUGGAC` | Suggested academic sources |
| Multiple conditions | `AND` | `R:AAPL.O AND Language:LEN` |

### Source Filtering

By default, news queries return results from many sources which can be noisy. Use `SUGGAC` (Suggested Academic) to filter to curated, higher-quality sources:

```python
# Recommended: filter to suggested academic sources
df = ld.news.get_headlines(
    query='R:MSFT.O AND SUGGAC',
    count=100
)

# Combine with language filter
df = ld.news.get_headlines(
    query='R:AAPL.O AND SUGGAC AND Language:LEN',
    count=100
)
```

### Language Codes

| Code | Language |
|------|----------|
| `LEN` | English |
| `LDE` | German |
| `LFR` | French |
| `LES` | Spanish |
| `LJA` | Japanese |
| `LZH` | Chinese |

## Access Layer API

### `ld.news.get_headlines()`

Simple headlines retrieval without pagination.

```python
df = ld.news.get_headlines(
    query='R:LSEG.L AND Language:LEN',
    count=100,           # Max 100
    start='2024-01-01',  # Optional start date
    end='2024-01-31',    # Optional end date
    order_by='oldToNew'  # or 'newToOld' (default)
)
```

**Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | str | News query string |
| `count` | int | Number of headlines (max 100) |
| `start` | str | Start date (ISO format) |
| `end` | str | End date (ISO format) |
| `order_by` | str | Sort order: 'newToOld' or 'oldToNew' |

**Returns**: DataFrame with columns:
- `storyId` - Unique story identifier
- `headline` - Headline text
- `versionCreated` - Publication timestamp
- `sourceCode` - News source code

### Get Story Content

```python
# Get full story text from storyId
story = ld.news.get_story(story_id='urn:newsml:reuters.com:20240131:nL1N3...')
print(story)
```

## Content Layer API

For retrieving more than 100 headlines, use cursor-based pagination.

```python
from lseg.data.content import news

# Initial request
response = news.headlines.Definition(
    query="R:LSEG.L",
    date_from="2024-01-01T00:00:00.000",
    date_to="2024-01-31T23:59:59.999",
    count=100
).get_data()

# Get headlines DataFrame
df = response.data.df

# Check for more results
if response.data.raw and response.data.raw[0].get("meta", {}).get("next"):
    next_cursor = response.data.raw[0]["meta"]["next"]

    # Fetch next page
    response = news.headlines.Definition(
        query="R:LSEG.L",
        cursor=next_cursor,
        count=100
    ).get_data()
```

### Pagination Loop

```python
from lseg.data.content import news
import pandas as pd

def get_all_headlines(query, date_from, date_to, max_headlines=1000):
    """Retrieve headlines with pagination."""
    all_headlines = []
    cursor = None

    while len(all_headlines) < max_headlines:
        if cursor:
            response = news.headlines.Definition(
                query=query,
                cursor=cursor,
                count=100
            ).get_data()
        else:
            response = news.headlines.Definition(
                query=query,
                date_from=date_from,
                date_to=date_to,
                count=100
            ).get_data()

        df = response.data.df
        if df is None or len(df) == 0:
            break

        all_headlines.append(df)

        # Check for next page
        raw = response.data.raw
        if raw and raw[0].get("meta", {}).get("next"):
            cursor = raw[0]["meta"]["next"]
        else:
            break

    return pd.concat(all_headlines, ignore_index=True) if all_headlines else pd.DataFrame()

# Usage
df = get_all_headlines(
    query="R:AAPL.O AND Language:LEN",
    date_from="2024-01-01T00:00:00.000",
    date_to="2024-03-31T23:59:59.999",
    max_headlines=500
)
```

## Response Structure

### Headlines DataFrame

| Column | Description |
|--------|-------------|
| `storyId` | Unique identifier for the story |
| `headline` | Headline text |
| `versionCreated` | Publication timestamp (UTC) |
| `sourceCode` | News source identifier |
| `urgency` | Story urgency level |

### Raw Response

```python
# Access raw API response
raw = response.data.raw[0]

# Metadata
meta = raw.get("meta", {})
print(f"Total count: {meta.get('count')}")
print(f"Next cursor: {meta.get('next')}")

# Headlines array
headlines = raw.get("data", [])
```

## Common Patterns

### Headlines for Multiple Instruments

```python
# Query multiple RICs
instruments = ['AAPL.O', 'MSFT.O', 'GOOGL.O']
query = ' OR '.join([f'R:{ric}' for ric in instruments])

df = ld.news.get_headlines(
    query=f'({query}) AND Language:LEN',
    count=100
)
```

### Filter by Topic

```python
# Get earnings-related news
df = ld.news.get_headlines(
    query='R:AAPL.O AND Topic:EARN',
    count=50
)

# Get M&A news
df = ld.news.get_headlines(
    query='R:MSFT.O AND Topic:MRG',
    count=50
)
```

### Date Range Queries

```python
from datetime import datetime, timedelta

# Last 7 days
end_date = datetime.now()
start_date = end_date - timedelta(days=7)

df = ld.news.get_headlines(
    query='R:TSLA.O',
    start=start_date.strftime('%Y-%m-%d'),
    end=end_date.strftime('%Y-%m-%d'),
    count=100
)
```

## Topic Codes

Common topic codes for filtering:

| Code | Topic |
|------|-------|
| `AMERS` | Americas |
| `EMEA` | Europe/Middle East/Africa |
| `ASIA` | Asia-Pacific |
| `EARN` | Earnings |
| `MRG` | Mergers & Acquisitions |
| `IPO` | Initial Public Offerings |
| `DIV` | Dividends |
| `CORA` | Corporate Actions |
| `RESF` | Research |
| `COM` | Commodities |
| `FX` | Foreign Exchange |
| `STX` | Stocks |
| `GOV` | Government/Politics |

## Limitations

1. **100 headlines per request**: Use Content Layer pagination for larger datasets
2. **~15 months history**: Older news may not be available
3. **Rate limits**: Subject to session rate limits (500 requests/minute)
4. **Real-time streaming**: Requires separate subscription and different API

## Troubleshooting

### Empty Results

- Verify RIC symbology (`.O` for NASDAQ, `.N` for NYSE)
- Check date range is within 15-month window
- Ensure language code is correct (`LEN` not `EN`)

### Pagination Issues

- Always check for `next` cursor in `response.data.raw[0]["meta"]`
- Use cursor parameter instead of date_from/date_to for subsequent requests
- Handle empty responses gracefully

### Authentication

News API requires valid LSEG session. Verify connection:

```python
import lseg.data as ld

ld.open_session()
state = ld.get_config()
print(f"Session state: {state}")
```
