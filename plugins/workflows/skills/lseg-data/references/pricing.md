# LSEG Pricing Data

## Contents

- [Historical Prices](#historical-prices)
- [Real-Time Prices](#real-time-prices)
- [Streaming Prices](#streaming-prices)
- [Adjusted Prices](#adjusted-prices)
- [Multiple Instruments](#multiple-instruments)
- [Date Chunking for Large Requests](#date-chunking-for-large-requests)
- [Common Issues](#common-issues)

## Historical Prices

### get_history() API

```python
import lseg.data as ld

ld.open_session()

# Daily OHLCV
df = ld.get_history(
    universe='AAPL.O',
    fields=['OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME'],
    start='2023-01-01',
    end='2023-12-31',
    interval='daily'
)

# Intraday (1-minute bars)
df = ld.get_history(
    universe='AAPL.O',
    start='2024-01-15 09:30',
    end='2024-01-15 16:00',
    interval='1min'
)

ld.close_session()
```

### Interval Options

| Interval | Description |
|----------|-------------|
| `tick` | Tick-by-tick |
| `1min`, `5min`, `15min`, `30min` | Intraday bars |
| `1hour` | Hourly bars |
| `daily` | Daily bars |
| `weekly` | Weekly bars |
| `monthly` | Monthly bars |

### Common Fields

| Field | Description |
|-------|-------------|
| `OPEN` | Open price |
| `HIGH` | High price |
| `LOW` | Low price |
| `CLOSE` | Close price |
| `VOLUME` | Trading volume |
| `VWAP` | Volume-weighted average price |
| `COUNT` | Number of trades |

## Real-Time Prices

### Snapshot Pricing

```python
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O'],
    fields=['CF_LAST', 'CF_BID', 'CF_ASK', 'CF_VOLUME']
)
```

### Real-Time Fields

| Field | Description |
|-------|-------------|
| `CF_LAST` | Last traded price |
| `CF_BID` | Best bid |
| `CF_ASK` | Best ask |
| `CF_VOLUME` | Today's volume |
| `CF_HIGH` | Today's high |
| `CF_LOW` | Today's low |
| `CF_OPEN` | Today's open |
| `CF_CLOSE` | Previous close |

## Streaming Prices

```python
from lseg.data.content import pricing

# Create streaming price object
streaming = pricing.Definition(
    universe=['AAPL.O', 'MSFT.O'],
    fields=['BID', 'ASK', 'LAST']
).get_stream()

# Open stream
streaming.open()

# Access current values
print(streaming.get_snapshot())

# Close when done
streaming.close()
```

## Adjusted Prices

For corporate action adjusted prices:

```python
df = ld.get_history(
    universe='AAPL.O',
    fields=['CLOSE'],
    start='2020-01-01',
    end='2023-12-31',
    adjustments=['split', 'dividend']  # Adjust for splits and dividends
)
```

## Multiple Instruments

```python
# Get prices for multiple instruments
df = ld.get_history(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O', 'AMZN.O'],
    fields=['CLOSE', 'VOLUME'],
    start='2023-01-01',
    end='2023-12-31'
)

# Result is a MultiIndex DataFrame
# Access individual instrument: df['AAPL.O']
```

## Date Chunking for Large Requests

```python
import pandas as pd
from datetime import datetime, timedelta

def get_history_chunked(universe, fields, start, end, chunk_days=365):
    """Get history in chunks to avoid rate limits."""
    all_data = []
    current = datetime.strptime(start, '%Y-%m-%d')
    end_dt = datetime.strptime(end, '%Y-%m-%d')

    while current < end_dt:
        chunk_end = min(current + timedelta(days=chunk_days), end_dt)

        df = ld.get_history(
            universe=universe,
            fields=fields,
            start=current.strftime('%Y-%m-%d'),
            end=chunk_end.strftime('%Y-%m-%d')
        )
        all_data.append(df)
        current = chunk_end + timedelta(days=1)

    return pd.concat(all_data)
```

## Common Issues

1. **Rate limits** - Max 3,000 rows per request; use chunking
2. **Missing data** - Check if instrument was traded on requested dates
3. **Timezone** - Prices are in exchange local time by default
4. **Adjusted vs unadjusted** - Default is unadjusted; specify adjustments explicitly
