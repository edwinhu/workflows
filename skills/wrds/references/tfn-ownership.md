# Thomson Reuters / Refinitiv Institutional Ownership & Mutual Fund Holdings

WRDS PostgreSQL reference for 13-F institutional holdings (S34) and mutual fund holdings (S12), including MFLINKS and CRSP mutual fund integration.

## Tables

### 13-F Institutional Holdings

| Table | Description | Grain |
|-------|-------------|-------|
| `tfn.s34type1` | Manager-quarter header | mgrno-rdate-fdate |
| `tfn.s34type3` | Stock-level holdings | mgrno-fdate-cusip |

**s34type1 fields:** `rdate` (report date), `fdate` (file/vintage date), `mgrno`, `mgrname`

**s34type3 fields:** `fdate`, `mgrno`, `cusip`, `shares`, `type`, `sole`, `shared`, `no`

### Mutual Fund Holdings (S12)

| Table | Description | Grain |
|-------|-------------|-------|
| `tfn.s12` (SAS) / `tr_mutualfunds.s12` (PG) | Fund-level stock holdings | fundno-rdate-cusip |

**s12 fields:** `rdate`, `fdate`, `fundno`, `cusip`, `shares`, `fundname`

### MFLINKS

| Table | Description |
|-------|-------------|
| `mfl.mflink1` | TFN fundno -> wficn -> CRSP crsp_fundno |
| `mfl.mflink2` | TFN fundno -> wficn (with rdate alignment) |

**mflink1 fields:** `wficn`, `crsp_fundno`, `fundno`

**mflink2 fields:** `wficn`, `fundno`, `rdate` (use this for date-aligned joins)

### CRSP Mutual Fund Tables

| Table | Description |
|-------|-------------|
| `crsp.portnomap` | crsp_fundno -> crsp_portno mapping with date ranges (`begdt`, `enddt`), `index_fund_flag`, `et_flag` |
| `crsp.fund_fees` | Expense ratios by crsp_fundno with date ranges |
| `crsp.fund_summary` | Monthly TNA and returns |
| `crsp.fund_hdr` | Fund header (`mgmt_name`, `fund_name`, `ticker`) |

## Building 13-F Institutional Ownership

### Step 1: First vintage per manager-quarter

```sql
SELECT DISTINCT rdate, fdate, mgrno, mgrname
FROM tfn.s34type1
GROUP BY mgrno, rdate
HAVING fdate = MIN(fdate)
ORDER BY mgrno, rdate
```

### Step 2: Merge with holdings

```sql
SELECT a.rdate, a.fdate, a.mgrno, a.numinst,
       a.first_report, a.last_report,
       b.permno, a.shares
FROM first_vint a
INNER JOIN tfn.s34type3 b ON a.fdate = b.fdate AND a.mgrno = b.mgrno
-- Map cusip to permno via crsp.msenames
INNER JOIN (
    SELECT DISTINCT ncusip, permno FROM crsp.msenames
    WHERE ncusip IS NOT NULL
) c ON b.cusip = c.ncusip
WHERE b.shares > 0
```

### Step 3: Adjust shares via CRSP factors

```python
shares_adj = shares * cfacshr  # CRSP adjustment factor aligned at vintage date (fdate)
```

> **This step is where the panel breaks around splits.** Thomson has *already*
> pre-adjusted `shares` to the FDATE vintage, and does so incorrectly in a documented
> fraction of cases. Multiplying by `cfacshr` again compounds the error rather than
> fixing it. See **Known Data Defects → D1** below before trusting any split-era quarter.

### Step 4: Aggregate to permno-quarter

```python
# Key output variables
IO_total = shares_adj_sum           # total institutional shares held
IOR = IO_total / TSO                # institutional ownership ratio (0-1)
NumOwners = count(distinct mgrno)
IOC_HHI = sum((shares_i / IO_total) ** 2)  # concentration
```

## Building Mutual Fund Holdings (TFN S12 -> CRSP MF)

### Linking chain: TFN fundno -> wficn -> crsp_fundno -> crsp_portno

```sql
-- Step 1: Link TFN S12 to MFLINKS (date-aligned)
SELECT b.wficn, b.crsp_fundno, c.crsp_portno,
       a.rdate, a.fdate, a.fundno, a.cusip, a.shares, a.fundname,
       c.index_fund_flag, c.et_flag
FROM tfn.s12 a
INNER JOIN mfl.mflink2 b  -- or out.mfl2 if pre-built
  ON a.fundno = b.fundno AND a.rdate = b.rdate
INNER JOIN crsp.portnomap c
  ON b.crsp_fundno = c.crsp_fundno
  AND a.rdate >= c.begdt AND a.rdate <= c.enddt
WHERE b.wficn IS NOT NULL AND c.crsp_fundno IS NOT NULL AND a.shares > 0
```

### Passive/Index fund classification

Use CRSP `index_fund_flag` plus regex on fundname:

```python
passive = (index_fund_flag != '') | bool(re.search(
    r'Index|Idx|Indx|Ind |Russell|S \& P|S and P|S&P|SP|Dow|DJ|'
    r'MSCI|Bloomberg|KBW|Nasdaq|NYSE|STOXX|FTSE|Wilshire|Morningstar|'
    r'[14569]00|(10|15|20|50)00',
    fundname, re.IGNORECASE
))
pure_index = (index_fund_flag == 'D')
```

