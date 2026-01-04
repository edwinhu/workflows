# LSEG Data Library Troubleshooting

Common issues and solutions when working with the LSEG Data Library.

## Authentication Issues

### "Session not opened" Error

**Symptom:**
```
LDError: Session is not opened. Please open a session before making requests.
```

**Solution:**
```python
import lseg.data as ld

# Always open session before any data calls
ld.open_session()

# Now make your requests
df = ld.get_data(...)
```

### "Invalid credentials" Error

**Symptom:**
```
LDError: Authentication failed - invalid credentials
```

**Causes & Solutions:**

1. **Wrong credential type**: Machine IDs look like `GE-A-XXXXXXXX-X-XXXX`
   ```python
   # Check you're using machine ID, not email
   # Wrong: username = "user@company.com"
   # Right: username = "GE-A-01234567-8-9012"
   ```

2. **App key not set**:
   ```python
   # Check environment variable
   import os
   print(os.environ.get('RDP_APP_KEY'))  # Should not be None
   ```

3. **Password expired**: Regenerate in LSEG Developer Portal

### Desktop Session Not Found

**Symptom:**
```
LDError: Cannot connect to desktop session
```

**Solutions:**

1. Ensure Eikon or Workspace is running
2. Check Eikon/Workspace is logged in
3. Try explicit platform session instead:
   ```python
   import lseg.data as ld

   ld.open_session(
       config_name="platform.ldp"  # Use platform instead of desktop
   )
   ```

## Missing/Empty Data

### Empty DataFrame Returned

**Symptom:**
```python
df = ld.get_data('AAPL.O', ['TR.Revenue'])
print(df)  # Empty or all NaN
```

**Causes & Solutions:**

1. **Wrong instrument code (RIC)**:
   ```python
   # Verify RIC is valid
   from lseg.data.content import symbol_conversion

   # Check if ISIN maps to expected RIC
   result = symbol_conversion.Definition(
       symbols=['US0378331005'],  # Apple ISIN
       from_symbol_type='ISIN',
       to_symbol_types=['RIC']
   ).get_data()
   ```

2. **Missing date parameters for historical data**:
   ```python
   # Wrong - no dates for periodic data
   df = ld.get_data('AAPL.O', ['TR.RevenueActValue'])

   # Right - specify period
   df = ld.get_data(
       'AAPL.O',
       ['TR.RevenueActValue'],
       parameters={'Period': 'FY0'}  # Current fiscal year
   )
   ```

3. **Field not available for instrument**:
   ```python
   # Not all fields work for all instruments
   # Check field availability in Data Item Browser
   ```

### Partial Data (Some Fields Missing)

**Symptom:**
```python
df = ld.get_data('XYZ.O', ['TR.Revenue', 'TR.ESGScore'])
# Revenue has data, ESG is NaN
```

**Causes:**

1. **No ESG coverage** for that company - check coverage in Eikon
2. **Different data sources** - some fields require separate permissions
3. **Timing issues** - ESG updated less frequently than financials

### Historical Data Gaps

**Symptom:**
```python
df = ld.get_history('AAPL.O', start='2020-01-01', end='2020-12-31')
# Missing weekends/holidays (expected) or missing trading days (problem)
```

**Solutions:**

1. **Check for corporate actions** (splits, ticker changes)
2. **Use adjusted prices** for historical analysis:
   ```python
   df = ld.get_history(
       'AAPL.O',
       fields=['CLOSE'],  # Adjusted by default
       adjustments=['split', 'dividend']
   )
   ```

## Rate Limiting

### Rate Limit Exceeded

**Symptom:**
```
LDError: Rate limit exceeded. Please try again later.
```

**Solutions:**

1. **Implement exponential backoff**:
   ```python
   import time
   from lseg.data.errors import LDError

   def get_data_with_retry(universe, fields, max_retries=3):
       for attempt in range(max_retries):
           try:
               return ld.get_data(universe, fields)
           except LDError as e:
               if 'rate limit' in str(e).lower():
                   wait_time = 2 ** attempt * 30  # 30s, 60s, 120s
                   print(f"Rate limited. Waiting {wait_time}s...")
                   time.sleep(wait_time)
               else:
                   raise
       raise Exception("Max retries exceeded")
   ```

2. **Batch your requests**:
   ```python
   # Instead of one request per symbol
   for sym in large_universe:
       ld.get_data(sym, fields)  # Bad - many requests

   # Batch into chunks
   def chunked(lst, n):
       for i in range(0, len(lst), n):
           yield lst[i:i + n]

   for chunk in chunked(large_universe, 100):
       ld.get_data(chunk, fields)  # Better - fewer requests
   ```

3. **Add delays between requests**:
   ```python
   import time

   for chunk in data_chunks:
       result = ld.get_data(chunk, fields)
       time.sleep(1)  # Wait 1 second between requests
   ```

## Symbol Conversion Issues

### Symbol Not Found

**Symptom:**
```
LDError: Symbol 'AAPL' not found
```

