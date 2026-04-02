# FJC Integrated Database

The Federal Judicial Center (FJC) Integrated Database on WRDS contains all federal district court case filings from 1970 to present (~13.5M rows across all case types).

## Schemas

| Schema | Description |
|--------|-------------|
| `fjc` | Primary — civil, criminal, bankruptcy, appeals |
| `fjc_litigation` | Alternate copy (identical structure) |
| `fjc_litigation_old` | Older vintage |
| `fjc_linking` | WRDS-constructed firm links (gvkey/CIK) |

Use `fjc` for all queries unless you need the linking tables, which live in `fjc_linking`.

## Tables

| Table | Rows (approx) | Description |
|-------|---------------|-------------|
| `fjc.civil` | 13.5M | Civil cases (most relevant for securities research) |
| `fjc.criminal` | — | Criminal cases |
| `fjc.bankruptcy` | — | Bankruptcy filings |
| `fjc.appeals` | — | Appellate cases |
| `fjc_linking.wrds_civil_link` | — | Civil case → gvkey/CIK matches for plaintiff/defendant |

## `fjc.civil` Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `filedate` | date | Case filing date |
| `termdate` | date | Case termination date |
| `nos` | float | Nature of Suit code (see below) |
| `section` | varchar | Statutory section (e.g., `'0078'`, `'0077'`) |
| `subsect` | varchar | Statutory subsection (e.g., `'J'` for §10(b)) |
| `titl` | varchar | U.S. Code title (e.g., `'15'` for 15 U.S.C.) |
| `class_action` | float | 1 = class action, 0 = individual, NULL = not coded |
| `disp` | float | Disposition code |
| `judgment` | float | Judgment outcome code |
| `amtrec` | float | Amount recovered |
| `demanded` | float | Amount demanded |
| `circuit` | float | Circuit number (1–12) |
| `district` | varchar | District code (e.g., `'07'` = SDNY) |
| `jury` | varchar | Jury demand |
| `docket` | varchar | Docket number (part of natural key) |
| `office` | varchar | Court office code (part of natural key) |
| `docket_seq` | varchar | Docket sequence (disambiguates same docket) |
| `casename` | varchar | Case name (NULL for most pre-2000 cases) |
| `plaintiff` | varchar | Plaintiff name |
| `defendant` | varchar | Defendant name |
| `mdldock` | varchar | MDL docket number (multi-district litigation) |
| `procprog` | float | Procedural progress code |
| `trclact` | float | Class action type code |
| `pro_se_plaintiff` | float | 1 = pro se plaintiff |
| `pro_se_defendant` | float | 1 = pro se defendant |
| `tapeyear` | float | Data tape year (internal FJC vintage flag) |

## Nature of Suit (NOS) Codes — Securities-Relevant

| NOS | Description | Count (all years) |
|-----|-------------|-------------------|
| **850** | **Securities / Commodities / Exchange** | **~114k** |
| 860 | ERISA (labor/pension) | ~49k |
| 870 | Tax suits | ~95k |
| 890 | Other statutory actions | ~412k |

**NOS 850 is the primary filter for securities litigation research.**

## Statutory Basis Classification

The `section` field encodes the primary statute cited. It is populated for roughly 60% of NOS=850 cases (older cases tend to be uncoded).

| `section` value(s) | Statute | Provisions |
|--------------------|---------|-----------|
| `'0078'`, `'78'`, `'78J'`, `'78j'` | Securities Exchange Act 1934 (15 U.S.C. §78) | Rule 10b-5 (§10(b)), §16, §14, §9 |
| `'0077'`, `'77'`, `'77A'` | Securities Act 1933 (15 U.S.C. §77) | §11, §12(a), §15 |
| `'1331'` | Federal question jurisdiction | Mixed / unspecified |
| `'1441'` | Removal from state court | Mixed |

### Classifying in Python

```python
def statute_class(sec):
    sec = str(sec).strip().upper()
    if '78' in sec and '77' not in sec:
        return 'Exchange Act (SEA 1934)'
    if '77' in sec and '78' not in sec:
        return 'Securities Act (SA 1933)'
    return 'Other / Not Coded'

df['statute'] = df['section'].apply(statute_class)
```

## Sub-Provision Identification (Major Limitation)

The `subsect` field theoretically identifies the specific provision, but **is sparsely populated**. Most records have `subsect = '-8'` (not specified).

| `subsect` | Provision | Reliability |
|-----------|-----------|-------------|
| `'J'`, `'JB'`, `'j'`, `'jb'` | §10(b) / Rule 10b-5 | Sparse (~830 cases in NOS=850) |
| `'K'`, `'k'` | §11 (SA 1933) | Very sparse (~10 cases) |
| `'L'`, `'l'` | §12 (SA 1933) | Very sparse (~2 cases) |
| `'-8'` | Not coded | ~60% of cases |
| `'MA'` | Market manipulation (§9?) | Sparse |
| `'AA'` | §16(a) short-swing? | Sparse |

