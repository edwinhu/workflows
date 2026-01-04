# Thomson Reuters Form 4 Insider Data

## Tables

| Table | Description |
|-------|-------------|
| `tr_insiders.table1` | Form 4 transactions (trades) |
| `tr_insiders.table2` | Derivative holdings |
| `tr_insiders.header` | Insider identity and role codes |
| `tr_insiders.company` | Company identifiers |
| `tr_insiders.form144` | Form 144 filings |

## Key Fields

### table1 (Transactions)
- `ticker` - Stock ticker
- `dcn` - Document control number (links to header)
- `personid` - Person identifier (links to header)
- `fdate` - Filing date
- `trandate` - Transaction date
- `trancode` - Transaction code (S=Sale, P=Purchase, etc.)
- `acqdisp` - A=Acquisition, D=Disposition
- `shares` - Number of shares
- `tprice` - Transaction price per share
- `sharesheld` - Shares held after transaction
- `ownership` - D=Direct, I=Indirect

### header (Insider Info)
- `dcn` - Document control number
- `personid` - Person identifier
- `owner` - Insider name
- `rolecode1`, `rolecode2`, `rolecode3` - Role codes

## Rolecode Reference

### C-Suite Executives
| Code | Role |
|------|------|
| CEO | Chief Executive Officer |
| CFO | Chief Financial Officer |
| COO | Chief Operating Officer |
| CT | Chief Technology Officer |
| GC | General Counsel |
| P | President |
| CI | Chief Investment Officer |
| CO | Chief Operating Officer |

### Senior Officers
| Code | Role |
|------|------|
| EVP | Executive Vice President |
| SVP | Senior Vice President |
| OE | Other Executive Officer |
| OS | Other Senior Officer |

### Directors
| Code | Role |
|------|------|
| D | Director |
| CB | Chairman of the Board |
| VC | Vice Chairman |
| OD | Officer and Director |
| DO | Director and Officer |

### Other
| Code | Role |
|------|------|
| O | Officer |
| C | Controller |
| F | Financial Officer |
| FO | Financial Officer |
| S | Secretary |
| B | 10% Beneficial Owner |
| H | 10% Holder |

## Transaction Codes

| Code | Description |
|------|-------------|
| S | Open market sale |
| P | Open market purchase |
| D | Disposition (non-open market) |
| A | Grant/award |
| G | Gift |
| F | Tax payment (shares withheld) |
| M | Exercise of derivative |
| C | Conversion |
| J | Other acquisition |
| K | Equity swap |

## Query Patterns

### Executive Stock Disposals
```python
sql = """
    SELECT DISTINCT
        t.ticker,
        t.fdate as filing_date,
        t.trandate as transaction_date,
        h.owner as insider_name,
        CASE
            WHEN h.rolecode1 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'P')
                 OR h.rolecode2 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'P')
            THEN 'Executive Officer'
            WHEN h.rolecode1 IN ('EVP', 'SVP', 'OE', 'OS')
                 OR h.rolecode2 IN ('EVP', 'SVP', 'OE', 'OS')
            THEN 'Senior Officer'
            WHEN h.rolecode1 IN ('D', 'CB', 'VC')
                 OR h.rolecode2 IN ('D', 'CB', 'VC')
            THEN 'Director'
            ELSE 'Other'
        END as insider_role,
        t.trancode,
        t.acqdisp,
        t.shares as trans_shares,
        t.tprice as price_per_share,
        t.sharesheld as shares_held_after
    FROM tr_insiders.table1 t
    LEFT JOIN tr_insiders.header h
        ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE t.ticker = 'AAPL'
      AND t.trandate BETWEEN '2020-01-01' AND '2023-12-31'
      AND t.acqdisp = 'D'
      AND t.trancode IN ('S', 'D', 'G', 'F')
      AND t.shares IS NOT NULL
    ORDER BY t.trandate DESC
"""
```

### All Insider Activity for Company
```python
sql = """
    SELECT
        t.ticker,
        t.trandate,
        h.owner,
        t.trancode,
        t.acqdisp,
        t.shares,
        t.tprice,
        t.shares * t.tprice as transaction_value
    FROM tr_insiders.table1 t
    LEFT JOIN tr_insiders.header h
        ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE t.ticker = %s
      AND t.trandate >= %s
      AND t.shares IS NOT NULL
    ORDER BY t.trandate DESC
"""
```

### Filter for Executives Only
```python
executive_roles = (
    'CEO', 'CFO', 'COO', 'CT', 'GC', 'P', 'CI', 'CO',
    'EVP', 'SVP', 'OE', 'OS'
)

sql = f"""
    SELECT *
    FROM tr_insiders.table1 t
    JOIN tr_insiders.header h ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE (h.rolecode1 IN {executive_roles}
           OR h.rolecode2 IN {executive_roles}
           OR h.rolecode3 IN {executive_roles})
"""
```

## Common Gotchas

1. **Multiple rolecodes** - Check all three rolecode fields (rolecode1, rolecode2, rolecode3)
2. **Null shares** - Filter `WHERE shares IS NOT NULL AND shares != 0`
3. **Transaction value** - Calculate as `shares * tprice`
4. **Direct vs Indirect** - `ownership = 'D'` for direct holdings only
5. **Join keys** - Use both `dcn` AND `personid` when joining table1 to header
