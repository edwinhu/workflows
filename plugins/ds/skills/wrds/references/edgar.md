# SEC EDGAR Access via WRDS

## Overview

WRDS provides SEC EDGAR filing data through the `edgar` schema. This includes filing metadata, company information, and filing content access.

## Key Tables

### edgar.filings
Master filing table with all SEC submissions.

| Field | Type | Description |
|-------|------|-------------|
| `cik` | varchar(10) | Central Index Key (10-digit padded) |
| `accession_number` | varchar(25) | Unique filing identifier |
| `form_type` | varchar(20) | Filing type (10-K, 10-Q, 8-K, etc.) |
| `file_date` | date | Date filed with SEC |
| `accepted` | timestamp | SEC acceptance timestamp |
| `company_name` | varchar(150) | Filer company name |
| `fiscal_year_end` | varchar(4) | Fiscal year end (MMDD format) |
| `sic` | varchar(4) | Standard Industrial Classification |
| `state` | varchar(2) | State of incorporation |
| `file_num` | varchar(20) | SEC file number |
| `fiscal_year` | int | Fiscal year of filing |

### edgar.company_info
Company registration information.

| Field | Type | Description |
|-------|------|-------------|
| `cik` | varchar(10) | Central Index Key |
| `company_name` | varchar(150) | Company name |
| `sic` | varchar(4) | SIC code |
| `state` | varchar(2) | State |
| `fiscal_year_end` | varchar(4) | Fiscal year end |

## Common Form Types

| Form Type | Description | Frequency |
|-----------|-------------|-----------|
| `10-K` | Annual report | Yearly |
| `10-K/A` | Amended annual report | As needed |
| `10-Q` | Quarterly report | Quarterly |
| `8-K` | Current report (material events) | As needed |
| `DEF 14A` | Proxy statement | Yearly |
| `4` | Insider trading report | As needed |
| `S-1` | IPO registration | One-time |
| `13F-HR` | Institutional holdings | Quarterly |
| `SC 13D` | Beneficial ownership >5% | As needed |
| `SC 13G` | Passive beneficial ownership | As needed |

## Query Patterns

### Find Company Filings

```python
def get_company_filings(pool, cik: str, form_types: list = None,
                        start_date: str = None) -> list:
    """Get SEC filings for a company.

    Args:
        pool: WRDS connection pool
        cik: CIK number (will be normalized)
        form_types: List of form types to filter (optional)
        start_date: Start date for filings (optional)

    Returns:
        List of filing records
    """
    # Normalize CIK to 10 digits
    cik_normalized = str(cik).zfill(10)

    query = """
        SELECT cik, accession_number, form_type, file_date,
               company_name, sic
        FROM edgar.filings
        WHERE cik = %s
    """
    params = [cik_normalized]

    if form_types:
        query += " AND form_type = ANY(%s)"
        params.append(form_types)

    if start_date:
        query += " AND file_date >= %s"
        params.append(start_date)

    query += " ORDER BY file_date DESC"

    with pool.cursor() as cursor:
        cursor.execute(query, tuple(params))
        return cursor.fetchall()
```

### Get 10-K and 10-Q Filings

```python
def get_periodic_filings(pool, cik: str, years: int = 5) -> list:
    """Get annual and quarterly filings for analysis."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                accession_number,
                form_type,
                file_date,
                fiscal_year,
                company_name
            FROM edgar.filings
            WHERE cik = %s
              AND form_type IN ('10-K', '10-Q', '10-K/A', '10-Q/A')
              AND file_date >= CURRENT_DATE - INTERVAL '%s years'
            ORDER BY file_date DESC
        """, (cik_normalized, years))

        return cursor.fetchall()
```

### Find 8-K Filings by Topic

8-K filings include item numbers indicating the topic:

| Item | Description |
|------|-------------|
| 1.01 | Entry into material agreement |
| 1.02 | Termination of material agreement |
| 2.01 | Acquisition or disposition of assets |
| 2.02 | Results of operations (earnings) |
| 2.03 | Creation of direct financial obligation |
| 4.01 | Changes in registrant's certifying accountant |
| 4.02 | Non-reliance on previously issued financials |
| 5.02 | Departure/election of directors or officers |
| 5.03 | Amendments to articles/bylaws |
| 7.01 | Regulation FD disclosure |
| 8.01 | Other events |

```python
def get_8k_filings(pool, cik: str, start_date: str) -> list:
    """Get 8-K filings for a company."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                accession_number,
                form_type,
                file_date,
                accepted,
                company_name
            FROM edgar.filings
            WHERE cik = %s
              AND form_type IN ('8-K', '8-K/A')
              AND file_date >= %s
            ORDER BY file_date DESC
        """, (cik_normalized, start_date))

        return cursor.fetchall()
```

### Industry-Wide Filing Search

```python
def get_industry_filings(pool, sic: str, form_type: str,
                         start_date: str, end_date: str) -> list:
    """Get filings for an entire industry."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                company_name,
                accession_number,
                form_type,
                file_date
            FROM edgar.filings
            WHERE sic = %s
              AND form_type = %s
              AND file_date BETWEEN %s AND %s
            ORDER BY file_date DESC
        """, (sic, form_type, start_date, end_date))

        return cursor.fetchall()
```

## Accessing Filing Documents

### Constructing SEC URLs

EDGAR documents are available at SEC.gov using accession numbers:

```python
def get_filing_url(cik: str, accession_number: str) -> str:
    """Construct SEC EDGAR URL for a filing.

    Args:
        cik: CIK number (will be normalized)
        accession_number: Filing accession number

    Returns:
        URL to filing index page
    """
    # Normalize CIK (remove leading zeros for URL)
    cik_clean = str(int(cik))

    # Remove dashes from accession number for path
    accession_clean = accession_number.replace('-', '')

    return (f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_clean}/{accession_clean}/")

def get_filing_document_url(cik: str, accession_number: str,
                            document_name: str) -> str:
    """Construct URL for specific document within filing."""
    base_url = get_filing_url(cik, accession_number)
    return f"{base_url}{document_name}"
```