**Bottom line**: You can reliably separate Exchange Act (§78) from Securities Act (§77) cases, but **cannot reliably distinguish §11 vs §12 vs Rule 10b-5** from FJC alone. For provision-level analysis, supplement with:
- [Stanford Securities Class Action Clearinghouse (SCAS)](https://securities.stanford.edu/)
- Cornerstone Research annual reports
- PACER docket text mining

## Standard Securities Litigation Query (NOS=850)

```python
import psycopg2
import pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737,
    database='wrds',
    user='eddyhu',
    sslmode='require'
)

query = """
SELECT
    filedate,
    EXTRACT(YEAR FROM filedate)::int AS fileyear,
    COALESCE(section, '')  AS section,
    COALESCE(subsect, '')  AS subsect,
    class_action,
    disp,
    amtrec,
    circuit::int AS circuit,
    district
FROM fjc.civil
WHERE nos = 850
  AND filedate BETWEEN %s AND %s
"""

df = pd.read_sql(query, conn, params=('1980-01-01', '2023-12-31'))
```

No additional filters required for NOS=850 (unlike Compustat which requires indfmt/datafmt/etc.).

## Dedup

**No dedup needed.** Each row in `fjc.civil` is a unique case filing. Natural key: `(filedate, docket, circuit, district, office)`. Verified empirically — no duplicates on this key in NOS=850 data.

Do **not** UNION `fjc.civil` and `fjc_litigation.civil` — they are mirrors of the same data.

## Disposition Codes

| Range | Category |
|-------|----------|
| 0–2 | Transfer / Remand |
| 10–19 | Dismissed (pre-trial) |
| 20–29 | Judgment on merits (trial) |
| 30–45 | Settlement / Consent judgment |

Post-PSLRA (1995–2023): ~72% of NOS=850 cases dismissed pre-trial, <1% reach trial judgment. Class action cases have nearly identical disposition profile — PSLRA's heightened pleading standard did not measurably shift cases toward trial.

## `fjc_linking.wrds_civil_link` — Firm Matching

WRDS-constructed table linking civil cases to Compustat/EDGAR firm identifiers.

| Column | Description |
|--------|-------------|
| `def_gvkey` | Defendant Compustat gvkey |
| `def_cik` | Defendant SEC CIK |
| `plt_gvkey` | Plaintiff Compustat gvkey |
| `plt_cik` | Plaintiff SEC CIK |
| `def_com_name` | Matched company name (defendant) |
| `plt_com_name` | Matched company name (plaintiff) |
| `d_score` | Match quality score (defendant) |
| `p_score` | Match quality score (plaintiff) |
| `filedate`, `docket`, `circuit`, `district`, `office` | Join keys back to `fjc.civil` |

Join on `(filedate, docket, circuit, district, office)` to merge with `fjc.civil`.

Filter on `d_score = 1.0` for high-confidence defendant matches.

## Empirical Benchmarks (NOS=850, 1980–2023)

From a full pull of 89,889 cases (filedate 1980–2023):

| Metric | Value |
|--------|-------|
| Exchange Act (§78) cases | 41,858 (46.6%) |
| Securities Act (§77) cases | 10,260 (11.4%) |
| Other / uncoded | 37,771 (42.0%) |
| Class actions (where coded) | 14,225 (15.8%) |
| Pre-PSLRA avg class actions/yr (1985–94) | ~140 |
| Post-PSLRA avg class actions/yr (1996–05) | ~578 |
| Top circuit (2014–23) | 9th (CA) |
| 2nd highest (2014–23) | 2nd (NY) |

Note: Class action flag (`class_action`) is NULL for ~71% of cases — coded primarily post-1990.

## Coverage Notes & Quirks

- **Placeholder dates**: Some pre-1980 cases have `filedate = '1900-01-01'` — always filter `filedate >= '1970-01-01'`
- **casename**: NULL for most pre-2000 cases; don't rely on it for case identification
- **section/subsect sparsity**: Coverage improves after ~1990; very sparse before 1985
- **class_action NULL rate**: ~71% of all NOS=850 cases; flag coded primarily post-1990. Do not treat NULL as "not a class action"
- **circuit stored as float**: Cast to int before joining or grouping: `circuit::int`
- **`fjc_litigation`** schema is a mirror of `fjc` — use either; `fjc` is preferred; never UNION them
- **`fjc_linking` join key**: Must join on all five columns — `(filedate, docket, circuit, district, office)` — omitting `office` produces spurious matches
- **EDA notebook**: `~/projects/workflows/skills/wrds/examples/fjc_eda.ipynb` has full worked examples including dedup verification and linking join