**Solution:** Use proper RIC format:
```python
# Wrong - ticker only
ld.get_data('AAPL', fields)

# Right - full RIC
ld.get_data('AAPL.O', fields)  # .O = NASDAQ
ld.get_data('IBM.N', fields)   # .N = NYSE
```

### RIC Exchange Suffixes

| Exchange | Suffix | Example |
|----------|--------|---------|
| NASDAQ | `.O` | `AAPL.O` |
| NYSE | `.N` | `IBM.N` |
| London | `.L` | `VOD.L` |
| Tokyo | `.T` | `7203.T` |
| Hong Kong | `.HK` | `0700.HK` |
| Frankfurt | `.DE` | `BMW.DE` |

### Converting Between Identifiers

```python
from lseg.data.content import symbol_conversion

# ISIN to RIC
result = symbol_conversion.Definition(
    symbols=['US0378331005'],
    from_symbol_type='ISIN',
    to_symbol_types=['RIC']
).get_data()

# CUSIP to RIC
result = symbol_conversion.Definition(
    symbols=['037833100'],
    from_symbol_type='CUSIP',
    to_symbol_types=['RIC']
).get_data()
```

## Performance Issues

### Slow Queries

**Causes & Solutions:**

1. **Too many fields**:
   ```python
   # Slow - requesting many fields
   fields = [f'TR.Field{i}' for i in range(100)]

   # Better - only request needed fields
   fields = ['TR.Revenue', 'TR.NetIncome', 'TR.EPS']
   ```

2. **Large date ranges**:
   ```python
   # Slow - 20 years of daily data
   df = ld.get_history('AAPL.O', start='2004-01-01')

   # Better - chunk into years
   for year in range(2004, 2024):
       df = ld.get_history(
           'AAPL.O',
           start=f'{year}-01-01',
           end=f'{year}-12-31'
       )
   ```

3. **Real-time data overhead**:
   ```python
   # Use get_data for snapshots, not streaming
   # Streaming uses more resources
   ```

### Memory Issues

**Symptom:** Python crashes or runs out of memory

**Solutions:**

1. **Process in chunks**:
   ```python
   import pandas as pd

   all_data = []
   for chunk in chunked(large_universe, 50):
       df = ld.get_data(chunk, fields)
       all_data.append(df)
       del df  # Free memory

   result = pd.concat(all_data)
   ```

2. **Use appropriate data types**:
   ```python
   df = ld.get_data(universe, fields)
   df = df.astype({
       'price': 'float32',  # Instead of float64
       'volume': 'int32'    # Instead of int64
   })
   ```

## Common Code Errors

### TypeError: Cannot Convert to DataFrame

**Symptom:**
```
TypeError: 'Response' object is not subscriptable
```

**Cause:** Using `Definition()` without `.get_data()`

```python
# Wrong
result = fundamental_and_reference.Definition(universe, fields)
df = result['Instrument']  # Error!

# Right
response = fundamental_and_reference.Definition(universe, fields).get_data()
df = response.data.df  # Access DataFrame
```

### AttributeError: Module Has No Attribute

**Symptom:**
```
AttributeError: module 'lseg.data' has no attribute 'get_fundamentals'
```

**Cause:** Wrong function name or import

```python
# Check available functions
import lseg.data as ld
dir(ld)  # See available methods

# Common functions:
# ld.get_data()
# ld.get_history()
# ld.open_session()
# ld.close_session()
```

### Index Error with MultiIndex

**Symptom:**
```python
df.loc['AAPL.O']  # KeyError
```

**Cause:** DataFrame has MultiIndex

```python
# Reset index for easier access
df = df.reset_index()

# Or access properly
df.loc[df['Instrument'] == 'AAPL.O']
```

## Debugging Strategies

### Enable Debug Logging

```python
import logging

# Enable debug output
logging.basicConfig(level=logging.DEBUG)

# Or for specific modules
logging.getLogger('lseg.data').setLevel(logging.DEBUG)
```

### Inspect API Response

```python
# Get raw response for debugging
from lseg.data.content import fundamental_and_reference

response = fundamental_and_reference.Definition(
    universe=['AAPL.O'],
    fields=['TR.Revenue']
).get_data()

# Inspect response
print(response.raw)        # Raw JSON response
print(response.data.df)    # Parsed DataFrame
print(response.errors)     # Any errors
```

### Validate Field Names

```python
# Test if field exists
try:
    df = ld.get_data('AAPL.O', ['TR.TestField'])
    print("Field exists" if not df.empty else "No data for field")
except Exception as e:
    print(f"Field error: {e}")
```

### Check Session Status

```python
import lseg.data as ld

# Check if session is open
print(ld.get_config())  # Shows current configuration
print(ld.session)       # Current session object
```

## Getting Help

1. **LSEG Developer Community**: https://community.developers.refinitiv.com/
2. **Data Item Browser**: Search for fields and their parameters
3. **API Documentation**: https://developers.lseg.com/
4. **Support Ticket**: Via LSEG Developer Portal

## See Also

- [SKILL.md](SKILL.md) - Main documentation
- [modules/symbology.md](modules/symbology.md) - Symbol conversion details
- [WRDS_COMPARISON.md](WRDS_COMPARISON.md) - WRDS field mapping