### Download Filing via WRDS

For bulk downloads, use WRDS file access:

```python
import subprocess
from pathlib import Path

def download_filing_from_wrds(accession_number: str,
                               local_dir: Path) -> Path | None:
    """Download filing from WRDS archive.

    Note: Requires WRDS SFTP access configured via rclone.
    """
    # WRDS stores filings by year/quarter
    # Path structure: /wrds/sec/edgar/filings/YYYY/QTR/

    local_dir = Path(local_dir)
    local_dir.mkdir(parents=True, exist_ok=True)

    # Try rclone first
    try:
        result = subprocess.run(
            ['rclone', 'ls', f'wrds:/wrds/sec/edgar/'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            # Search for the accession number
            # Implementation depends on WRDS file structure
            pass
    except Exception:
        pass

    return None
```

## Linking CIK to Other Identifiers

### CIK to Compustat GVKEY

```python
def cik_to_gvkey(pool, cik: str) -> str | None:
    """Convert SEC CIK to Compustat GVKEY."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT gvkey
            FROM comp.company
            WHERE cik = %s
            LIMIT 1
        """, (cik_normalized,))

        row = cursor.fetchone()
        return row[0] if row else None
```

### Fuzzy Company Matching

When CIK is not available, use fuzzy matching:

```python
from difflib import SequenceMatcher

def find_company_by_name(pool, company_name: str,
                         threshold: float = 0.7) -> list:
    """Find companies by name with fuzzy matching.

    Returns list of (cik, company_name, similarity_score) tuples.
    """
    # Get candidate companies (limit search space)
    name_upper = company_name.upper()
    first_word = name_upper.split()[0]

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT cik, company_name
            FROM edgar.filings
            WHERE UPPER(company_name) LIKE %s
            LIMIT 100
        """, (f'{first_word}%',))

        candidates = cursor.fetchall()

    # Score each candidate
    matches = []
    for cik, db_name in candidates:
        score = SequenceMatcher(None, name_upper, db_name.upper()).ratio()
        if score >= threshold:
            matches.append((cik, db_name, score))

    # Sort by score descending
    matches.sort(key=lambda x: x[2], reverse=True)

    return matches
```

## Filing Counts and Statistics

```python
def get_filing_statistics(pool, cik: str) -> dict:
    """Get filing statistics for a company."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                form_type,
                COUNT(*) as count,
                MIN(file_date) as earliest,
                MAX(file_date) as latest
            FROM edgar.filings
            WHERE cik = %s
            GROUP BY form_type
            ORDER BY count DESC
        """, (cik_normalized,))

        results = cursor.fetchall()

        return {
            row[0]: {
                'count': row[1],
                'earliest': row[2],
                'latest': row[3]
            }
            for row in results
        }
```

## Working with Filing Content

WRDS EDGAR data focuses on metadata. For actual filing content:

1. **Use SEC EDGAR directly**: Download from SEC.gov URLs
2. **Use WRDS file archive**: Access via rclone/SFTP
3. **Consider edgar-online**: For parsed/structured data

### Parsing 10-K Sections

```python
import re
import requests

def download_10k_text(cik: str, accession_number: str) -> str | None:
    """Download 10-K full text from SEC."""
    # Get filing index to find the main document
    base_url = get_filing_url(cik, accession_number)

    # Try common document names
    doc_names = [
        f'{accession_number}.txt',
        'complete-submission.txt',
    ]

    for doc_name in doc_names:
        url = f'{base_url}{doc_name}'
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            return response.text

    return None

def extract_10k_section(text: str, section: str) -> str | None:
    """Extract specific section from 10-K text.

    Common sections:
    - Item 1: Business
    - Item 1A: Risk Factors
    - Item 7: MD&A
    - Item 7A: Market Risk
    - Item 8: Financial Statements
    """
    # Section patterns (simplified)
    patterns = {
        'Item 1': r'Item\s+1\.?\s+Business(.*?)Item\s+1A',
        'Item 1A': r'Item\s+1A\.?\s+Risk\s+Factors(.*?)Item\s+1B',
        'Item 7': r'Item\s+7\.?\s+Management.*?Discussion(.*?)Item\s+7A',
        'Item 8': r'Item\s+8\.?\s+Financial\s+Statements(.*?)Item\s+9',
    }

    if section not in patterns:
        return None

    match = re.search(patterns[section], text, re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else None
```

## Best Practices

1. **Always normalize CIK** to 10 digits with leading zeros
2. **Use form_type arrays** with `ANY(%s)` for multiple types
3. **Include date filters** to limit result sets
4. **Cache filing metadata** locally for repeated analysis
5. **Respect SEC rate limits** when downloading documents (10 requests/second)
6. **Use WRDS file access** for bulk downloads when available

## Rate Limiting for SEC Access

```python
import time
from functools import wraps

def rate_limit(calls_per_second: int = 10):
    """Decorator to rate-limit SEC API calls."""
    min_interval = 1.0 / calls_per_second
    last_call = [0.0]

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_call[0]
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            last_call[0] = time.time()
            return func(*args, **kwargs)
        return wrapper
    return decorator

@rate_limit(calls_per_second=10)
def fetch_filing_from_sec(url: str) -> str:
    """Rate-limited fetch from SEC EDGAR."""
    response = requests.get(
        url,
        headers={'User-Agent': 'YourName your@email.com'},
        timeout=30
    )
    response.raise_for_status()
    return response.text
```