### Aggregate to permno-quarter

```python
# Map cusip to permno via crsp.msenames, adjust shares by cfacshr
# Then aggregate:
MF_TOTAL = sum(shares_adj)                      # total MF shares
PASSIVE_TOTAL = sum(shares_adj * passive)        # passive fund shares
PURE_INDEX_TOTAL = sum(shares_adj * pure_index)
MF_PCT = MF_TOTAL / TSO                         # bound 0-1
PASSIVE_PCT = PASSIVE_TOTAL / TSO
INDEX_PCT = PURE_INDEX_TOTAL / TSO
EXP_RATIO_VW = sum(exp_ratio * shares_adj) / sum(shares_adj)  # value-weighted
```

## Merging Ownership with Meetings/Events

Use an as-of merge: for each event (by permno + recorddate), find the most recent ownership quarter:

```python
# pandas merge_asof
ownership = ownership.sort_values(['permno', 'rdate'])
events = events.sort_values(['permno', 'recorddate'])
merged = pd.merge_asof(
    events, ownership,
    left_on='recorddate', right_on='rdate',
    by='permno', direction='backward'
)
```

## ETL Performance Notes

### 13-F Institutional Ownership (S34)

**Recommended approach:** PostgreSQL with per-year server-side CTEs. Each year's CTE joins s34type1 + s34type3 + CUSIP mapping and aggregates to permno-quarter, returning ~30–50K rows. Total: 674K rows in 5.2 minutes for 2002–2024.

**Key settings:** `SET work_mem = '256MB'` and `SET statement_timeout = '3600s'` before querying.

**Anti-pattern:** Downloading raw s34type3 holdings locally — recent years (2020+) have millions of rows and can OOM the compute node.

### Mutual Fund Holdings (S12)

**Recommended approach:** SAS with SGE parallelism + PostgreSQL for bulk reads. The MFLINKS join chain (fundno → wficn → crsp_fundno → portnomap) creates large intermediates that PostgreSQL cannot store (read-only, no temp tables), so SAS handles the ETL. But the initial S12 read uses PostgreSQL to avoid NFS contention.

**Working pipeline:** `examples/voting_ownership_pipeline/` in the WRDS skill — see `README.md` for architecture, `run_pipeline.sh` for orchestration.

**Pipeline pattern:**
1. SAS: Build mfl2/mfl3 prereqs (`build_mflinks.sas`, ~1 min)
2. SAS: Read S12 via PostgreSQL, write year-range partitions to /scratch (`split_s12.sas`, ~15 min)
3. SAS: 9 parallel SGE jobs reading /scratch partitions (`tfn_holdings_parallel.sas`), each doing MFLINKS join + CUSIP→PERMNO + TSO + permno-quarter aggregation → small `mf_own_YYYY_YYYY.sas7bdat`
4. SAS: Merge all outputs (`merge_panel.sas`)

**NFS contention:** `tfn.s12` is 44GB on NFS. Running 7+ parallel SAS jobs reading it causes each to take ~40 min instead of ~5 min. The `split_s12.sas` step reads via WRDS PostgreSQL (`tr_mutualfunds.s12`) — a single sequential read through the database, no NFS contention. Partitions total ~40GB on /scratch (check quota before running).

**Year range balancing:** S12 data exploded from ~4M rows/year (2003-2016) to ~20-26M rows/year (2018-2024). Year ranges must be balanced by row count, not year count: 2003-2010 (34M), 2011-2016 (27M), 2017-2018 (30M), then 1 year each for 2019-2024 (~22-27M each).

**PostgreSQL schema mapping:** SAS `tfn.s12` → PostgreSQL `tr_mutualfunds.s12`. SAS `tfn.s34` → PostgreSQL `tr_13f.s34`. Connection via `PROC SQL; CONNECT TO POSTGRES (server='wrds-pgdata-ident-w.wharton.private' port=9737 ...)`. Credentials in `~/.pgpass`.

**Critical lesson:** SAS must aggregate to permno-quarter before outputting. If SAS outputs raw fund-level holdings (millions of rows, 1–12GB per chunk), Python will OOM reading the SAS7BDAT files.

**Why PostgreSQL fails for the full S12 ETL:**
- Read-only: cannot `CREATE TEMP TABLE` for the MFLINKS chain
- Full join query (s12 × mflink2 × mflink1 × portnomap) is too complex for the query planner
- But PostgreSQL works well for the initial bulk read with server-side WHERE filtering

See `postgres-vs-sas.md` for the full decision framework.

## Common Gotchas

