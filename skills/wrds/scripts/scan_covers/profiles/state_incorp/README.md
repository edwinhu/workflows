# State of Incorporation Profile

Extracts state of incorporation and headquarters state from 10-K SGML headers.

## Fields

| Column | Source | Description |
|--------|--------|-------------|
| state_of_incorp | `STATE OF INCORPORATION:` header | Legal domicile (2-3 letter code) |
| hq_state | `BUSINESS ADDRESS: ... STATE:` header | Headquarters state (2 letter code) |
| cik | `CENTRAL INDEX KEY:` header | SEC CIK |
| company_name | `COMPANY CONFORMED NAME:` header | Company name |
| fiscal_year_end | `FISCAL YEAR END:` header | MMDD format |

## Accuracy

Validated against Barzuza, Curtis & Webber (2020) historical state of incorporation dataset:
- **98.42%** exact match on 95,635 overlapping CIK-years (2004-2019)
- **98.89%** with year-shift tolerance (filing year vs fiscal year)
- Remaining ~1.1% is mostly HQ/incorp confusion in the SEC header (4.4% of filings have HQ state in the `STATE OF INCORPORATION` field)

## Post-processing

Apply `build_panel.py` after raw extraction for:
1. **Transient flip smoothing**: A→B→A patterns (1-year state changes that revert)
2. **Deduplication**: one row per (CIK, fiscal_year)

## Usage

```bash
# Stage filing list
pixi run python scripts/scan_covers/profiles/state_incorp/stage.py

# Build + upload + submit on WRDS
bash scripts/scan_covers/sge/submit_array.sh -p state_incorp

# Download + build panel
pixi run python scripts/scan_covers/profiles/state_incorp/build_panel.py
```

## Standalone version

The original standalone parser lives at `mirror/scripts/state_incorp_go/`.
This profile is the canonical version integrated into the scan_covers framework.