1. **Vintage dates** -- s34type1 has multiple fdate per rdate (restatements); keep the earliest fdate.
2. **First/last report flags** -- track gaps in 13-F reporting; useful for clean time-series analysis.
3. **CUSIP is historical** -- map through `crsp.msenames.ncusip`, not the current CUSIP.
4. **IOR > 1 — two distinct root causes; treat accordingly.**
    - **(a) Timing mismatch** (benign, small): 13-F quarter rdate vs CRSP shrout-date offset by a few weeks around splits/issuances. Cap at 1.0 or filter `IOR > 1.2`.
    - **(b) cfacshr units mismatch** (systematic, can produce 100-2000% IOR): when combining a cfacshr-adjusted numerator with an as-reported denominator. `IO_TOTAL` in the build_inst_own pipeline is `sum(shares × cfacshr)` — cumulatively adjusted to today. If you divide it by ISS `outstandingshare` (as-reported at meeting date, pre-split for split-era meetings), you get impossible values. AAPL 2014: `IO_TOTAL = 15.25B` (cfacshr=28× applied) / `tso_iss = 892M` = 1708%.
        - **Fix:** use `TSO = shrout × 1000 × cfacshr` as the denominator (matches IO_TOTAL's convention). The standard `IOR_crsp` from build_inst_own.sas is correct.
        - If you need **company-wide** IOR (across share classes) for dual-class firms, aggregate to `permco` before dividing. See `crsp.md` §Dual-class.
    - **(c) Dual-class per-class numerator** (systematic): 13F reports per CUSIP. For STZ, BRK.B, GOOGL etc., a single-permno `IO_TOTAL` covers only one share class while ISS `outstandingshare` is company-wide. Fix: sum IO_TOTAL across all permnos sharing a permco before dividing.
5. **S12 data coverage** -- starts ~2003, drops off in 2024; check year-by-year counts.
6. **Deduplication — critical** -- after all joins, dedup by `(wficn, crsp_portno, crsp_fundno, rqdate, cusip8)`. If you dedup by `(fundno, ...)` instead of `(wficn, ...)`, you will inflate shares ~3-4× because one wficn maps to multiple crsp_fundno (share classes). **This bug existed in a stale SAS build and produced MF_TOTAL values ~3.95× higher than correct.**
7. **CRSP adjustment factors** -- align `cfacshr` at the vintage date (fdate), not the report date.
8. **mflink2 vs mflink1** -- mflink2 has rdate for date-aligned joins; mflink1 is static mapping with wficn and crsp_fundno.
9. **portnomap date ranges** -- always filter rdate between begdt and enddt.
10. **exp_ratio sentinel** -- value of -99 means missing in `crsp.fund_fees`; replace with NULL.
11. **Cartesian multiplicity risk in mfl3** -- `mfl3 = mfl2 × mflink1` is a cartesian expansion on wficn. `mflink1` has **mean ~3.5 crsp_fundno per wficn (1-101 range)**. Each s12 holding gets multiplied into N rows downstream. The `proc sort nodupkey by wficn rqdate cusip8` MUST run after aggregation or shares inflate.
12. **Bridge coverage is structurally limited (MFLINKS is US-centric)** -- `mfl.mflink2` only bridges ~**12% of tfn.s12 fundno globally** (e.g., 7,330 of 59,450 at 2022-12-31) because MFLINKS links Thomson S12 ↔ CRSP Mutual Fund Database, which is US-centric. Even filtering s12 by `country='UNITED STATES'` (which in s12 appears to reflect the manager/advisor's country rather than fund domicile — it includes UCITS and global funds run out of US), coverage rates are:
    - **Pre-2017**: ~77% of US-country funds bridged
    - **2017 onward**: drops to **~58-66%** (S12 added ~5k more US-country funds from 2016→2017 that MFLINKS did not grow to match)

    The unbridged ~40% post-2017 is **not ETFs specifically** (ETF name-match share is ~2.4% in both bridged and unbridged). The real pattern: **CRSP Mutual Fund Database covers open-end traditional mutual funds; MFLINKS inherits that limit.** Large unbridged US-country funds cluster in categories CRSP does NOT cover:
    - **Closed-end funds** (e.g., Cohen Steers TaxAdv Pref $110B, Nuveen Quality Pref $69B)
    - **Variable annuity separate accounts** (CREF Stock Account $104B, VIT products)
    - **UCITS / Luxembourg-domiciled funds** (Vanguard SP 500 UCITS $33B; `country='UNITED STATES'` reflects manager, not domicile)
    - **Sub-advised wrapper products** (Fidelity Strategic Advisers family)
    - **Pension-only products** (JFM Tracker Pension $40B)
    - **Some ETFs** — mixed (e.g., QQQ unbridged, iShares SP500 bridged; no systematic ETF exclusion)

    Bridge rate is also strongly correlated with fund SIZE:
    - $10B+ funds: 80% bridged
    - $100M–$1B: 68%
    - $10–100M: 56%
    - <$10M: 30–46% (tiny funds often below CRSP's coverage threshold)

    Implications:
    - For US MF ownership analysis pre-2017: MFLINKS is reasonably clean
    - For post-2017 analysis: expect ~40% of "US country" s12 funds unbridged; report coverage alongside MF aggregates
    - For global analysis: build your own bridge (by fund name, ticker, or manager ID)
13. **passive_pct 100× scaling in `pass.sas7bdat`** -- `1-make.sas` line 705 multiplies `PASSIVE_PCT` by 100 when merging `index_own` into the panel. If `index_own.PASSIVE_PCT` is already in percent scale (0-100) rather than fraction (0-1), the stored value ends up at 0-10000 scale. Always inspect `describe()` after loading; divide by 100 if max > 100.

---

## Known Data Defects (WRDS research notes + measured)

WRDS publishes its S12/S34 defect notes at
[Manuals and Overviews → LSEG → Mutual Fund and Investment Company](https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/lseg/mutual-fund-and-investment-company/)
(institutional auth required). The notes are filed under Thomson Reuters, Refinitiv, and
LSEG interchangeably — same feed, three vendor names, `tfn` libname throughout.

**Detectors for every defect below:** `skills/wrds/scripts/ownership_dq.py`.
**Tests:** `tests/ownership_dq_test.py` (stdlib only — `uv run python3 tests/ownership_dq_test.py`).

### D1. Split adjustment is wrong around split dates — the big one

**Source:** *Note on Splits in TR Mutual Funds and 13F: S12 and S34*, WRDS Research,
March 7 2017.

The note's running example is **permno 14593 (Apple)** — the same firm where our panel
breaks. Documented failure modes:

| Case | What Thomson reports | What is correct |
|------|---------------------|-----------------|
| Double adjustment | 226,331 = 4,619 × 7 × 7 | 32,333 = 4,619 × 7 |
| Adjustment at the wrong date | MasterCard shares adjusted at 2013-12-31, before the 2014-01-21 ex-date | adjust at ex-date |
| Compounded on carry-forward | stale rows re-adjusted each vintage | adjust once |

**This is primarily an S12 finding.** Every worked example in the note is drawn from
mutual-fund data — "These cases are selected from Mutual Fund data, though the 13F data
demonstrate similar patterns" — and funds fare *worse* than 13Fs at large splits:

| Split factor | Mutual funds | 13F |
|---|---|---|
| 2 | 12.2% | 13.3% |
| 3 | 15.2% | 14.8% |
| 4 | 35.1% | 32.4% |
| >4 | **40.7%** | 34.5% |

Around split quarters generally, outlier rates run **13.8% at Qtr(0) and 14.1% at Qtr(−1)
for 13Fs** (12.9% / 11.5% for funds) against a 5% null. The note's own tests rule out the
obvious explanations: restricting to `rdate == fdate` (no carry-forwards) does *not*
help, and neither does restricting to splits whose ex-date and record date share a
quarter.

**WRDS's own conclusion: there is no clean systemic fix.** Their suggestion is to trim or
winsorize Qtr(−1), Qtr(0), Qtr(+1) around each split.

**This explains measured finding #1** — the AAPL 4.5× swing with a flat owner count.
AAPL's split ex-dates (2014-06-09, 7:1; 2020-08-31, 4:1) both fall in Jun/Sep quarters,
and a handful of catastrophically over-adjusted quarters is enough to move a 23-quarter
mean by 4.5× while the set of reporting managers never changes. The owner count is flat
because the filers are all still there — only the share *units* are wrong.

**Consequence for the build:** repairing `HAVING fdate = MIN(fdate)` vintage selection
alone will **not** fix this. The defect is in Thomson's pre-adjustment of `shares`, not in
which vintage you pick. Winsorizing split-adjacent quarters is the documented mitigation;
sourcing post-2013 holdings from EDGAR 13F is the alternative.

### D2. FDATE vs RDATE — and a contradiction between two WRDS documents

- `RDATE` = report date, the date the holdings are actually valid for.
- `FDATE` = **vintage** date; the primary key for table joins and the date Thomson's
  share adjustments are made *to*.

*WRDS Overview of Thomson Reuters Mutual Fund and Investment Company Data* is explicit:
"SHARES values are adjusted for stock splits that occur between the linked RDATE and
FDATE… the pre-adjustment may not be correct in all cases." The May 2017 S34 note agrees:
"Thomson's FDATE is a vintage date, and is used primarily for share adjustments using
CRSP cumulative share adjustment factors."

⚠️ **The splits note contradicts both.** Its table legend reads "Column 1 is the vintage
date of the holding data, Rdate… Column 2, Fdate, is the date when holdings are valid" —
exactly backwards. The Overview and the S34 note agree with each other and with the
observed data, so **FDATE = vintage** is the reading to use; the splits note's legend is
an error in the note. Recorded here because acting on the splits note's legend inverts
your join and silently produces the D1 defect on purpose.

### D3. Coverage collapses after ~2013, then again in 2019

**Source:** *Research Note Regarding Thomson-Reuters Ownership Data Issues*, May 2017.

- **Stale and dropped filers.** BlackRock (mgrno 9385) carried forward stale from 2013Q3,
  then **entirely missing 2014-06 through 2015-03**, then returned at $48B against a true
  ~$700B+. Fixed in the 2018 regeneration.
- **Excluded securities.** ~30% of the universe / ~15% of market cap dropped after June
  2013; **all ETFs gone by 2015**. Do not use S34 for ETF holdings, ever.
- **AAPL specifically: zero institutional owners from 2015-06-30 onward** in the vintage
  current at that time — and the 2014-06-30 row jumps 516,786,227 → 3,665,520,154, the
  unadjusted 7:1 split (D1 again).
- Aggregate error: 2015 institutional ownership is 58.25% in S34 against 71.8% in the
  actual 13F filings — **19.4% of total institutional ownership missing**.

**Feb 2022 note** (*Thomson/Refinitiv Data Issues 13F (S34) and Mutual Fund Holdings
(S12)*): 13F holdings largely missing in **2019Q3–Q4** — filers per stock fell from 1,500+
to under 500 for AAPL/IBM/MSFT; 1,386 of 12,224 stocks lost >10% of institutional
ownership, median −48%. Also flags **2011-03 to 2013-03** as significantly incomplete
(consistent with the Koijen–Yogo footnote). WRDS froze the web query at 2019Q2 and moved
later data to `/wrds/tfn/sasdata/s34/incomplete`.
**April/August 2022 notes:** Refinitiv patched 2019Q3–Q4 and the S12 2017Q4/2019Q4 gaps.
Pre-2011 issues are **permanently unfixable** — "the data vendor no longer provide the
support for the vintage raw data."

→ Detector: `detect_owner_dropout` (owners collapse = feed defect) as opposed to
`detect_flat_owner_share_swing` (owners flat = units defect). Run both; the pair
*classifies* the break.

### D4. 2010–2016 was regenerated; an archive of the corrupt data exists

**Source:** *S12/S34 Regenerated Data (2010–2016)*, June 2018. Thomson's legacy systems
were "losing and corrupting data" from 2010. The regenerated data is in `/wrds/tfn/sasdata`;
the corrupted original is preserved at **`/wrds/tfn/sasdata_archive`** — use it to
reconcile against results published before 2018. Residual known issues: S12TYPE8 lost a
third of its coverage after 2013; a 2014 mutual-fund ownership blip (29%→35%→30%) likely
from double-counted funds; S34TYPE2 still excludes ~$1T of CRSP securities; a 5% ownership
drop at the 2010-12→2011-03 feed migration.

### D5. S12 feed change at 2017Q4 — a coverage *increase* that looks like a defect

**Source:** *Thomson/Refinitiv Data Feed Change from Legacy SP to Strategic Collection in
S12*, 2023-01-24. From 2017Q4 the S12 feed switched from legacy SP to "strategic
collection", backfilled in 2022Q4. **CUSIPs in fund holdings +613%, unique funds +113%,
fund-CUSIP observations +265%**, and 34,385 funds appear that did not exist in the old
feed. Cause: overseas holdings, ADRs, preferreds and bonds got CUSIPs assigned that the
legacy feed lacked — it is a genuine coverage expansion, not corruption. But any
level-comparison spanning 2017Q4 is invalid, and **MFLINKS was not backfilled** for
2017Q4–2020Q2, so `wficn` bridge rates drop precisely there. WRDS's own advice is to use
Factset or CRSP to identify US equity funds over that window.

This corroborates the measured MFLINKS bridge-rate cliff (§Common Gotchas #12: ~77%
pre-2017 → ~58–66% after).

→ Detectors: `detect_coverage_step` (counts step while values do not — the signature of a
feed migration, and it fires in both directions so it also catches the 2019Q3–Q4 S34
contraction) and `detect_bridge_rate_regression` (a join that quietly stops matching).

### D5b. S12 duplicate reporting

The June 2018 note attributes the 2014 mutual-fund ownership blip (29% → 35% → 30%) to
funds being **listed twice**. Separately, `fundno` is frequently a *share-class*
identifier rather than a fund: one `wficn` maps to a mean ~3.5 `crsp_fundno`, so
deduplicating on the wrong key inflates `MF_TOTAL` by **~3.95×** (§Common Gotchas #6).
Both are the same class of defect — a grain that is not unique where the code assumes it
is — and neither is visible in a spot check.

→ Detector: `detect_duplicate_grain`, which reports the resulting inflation factor rather
than just a duplicate count.

### D6. 13F `value` units change at 2023Q1 — measured, NOT documented by WRDS

Form 13F `value` moves from thousands to whole dollars. Measured on the EDGAR panel:
mean value per holding 152,644 (2022Q4) → 12,794,119 (2023Q1); **median 442×, p90 494×,
p10 only 38×**.

The break is **not a clean 1000×**. The post-2023Q1 population is mixed — filers converted
on different schedules — so **no scalar repairs it**, and any sum or average of `value`
spanning 2023Q1 is meaningless. Note the legacy S34 spec still labels the field
"Holding Value (x$1000)".

**No WRDS note documents this.** The gap is itself worth knowing: the S12/S34 defect notes
stop at the 2023 S12 feed change and say nothing about 13F value units. Treated as a
source property to detect and refuse to aggregate across, not to repair.

→ Detector: `detect_unit_discontinuity`, which reports `clean_break=False` when the
quantile shifts disagree — the signal that rescaling is not an option.

### D7. Encoding-driven silent parse failures — measured, parser-side

Windows-1252 filings parsed to **zero** holdings rows: 7,023 filings / 2,628,463 rows /
768 institutions across all 38 quarters, with a **3.47× step at 2023Q3** (5.54% of
holdings dropped after vs 1.60% before), concentrated by filing agent. Now fixed, but the
class recurs with any new vendor encoding — a parser that yields nothing is
indistinguishable from a filer that held nothing.

→ Detector: `detect_zero_row_cohort`, grouped by encoding *or* filing agent, with
per-period rates so a time-varying step is visible rather than averaged away.

### Cross-check: EDGAR 13F is clean where Thomson is not

Same firm (AAPL), EDGAR `13F-HR` / `shares_type=SH` / no amendments: quarterly variation
of a few percent, filer counts monotone, and the 2020 4:1 split appearing exactly once and
correctly unadjusted (2.59bn → 9.70bn at 2020Q3). The defect is Thomson's, not the
concept's. Thomson's remaining advantage is history: it starts 1980, EDGAR electronic
filings start 1999 and XML only in 2013.


---

### D8. Your own date arithmetic — the defect that imitates a vendor defect

**Not a WRDS issue at all.** Recorded here because it cost weeks of misattribution: the
symptom is indistinguishable from D1 (Thomson's split double-adjustment), and it was
blamed on Thomson before being traced home.

polars' `dt.month()` returns **Int8**. The ubiquitous date-key idiom

```python
pl.col("date").dt.year() * 10000 + pl.col("date").dt.month() * 100 + pl.col("date").dt.day()
```

overflows for every month ≥ 2 — `2 * 100 = 200 > 127` — and wraps **negative**, silently.
Only January survives:

| date | produced | correct |
|---|---|---|
| 2020-01-31 | 20200131 | ✓ |
| 2020-02-29 | 20199973 | 20200229 |
| 2020-03-31 | 20200075 | 20200331 |
| 2020-12-31 | 20199951 | 20201231 |

A quarter-snap downstream read `20199973` as "month 99" and `20200075` as "month 0",
bucketing them into Q4-of-the-prior-year and Q1. The CRSP reference panel ended up
holding **only March and December** quarter-ends: 193,335 rows where 370,630 were
correct.

**What made it expensive is that nothing raised.** The output was a full-looking table of
plausible eight-digit integers. Every June and September holdings quarter missed the
join, fell back to `cfacshr = 1` and a null denominator, and produced `ior = 0` for
**49% of the panel** — while March and December carried 4× and 28× split factors. Net
effect on AAPL: quarter means of 1.41e10 / 3.11e9 / 3.31e9 / 1.41e10 with `numowners`
flat at ~2,200, because owner counts do not depend on `cfacshr` so only the shares moved.
That is exactly the D1 signature.

**Fix:** cast before the multiply, and cast back afterwards if a downstream frame is
typed Int32 (`vstack` raises on a widened type).

```python
(pl.col("date").dt.year().cast(pl.Int64) * 10000
 + pl.col("date").dt.month().cast(pl.Int64) * 100
 + pl.col("date").dt.day().cast(pl.Int64)).cast(pl.Int32)
```

`dt.quarter()` is Int8 too — the same trap caught the *comparison script written to check
this very bug*, which is a fair measure of how easy it is to hit.

**Guard, do not eyeball.** Assert bucket coverage on every reference panel at build time,
and assert it again on load — a cached input accepted without a coverage check is how a
March/December-only panel survived into production.

→ Detectors: `detect_calendar_bucket_gap` (run it on the **reference table**, where it
catches the root cause; it is silent on the output panel, whose holdings side was always
complete) and `detect_join_gap_clustering` (run it on the **output**, where the null rate
for the joined column was 100% in Jun/Sep against 53% in Mar/Dec — a 47.5% spread that
collapsed to 0.9% after the fix). Note the *level* of the null rate is not the signal:
~54% is correct and expected, because 13F legitimately holds ADRs and closed-end funds
with no CRSP common-stock match. The **spread across buckets** is the signal.

### D9. Held shares exceeding shares outstanding — open, in EDGAR 13F

Surfaced by `detect_impossible_ratio` on the rebuilt EDGAR panel: **7.0% of non-zero
observations exceed 100% ownership, 2.9% exceed 120%**, concentrated in the pre-XML
`parse_mode = "text"` era. AAPL 2003-09-30 shows 4.90e10 shares held against 2.05e10
outstanding (239%), bracketed by quarters at a sane 45% and 60%.

The aggregation sums `shares` within `(cik, cusip8, rdate)`, so duplicate rows *inside* a
single accession inflate rather than deduplicate. Candidate causes not yet separated:
text-parser row duplication, one manager filing under multiple CIKs, and 13F
double-counting proper — `investment_discretion` (SOLE/DFND/OTR) and `other_manager`
exist precisely so shares reported by both a sub-advisor and its parent are not counted
twice, and the current build ignores both.

Worth knowing: **vendor panels often clip this ratio at 100%, so the defect is invisible
in them.** A panel built from raw filings does not clip, which is why the violations are
visible and countable here. Do not read the clip as cleanliness.

## The S12 alternative: `crsp.holdings` (verified on the WRDS grid)

**S12 does not need an EDGAR/N-PORT parser.** WRDS already carries CRSP Mutual Fund
portfolio holdings, and it dominates Thomson S12 on every axis that matters. Verified
directly against `crsp_q_mutualfunds.holdings` (PG) / `/wrds/crsp/sasdata/q_mutualfunds/holdings.sas7bdat`:

| Property | Thomson S12 | `crsp.holdings` |
|---|---|---|
| Coverage | ~2003 → 2024-12-31 (mirror) | **2001-12-31 → 2026-03-31** |
| Rows | — | ~450M (131 GB) |
| Frequency | quarterly (N-Q / N-CSR) | **monthly** (N-PORT) |
| Security id | CUSIP → needs `msenames` join | **`permno` and `permco` pre-mapped** |
| Fund id | `fundno` → MFLINKS chain | `crsp_portno` → `portnomap` directly |
| Share adjustment | pre-adjusted to FDATE, **incorrectly** (D1) | **as-reported, unadjusted** |

Columns: `crsp_portno, report_dt, security_rank, eff_dt, percent_tna, nbr_shares,
market_val, crsp_company_key, security_name, cusip, permno, permco, ticker, coupon,
maturity_dt`.

### Why this resolves D1 for S12

`nbr_shares` is **as-reported at the report date and not back-adjusted** — the same
property that made EDGAR 13F a clean S34 replacement. Verified on AAPL (permno 14593)
across the 2020-08-31 4:1 split:

| report_dt | n_funds | total shares |
|---|---|---|
| 2020-07-31 | 1,168 | 807,880,873 |
| 2020-08-31 | 1,142 | 3,109,430,371 |

A 3.85× step with the fund count *flat* — the split appearing exactly once, unadjusted,
as it should. There is no cumulative pre-adjustment, so there is nothing to double-apply.
Apply `cfacshr` yourself, once, at a date convention you control.

### It also removes the MFLINKS dependency

Holdings key on `crsp_portno`, so the `fundno → wficn → crsp_fundno → crsp_portno` chain
disappears. That eliminates **D5's bridge-rate cliff** and **D5b's ~3.95× share-class
dedup inflation** at the source, rather than detecting them after the fact.

### ⚠️ The one trap: quarter-end months carry a different fund population

`report_dt` is monthly, but **not every fund reports every month**. From the AAPL check:
quarter-end months carry ~1,600 funds, intermediate months ~1,140 — roughly **40% more
funds at quarter-ends** — and total shares run ~1.2–1.4× higher at quarter-ends as a
result.

That is a *benign cadence effect*, not a defect, and `detect_seasonal_alternation` does
**not** flag it at the 1.5× default — correctly, since alarming on N-PORT's reporting
rhythm would cry wolf on every fund panel. (Lower `ratio_threshold` to ~1.3 and it becomes
visible.) The contrast is the point: the Thomson defect runs **4.5×**, far above this, so
one default cleanly separates a real defect from normal cadence.

It is still large enough to contaminate a regression that mixes cadences.
**Filter to quarter-end months for a quarterly panel.** Do not treat intermediate months
as comparable observations.

### Recommendation

| Era | Source |
|---|---|
| 2001-12 → present | **`crsp.holdings`**, quarter-end months only |
| pre-2001-12 | Thomson S12, winsorized at split quarters (D1) — the only source |

Never compare levels across 2017Q4 if Thomson is in the series (D5). Cross-checking
Thomson against CRSP over the overlap is worthwhile, but expect a gap rather than a
match: per the Jan 2023 note, CRSP sources monthly N-PORT while Thomson sources quarterly
N-Q/N-CSR, so holdings "should be close, but not exact."

---

## Coalescing S12 into `crsp.holdings` at the holding level

Use `crsp.holdings` as primary and Thomson S12 as *additive* coverage, merged at the
individual fund-holding grain. Aggregate-level coalescing is not safe — the two sources
differ in share units (D1), fund population, and filing basis, so a filled series
confounds source with signal.

### The bridge is the constraint, and it is not fixable by better identifiers

S12 `fundno` → `crsp_portno` (via `mflink2` → `mflink1` → `portnomap`), measured:

| Quarter | S12 funds | Bridged | Rate |
|---|---|---|---|
| 2010-12-31 | 7,494 | 3,647 | 48.7% |
| 2016-12-31 | 14,427 | 4,982 | 34.5% |
| 2022-12-31 | 60,136 | 7,325 | **12.2%** |

**Thomson S12 carries no CIK** — there is no SEC identifier anywhere in the
`tr_mutualfunds` schema, so a CIK bridge is impossible. The only exact alternative key is
`s12type8.fticker`, and it is a dead end twice over: the table **ends 2018-12-31**, and
where it does exist it is almost entirely redundant with MFLINKS:

| Quarter | MFLINKS | Ticker | **Incremental** | Combined |
|---|---|---|---|---|
| 2010-12-31 | 48.7% | 38.3% | **+17 funds** | 48.9% |
| 2016-12-31 | 34.5% | 19.1% | **+71 funds** | 35.0% |
| 2018-12-31 | 15.7% | 6.6% | **+218 funds** | 16.2% |

That redundancy is the important result: **the unbridged mass is not unbridged for want
of an identifier — those funds are simply not in CRSP.** Expect fuzzy name matching to
fail for the same reason, and scope it accordingly (below).

### The 12% headline is misleading — split by domicile

| 2022-12-31 | Funds | Bridged | Unbridged |
|---|---|---|---|
| non-US | 48,355 | **0.3%** | 48,210 — CRSP never covered these; **safe to add** |
| US | 11,829 | **60.7%** | **4,649 — genuinely ambiguous** |

(2016-12-31: non-US 2.0% bridged; US 78.5%, 1,321 ambiguous.)

True double-count exposure is **~7.7% of funds**, not 88%.

### Recipe

Classify every S12 fund into exactly one of three buckets, then merge:

| Bucket | Rule | Action |
|---|---|---|
| `crsp` | bridges to a `crsp_portno` | take the **CRSP** holding — as-reported shares, `permno` pre-mapped |
| `s12_additive` | unbridged **and** positively CRSP-excluded (non-US `country`, closed-end, VA separate account, UCITS) | take the **Thomson** holding |
| `s12_ambiguous` | unbridged, US-domiciled, no positive classification | **exclude by default; report the mass** |

Non-negotiables:

1. **Normalize share units before merging, never after.** CRSP is as-reported; Thomson is
   pre-adjusted to FDATE and wrongly so (D1). Apply `cfacshr` yourself, once, to the
   merged column. Merging raw `shares` mixes units inside one column and manufactures the
   exact discontinuity `detect_unit_discontinuity` exists to catch.
2. **Winsorize split quarters on `source='s12'` rows only.** D1 is a Thomson defect; CRSP
   rows do not need it and winsorizing them discards real data.
3. **Dedup after bridging, at the `wficn`/`crsp_portno` grain — never `fundno`.** One
   `wficn` maps to a mean ~3.5 `crsp_fundno`; the wrong key inflates ~3.95× (D5b).
   Verify with `detect_duplicate_grain`.
4. **Carry a `source` column into the output.** A merged panel that cannot say where each
   row came from cannot be audited, and every check below needs it.

→ Guard: `detect_unresolved_overlap` reports the ambiguous mass and fails above 5%. Run it
per period — exposure grows over time as S12's non-US population expands.

### Where fuzzy name matching is worth it

Not against all 48K unbridged funds — they are not in CRSP and no matcher will find them.
Point it **only at the ~4,649 US-domiciled unbridged funds**, matching
`s12type1.fundname` / `mflink2.fundname_full` against `portnomap.fund_name` + `mgmt_name`.
That is a small, high-value problem: every fund it resolves moves a row out of
`s12_ambiguous` and shrinks the union's error term. See the `fuzzy-name-matching` skill.

### Fuzzy name matching: calibrated, and worth doing

Use **`S12_Full_Fund_Names`** (the `S12_Names_20250630.xlsx` on the WRDS index page:
`FUNDNO, START_DATE, END_DATE, FUNDNAME`, ~238K date-bounded rows), **not**
`s12type1.fundname`. The latter is truncated to 24 chars and abbreviated; the xlsx carries
the full and sometimes wholly different canonical name. It covers **95.1%** of the
ambiguous funds and is strictly longer for **92.0%** of them:

| `s12type1.fundname` | xlsx `FUNDNAME` |
|---|---|
| `FIDELITY CNDN GROWTH CO` | `FIDELITY CANADIAN GROWTH COMPANY FUND` |
| `HERZFELD CARIBBEAN BAS F` | `HERZFELD CARIBBEAN BASIN FUND INCORPORATED` |
| `DIVERSIFIED INV-BALANCED` | `TRANSAMERICA PARTNERS BALANCED PORTFOLIO` |

Calibration at 2022-12-31 — char_wb 2-4gram TF-IDF + cosine, top-1, against
`portnomap.fund_name` (55,213 candidates), with **non-US unbridged funds as a negative
control** (they bridge at 0.3%, so a "match" there is a false positive):

| Threshold | False-positive rate | Ambiguous resolved | Implied precision |
|---|---|---|---|
| 0.70 | 3.9% | 51.3% | ~92% |
| **0.80** | **1.2%** | **32.5%** | **~96%** |
| 0.90 | 0.4% | 13.7% | ~97% |

**Always calibrate against a negative control, not against ground truth alone.** Top-1
accuracy measured only on funds that bridge is 92.4% at 0.90 — but every fund there has a
true match by construction, so that figure cannot transfer to a population where most
funds have none. The negative control is what makes the precision estimate honest.

⚠️ **These are *implied* precisions, and implied is not end-to-end.** The negative control
proves a match is not spurious; it does **not** prove the match went to the *right* fund.
End-to-end ("combined") precision is `implied × top-1 accuracy`, and the follow-up
investigation measured top-1 directly: at thr 0.80 the direct-to-`portnomap` route has
top-1 accuracy ~0.92, so combined precision is **~0.89, not ~0.96**. Quote combined
precision when deciding whether to admit a match.

**Superseded — use the SEC series-ID route instead.** Routing the name match through the
SEC's published series universe (then `series_cik → crsp_fundno` via `crsp_cik_map`)
resolves **4.5× more of the ambiguous set at equal precision**: 26.5% vs 5.9% at combined
precision ~0.95, replicated at 2017. It is still fuzzy at the first hop — S12 has no CIK
or usable ticker, so no exact key exists — and the gain comes from **grain alignment**:
SEC series names sit at portfolio grain, the same grain as an S12 fund, whereas
`portnomap.fund_name` is share-class grain. Ambiguous mass falls 7.72% → 5.70%.

See `docs/investigations/2026-07-26_mflinks-rebuild.md` and
`skills/wrds/scripts/mflinks_sec_bridge.py` (PR #78). Holdings-content matching was tested
and **rejected**: it plateaus at 79% top-1 — a portfolio is not a fingerprint.

### ⚠️ Resolving a fund is not the same as being allowed to add it

**27.4% of newly-resolved funds land on a `crsp_portno` that another bridged `fundno`
already claims.** That is a live double-count: two S12 `fundno`s pointing at one CRSP
portfolio, either because the resolution is wrong or because Thomson carries the same
portfolio twice (share classes, or duplicate records — cf. D5b).

So the bridge needs a **claim check**, not just a match score. After resolving, group by
`crsp_portno` and assert one `fundno` per portfolio per period; on collision, keep the
higher-confidence link and push the loser back to `s12_ambiguous` rather than admitting
both. Verify with `detect_duplicate_grain(grain=("crsp_portno", "rdate"))` on the resolved
map — a bridge that raises coverage while quietly doubling portfolios is worse than no
bridge at all.
