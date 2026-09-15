---
name: wrds
version: 1.0
description: Use when "query WRDS", "pull SEC filings", "access Compustat/CRSP/ExecuComp/Capital IQ", "Form 4 insider data", "13F institutional ownership (Thomson)", "13D/13G blockholders", "ISS governance/compensation/voting/directors", "proxy advisor recommendations", "TAQ intraday/NBBO", "SDC M&A or new issues", "DealScan syndicated loans", "PitchBook PE/VC deals", "FISD corporate bonds", "municipal bonds / muni trades / MSRB RTRS / SDC municipals", "Form D/ADV", "fund formation", "FJC court data", "linking datasets / join keys (gvkey-permno via CCM, cik-gvkey via wciklink, DealScan-Compustat)", or any WRDS PostgreSQL query or SAS ETL on the WRDS grid (qsub/qsas/SGE).
user-invocable: false
---

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

> **Building a proxy-voting panel?** Use the **`npx-ownership-panel`** skill, not
> this one. It owns `risk.voteanalysis_npx` (238M rows / 329 GB), the ISS->CRSP
> fund crosswalk, and the four-leg SGE pipeline that produces the analysis-ready
> panel. This skill covers WRDS access patterns generally.

## Contents

- [WRDS Login Node Enforcement](#wrds-login-node-enforcement)
- [Query Enforcement](#query-enforcement)
- [SAS ETL Enforcement](#sas-etl-enforcement)
- [Quick Reference: Table Names](#quick-reference-table-names)
- [Connection](#connection)
- [Critical Filters](#critical-filters)
- [Parameterized Queries](#parameterized-queries)
- [Additional Resources](#additional-resources)

## WRDS Login Node Enforcement

### IRON LAW: NEVER RUN COMPUTE ON THE WRDS LOGIN NODE

<EXTREMELY-IMPORTANT>
The WRDS login node is shared infrastructure. Running parsers, bulk file reads, SAS jobs, or any process taking >30 seconds on the login node will get the account flagged.

**ALWAYS** write an SGE submission script and submit via `qsub`. No exceptions.

- `ssh wrds 'cat files.tsv | ./parser > output.tsv'` → **WRONG. Use qsub.**
- `ssh wrds 'nohup ./process &'` → **WRONG. Still the login node. Use qsub.**
- `ssh wrds 'python3 bulk_process.py'` → **WRONG. Use qsub.**
- `qsub -t 1-20 submit.sh` → **CORRECT.**

The login node is for: `qsub`, `qstat`, `qdel`, `scp`, `ls`, `head`, short `psql` queries.

Submission patterns and working array jobs: `references/edgar.md` (§ SGE index build), `scripts/sec_index/submit_array.sh`, `scripts/parse_13f/sge/submit_shards.sh`, and `../npx-ownership-panel/scripts/run_pipeline.sh`.
</EXTREMELY-IMPORTANT>

**Running compute on the login node is NOT HELPFUL — it gets the user's account flagged, the job killed, and the work lost.** You run on the login node because qsub feels like overhead. The overhead is 5 minutes of script writing. The downside is account suspension and a rerun from scratch.

### Login Node & Infrastructure Facts

- Tests go through the scheduler too: `qsub -t 1-1 submit.sh`. The login-node "quick test" is the run that flags the account — one file becomes 100K when the command changes, and 173K filings over NFS is not 30 seconds.
- The quorum parser does not run on the login node and never did — it runs via `submit_quorum.sh`. Citing it as login-node precedent is an unverified claim presented as fact.
- The `wrds_clean_filings` path convention is `cik_int.zfill(10)[:6]/{cik_int}/{accession}.txt` (see `references/edgar.md`). Hand-rolled path logic gets this wrong.
- `scan_covers` profiles handle header extraction, body parsing, and custom extractors (`Custom` field type) — "this parser is different enough to need its own binary" has not yet been true once.
- **A pixi/conda env under `/scratch` is not durable.** A grid job that ran fine in August 2026 came back `rc=127` weeks later: the env its submit script hard-coded had been swept, and no interpreter on WRDS had polars any more. Either rebuild the env as a step of the job, or keep the heavy pull on the grid and do the dataframe work locally. Do not hard-code an env path and assume it survives.

### Red Flags — STOP Immediately If You're About To:

- **Write `ssh wrds '... | ./binary > output'`** → STOP. That's login-node compute. Write a submit script.
- **Write `ssh wrds 'nohup ... &'`** → STOP. nohup doesn't change the node. Use qsub.
- **Write `ssh wrds 'python3 ...'` for anything that reads >10 files** → STOP. Use qsub.
- **Skip reading `references/edgar.md` before building a new WRDS file parser** → STOP. The path conventions, SGE patterns, and existing parsers are already documented. Read them first.
- **Create a new standalone Go binary for EDGAR extraction** → STOP. `scripts/scan_covers/` is a generic profile-based framework. Add a `profiles_*.go` file, not a new binary. The framework handles SGE sharding, path construction, concurrency, and form-type filtering.
- **Build a new Go/Python parser without checking `scripts/scan_covers/`** → STOP. This framework exists precisely so you don't reinvent extraction infrastructure. Every standalone parser is technical debt that should have been a profile.

### IRON LAW: USE SCAN_COVERS, NOT STANDALONE BINARIES

<EXTREMELY-IMPORTANT>
Before writing ANY new EDGAR filing extractor:

1. **Read `scripts/scan_covers/`** — generic profile-based Go framework with SGE, concurrency, path handling
2. **Add a `profiles_*.go` file** — not a standalone binary. The Profile struct supports pattern-based fields AND custom extractors (set `FullBody: true` for body-text searches like prospectus 485 filings — see `profiles_proxy_advisors.go`)
3. **Read `references/edgar.md`** — path conventions, existing profiles, SGE submission patterns

**Building a standalone parser when `scan_covers` exists is NOT HELPFUL — it reinvents infrastructure that already handles SGE sharding, NFS concurrency, path construction, form-type filtering, and error handling.** You built a 300-line standalone Go binary, ran it on the login node, got the path convention wrong, and spent 5 iterations fixing it. Adding a 60-line profile to `scan_covers` would have worked on the first try.

Every standalone EDGAR parser is technical debt. The `scan_covers` framework exists to eliminate this class of mistake.

**Exactly two sanctioned exceptions: `scripts/parse_13f/` and `scripts/parse_npx/`.** `scan_covers` `FullBody` reads the whole file into one buffer per worker and its `Field` model reduces a regex to one value per column, so a record table — the 13F `infoTable`, the N-PX `proxyTable` whose nested `voteRecord`s run to tens of thousands in a single filing — is neither; those two stream the record table instead, emitting one row per record: `parse_13f` with a hand-rolled information-table scanner, `parse_npx` with `xml.Decoder`. Cover-page or header extraction is still a profile, with no exception. Their TSV-to-parquet output contract is `scripts/edgar_parquet/` (see `references/edgar.md`).
</EXTREMELY-IMPORTANT>

# WRDS Data Access

WRDS (Wharton Research Data Services) provides academic research data via PostgreSQL at `wrds-pgdata.wharton.upenn.edu:9737`.

## Query Enforcement

### IRON LAW: NO QUERY WITHOUT FILTER VALIDATION FIRST

Before executing ANY WRDS query, you MUST:
1. **IDENTIFY** what filters are required for this dataset
2. **VALIDATE** the query includes those filters
3. **VERIFY** parameterized queries (never string formatting)
4. **EXECUTE** the query
5. **INSPECT** a sample of results before claiming success

This is not negotiable. Skipping sample inspection is NOT HELPFUL — the user builds analysis on data with undetected quality problems.

### Red Flags

- Running a query without checking the Critical Filters section → standard filters apply even when the user doesn't mention them, and even for test queries.
- Pulling everything to filter in pandas later → filter at the database level first.
- Guessing a table name from the request → check the Quick Reference section for exact names.
- Claiming success before sample inspection → inspect `.head()`/`.sample()` first; query success ≠ data quality.

### Query Validation Checklist

Before EVERY query execution:

**For Compustat queries (comp.funda, comp.fundq):**
- [ ] Includes `indfmt = 'INDL'`
- [ ] Includes `datafmt = 'STD'`
- [ ] Includes `popsrc = 'D'`
- [ ] Includes `consol = 'C'`
- [ ] Uses parameterized queries for variables
- [ ] Date range is explicitly specified

**For CRSP v2 queries (crsp.dsf_v2, crsp.msf_v2):**
- [ ] Post-query filter: `sharetype == 'NS'`
- [ ] Post-query filter: `securitytype == 'EQTY'`
- [ ] Post-query filter: `securitysubtype == 'COM'`
- [ ] Post-query filter: `usincflg == 'Y'`
- [ ] Post-query filter: `issuertype.isin(['ACOR', 'CORP'])`
- [ ] Uses parameterized queries

**For Form 4 queries (tr_insiders.table1):**
- [ ] Transaction type filter specified (acqdisp)
- [ ] Transaction codes specified (trancode)
- [ ] Date range is explicitly specified
- [ ] Uses parameterized queries

**For ALL queries:**
- [ ] Sample inspection with `.head()` or `.sample()` BEFORE claiming success
- [ ] Row count verification (is result size reasonable?)
- [ ] NULL value check on critical columns
- [ ] Date range validation (does min/max match expectations?)

## SAS ETL Enforcement

### IRON LAW: NO SAS CODE WITHOUT PERFORMANCE VALIDATION FIRST

<EXTREMELY-IMPORTANT>
Before writing or executing ANY SAS code on WRDS, you MUST validate performance patterns. This is not negotiable.

1. **MERGE STRATEGY** — Is hash or sort-merge appropriate? Justify the choice.
2. **WHERE CLAUSES** — Are all date/string filters index-friendly? No functions on indexed columns.
3. **PARALLELISM** — Can this job run as an SGE array? Year-by-year is always parallelizable.
4. **SQL OPTIMIZATION** — For PROC SQL: pass-through opportunity? Indexed join columns?

Writing SAS code that forces full table scans when indexes exist is NOT HELPFUL — the user's job runs 100x slower than necessary and may timeout.
</EXTREMELY-IMPORTANT>

### SAS Code Validation Checklist

Before EVERY SAS program execution:

**For probing inputs (do this FIRST — metadata only, seconds):**
- [ ] `PROC CONTENTS data=lib.x varnum` on every input — variables, types, **lengths**, formats
- [ ] Index section of the CONTENTS listing read — does the WHERE column actually have an index?
- [ ] Key lengths compared across datasets to be merged (mismatched `$6`/`$8` gvkey = silent zero matches)
- [ ] `PROC SQL; select memname, nobs from dictionary.tables where libname='LIB';` — row counts before committing to the job
- [ ] `PROC PRINT data=lib.x(obs=20); var ...;` — values look like the docs claim (always `obs=`, always `var`)
- [ ] `PROC DATASETS library=scratch;` — inventory intermediates; `delete` there, not via a rewriting DATA step

**For merges/joins:**
- [ ] Small lookup + large fact table → hash object (not `PROC SORT` + `DATA` merge)
- [ ] Hash uses `defineKey`/`defineData`/`defineDone` pattern correctly
- [ ] `h.output()` uses double quotes for macro resolution (not single quotes)
- [ ] `call missing()` initializes hash data variables for non-matches
- [ ] Both tables >50M rows → sort-merge is justified (document why)

**For WHERE clauses (CRITICAL):**
- [ ] **NO** `year(date)`, `month(date)`, `datepart(dt)` wrapping indexed columns
- [ ] Date filters use `BETWEEN "01jan&year."d AND "31dec&year."d` range pattern
- [ ] String filters avoid `upcase()`, `substr()` on indexed columns
- [ ] Compound date filters collapsed to single range (not `year() = X AND quarter() = Y`)

**For batch processing:**
- [ ] Multi-year jobs use SGE array (`#$ -t start-end`) not sequential loop
- [ ] Year passed via `-sysparm` (not `-set` or `%sysget`)
- [ ] Per-year log files (not single shared log)
- [ ] Memory allocation appropriate for workload (`#$ -l m_mem_free=4G` minimum)
- [ ] Single-year benchmark run completed before full array submission

**For PROC SQL:**
- [ ] Join columns are not wrapped in functions
- [ ] `calculated` keyword used for computed column references in HAVING
- [ ] Pass-through SQL considered for direct WRDS PostgreSQL queries
- [ ] No redundant subqueries that could be hash lookups

**For macros:**
- [ ] Macro variables terminated with period (`&year.` not `&year`)
- [ ] Double quotes used where macro resolution is needed
- [ ] `options mprint mlogic symbolgen` used during development

### SAS Performance Facts

- Hash lookup joins are ~10x faster than `PROC SORT` + `MERGE` and need no sorting; PROC SQL still sorts for joins. The hash is 5 extra lines — choosing sort-merge for a lookup join makes the user's job slower for your convenience.
- `year(date)` (or any function) on an indexed column forces a full table scan over millions of rows; `BETWEEN` with date literals uses the index.
- Sequential multi-year jobs run ~18x slower than the SGE array (18 years × 3 minutes = 54 minutes sequential vs 3 minutes parallel) — "I'll parallelize later" is anti-efficient on its own terms.
- Single quotes in `h.output(dataset: '...')` block macro resolution — the output dataset name comes out wrong. Always double quotes.
- `%sysget` is unreliable under SGE — it may return blank silently. Pass the year via `-sysparm` + `&sysparm.`.

### SAS Red Flags - STOP Immediately If You're About To:

- Write `where year(date) = ` anything → STOP. Use `BETWEEN` with date literals.
- Write `proc sort; data; merge` for a lookup join → STOP. Use hash object.
- Write a `%do year = start %to end` loop → STOP. Use SGE array job.
- Use single quotes in `h.output(dataset: '...')` → STOP. Use double quotes.
- Submit a full array job without testing one year first → STOP. Benchmark first.
- Use `-set` or `%sysget` for SGE task parameters → STOP. Use `-sysparm`.

### SAS Reference

See **`references/sas-etl.md`** for complete patterns:
- Probing data and metadata (PROC CONTENTS, PROC DATASETS, PROC PRINT, `dictionary.tables`)
- Hash object merge (basic, multidata, accumulator)
- Index-friendly WHERE clause quick reference table
- SGE array job templates with memory and logging
- PROC SQL pass-through and optimization
- Macro quoting and debugging

## Quick Reference: Table Names

| Dataset | Schema | Key Tables |
|---------|--------|------------|
| Compustat | `comp` | `company`, `funda`, `fundq`, `secd` |
| ExecuComp | `comp_execucomp` | `anncomp` |
| CRSP | `crsp` | `dsf`, `msf`, `stocknames`, `ccmxpf_lnkhist` |
| CRSP v2 | `crsp` | `dsf_v2`, `msf_v2`, `stocknames_v2` |
| Form 4 Insiders | `tr_insiders` | `table1`, `header`, `company` |
| ISS Incentive Lab | `iss_incentive_lab` | `comppeer`, `sumcomp`, `participantfy` |
| Capital IQ | `ciq` (views), `ciq_pplintel`, `ciq_common` | `wrds_professional` (board/professional panel), `ciqcompanyrel` (company-to-company), `wrds_compensation`. **Account-split: `ciq_pplintel` and `boardex_na` are on opposite WRDS accounts; `ciq_transactions` is denied on both.** See `references/capiq.md` |
| BoardEx | `boardex_na` (**`edwin_hu` only**) | `na_wrds_org_composition` (directors **+ senior managers** — filter `seniority`), `na_wrds_company_names`, `na_dir_profile_details` (`usualname` = nickname). History starts **1999**, ~20k mostly-large companies. See `references/boardex.md` |
| WRDS People Link | `wrdsapps_plink_exec_ciq`, `_exec_boardex`, `_exec_trinsider`, `_trinsider_ciq` | pairwise PERSON id links (execid ↔ directorid ↔ CIQ personid ↔ TR personid). `plink_boardex_ciq` denied unless the account holds both. See `references/people-linking.md` |
| IBES | `tr_ibes` | `det_epsus`, `statsum_epsus` |
| Form D / Reg D | `wrdssec` | `wrds_vc_formd` (parsed, 2000–2020); index: `wrdssec_all.forms` (all CIKs) or `wrds_forms` (filer only) — default to `forms`, see `references/wrds-forms-tables.md` |
| SEC EDGAR | `wrdssec_all` | `forms` (raw index, all CIKs per filing — default), `wrds_forms` (filer-only view), `wciklink_cusip` |
| SEC Search | `wrds_sec_search` | `filing_view`, `registrant` |
| EDGAR | `edgar` | `filings`, `filing_docs` |
| Fama-French | `ff` | `factors_monthly`, `factors_daily` |
| LSEG/Datastream | `tr_ds` | `ds2constmth`, `ds2indexlist` |
| FJC (Federal Judicial Center) | `fjc` | `civil`, `criminal`, `bankruptcy`, `appeals` |
| FJC Linking | `fjc_linking` | `wrds_civil_link`, `wrds_criminal_link` |
| SDC New Issues (IPO/SEO/Debt) | `tr_sdc_ni` | `wrds_ni_details` — equity + debt offerings |
| SDC Mergers & Acquisitions | `tr_sdc_ma` | `wrds_ma_details` — M&A transactions |
| TAQ Legacy | `taq` | `mast_YYYY`, `wrds_iid_YYYY` — second-level (1993–2006) |
| TAQ Millisecond | `taqmsec` | `mastm_YYYY`, `wrds_iid_YYYY`, `ctm_YYYYMM`, `complete_nbbo_YYYYMMDD` |
| Thomson S12 (Mutual Fund Holdings) | `tfn` (SAS) / `tr_mutualfunds` (PG) | `s12` — 13F/N-CSR fund holdings |
| Thomson S34 (13-F Institutional) | `tfn` (SAS) / `tr_13f` (PG) | `s34` — 13-F institutional holdings |
| FISD / Mergent (Corporate Bonds) | `fisd_fisd` | `fisd_mergedissue`, `fisd_mergedissuer` — corporate/agency/Treasury; **NOT the muni source** (issuer_type='M' munis are incidental) |
| Municipal trades (MSRB RTRS) | `msrb` | `msrb` (trades + inline CUSIP master: coupon, maturity), `msrb_lookup`; also `msrb_all`, `msrbsamp`. **Primary muni source.** See `references/muni-bonds.md` |
| Municipal new issues (SDC) | `tr_sdc_municipals` | deal-level: ratings, GO/rev, bank-qualified, callable, size, sector — **but `SELECT` is permission-denied on this subscription (not licensed)**; `msrb` is the only readable muni schema. See `references/muni-bonds.md` |
| PitchBook | `pitchbk_companies_deals`, `pitchbk_investors_funds_lps`, `pitchbk_fund_returns` | `deal`, `company`, `fund`, `wrds_fund_returns` — dealsize in USD millions |

## Connection

Initialize PostgreSQL connection to WRDS:

```python
import psycopg2

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737,
    database='wrds',
    sslmode='require'
    # Credentials from ~/.pgpass
)
```

Configure authentication via `~/.pgpass` with `chmod 600`:
```
wrds-pgdata.wharton.upenn.edu:9737:wrds:USERNAME:PASSWORD
```

Connect via SSH tunnel:
```bash
ssh wrds
```

This uses `~/.ssh/wrds_rsa` for authentication.

## Critical Filters

### Compustat Standard Filters
Always include for clean fundamental data:
```sql
WHERE indfmt = 'INDL'
  AND datafmt = 'STD'
  AND popsrc = 'D'
  AND consol = 'C'
```

### CRSP v2 Common Stock Filter
Equivalent to legacy `shrcd IN (10, 11)`:
```python
df = df.loc[
    (df.sharetype == 'NS') &
    (df.securitytype == 'EQTY') &
    (df.securitysubtype == 'COM') &
    (df.usincflg == 'Y') &
    (df.issuertype.isin(['ACOR', 'CORP']))
]
```

### Form 4 Transaction Types
```sql
WHERE acqdisp = 'D'  -- Dispositions
  AND trancode IN ('S', 'D', 'G', 'F')  -- Sales, Dispositions, Gifts, Tax
```

## Parameterized Queries

Always use parameterized queries (never string formatting):

Use scalar parameter binding for single values:
```python
cursor.execute("""
    SELECT gvkey, conm FROM comp.company WHERE gvkey = %s
""", (gvkey,))
```

Use ANY() for list parameters:
```python
cursor.execute("""
    SELECT * FROM comp.funda WHERE gvkey = ANY(%s)
""", (gvkey_list,))
```

## Additional Resources

### Reference Files

Detailed query patterns and table documentation:

- **`references/compustat.md`** - Compustat tables, ExecuComp, financial variables
- **`references/crsp.md`** - CRSP legacy (SIZ) stock data and CCM linking
- **`${CLAUDE_SKILL_DIR}/../../skills/crsp-v2/SKILL.md`** - CRSP CIZ / v2 format (required for any data after 2024-12-31)
- **`references/insider-form4.md`** - Thomson Reuters Form 4, rolecodes, insider types
- **`references/iss-compensation.md`** - ISS Incentive Lab, peer companies, compensation
- **`references/formd.md`** - Form D / Reg D (canonical): two sources (WRDS `wrds_vc_formd` + SEC EDGAR TSV/XML), grain & keys, denormalization gotcha, exemption + industry codes, post-2020 gap, validated benchmarks
- **`references/boardex.md`** - BoardEx: 1999 coverage start and ~20k-company universe, `wrds_org_composition` is directors PLUS senior managers, sentinel dates, feed 4.2 succession ids, the reused-ticker linking trap, measured recall vs proxy statements
- **`references/people-linking.md`** - WRDS People Link: the pairwise person-id tables, which are readable per account, and the Execucomp chain when BoardEx↔CIQ is denied
- **`references/edgar.md`** - SEC EDGAR filings, URL construction, DCN vs accession numbers
- **`references/connection.md`** - Connection pooling, caching, error handling
- **`references/taq.md`** - TAQ: master files, IID, raw tick processing (NBBO, VWAP, closing auctions), CRSP–TAQ merge, era transition (legacy vs millisecond)
- **`references/sas-etl.md`** - SAS metadata probing (PROC CONTENTS/DATASETS/PRINT), hash objects, index-friendly WHERE, SGE array jobs, PROC SQL optimization
- **`references/postgres-vs-sas.md`** - Decision guide: when to use PostgreSQL vs SAS for WRDS ETL (benchmarks, constraints, hybrid pattern)
- **`references/fjc.md`** - FJC Integrated Database: civil/criminal case data, NOS codes, securities litigation queries, firm linking
- **`references/sdc-issuances.md`** - SDC New Issues: IPOs, SEOs, 144A equity, debt offerings — schema discovery, cleaning filters, CRSP/Compustat linking
- **`references/fisd-bonds.md`** - FISD/Mergent: corporate bond issuances, IG vs HY, 144A vs registered, rating classification, TRACE linking
- **`references/sdc-ma.md`** - SDC M&A: deal counts, PE/LBO vs strategic buyer, deal status codes, public vs private target
- **`references/fund-formation.md`** - Fund formation: Form D (pooled investment funds), EDGAR N-2 (closed-end fund IPOs), Form ADV (RIA registrations)
- **`references/capiq.md`** - Capital IQ: the `eddyhu`/`edwin_hu` account split (`ciq_pplintel` vs `boardex_na`, both plink tables denied), `wrds_professional` board panel + the `boardflag`/`sponsorflag` traps, `ciqcompanyrel` relationship types, the keyed sponsor→portco→director→sponsor-employment join
- **`references/pitchbook.md`** - PitchBook: schema architecture, dealsize/fundsize in USD millions, dealdate outliers, CIK crosswalk, fund performance (wrds_fund_returns), PE/VC/fund formation patterns
- **`references/proxy-advisors.md`** - Proxy-advisor customer identification: 485BPOS/485APOS body scan for ISS/Glass Lewis/Egan-Jones name variants; CRSP MFDB lift to mgmt_cd × year; validates against chongshu published CSV
- **`references/linkage.md`** - Cross-dataset linkage map: which identifiers are spines, the load-bearing link tables (CCM, wciklink, dswslink, MFDB), a "how do I join X to Y" table, and which vendor ids never cross
- **`references/blockholders.md`** - 13D/13G blockholder panel: Volkova replication, position %, the four mutually-exclusive holder flags
- **`references/execucomp.md`** - ExecuComp: CEO anncomp, legacy codirfin vs current directorcomp, firm-year aggregation
- **`references/iss-directors.md`** - ISS Directors: risk.directors + risk.rmdirectors, type harmonization, 1996 gender backfill, S&P 1500 filter
- **`references/iss-voting.md`** - ISS Voting Analytics: vavoteresults, voteanalysis_npx, base-conditional turnout/forpct, agenda codes
- **`references/tfn-ownership.md`** - Thomson 13-F (S34) institutional ownership and S12 mutual-fund holdings via MFLINKS, passive/index classification, and **Known Data Defects** (D1-D9: split mis-adjustment, post-2013 coverage collapse, 2017Q4 S12 feed change, 13F value unit break, and two that are *yours* not the vendor's — D8 silent Int8 date overflow, D9 ownership above 100%). Read the defects section before trusting any split-era or post-2013 quarter.
  - Detectors: `scripts/ownership_dq.py` (14 detectors, S12 and S34) — run these against any holdings panel before analysis. Tests: `tests/ownership_dq_test.py` (79 assertions, stdlib only).
  - Run `detect_calendar_bucket_gap` on every **reference/dimension table** at build time, not just on the output panel. It is the one detector that catches a root cause rather than a symptom: a reference table missing a whole calendar bucket makes every downstream join fall back to a default, silently, and the result looks like a vendor defect (see D8).
- **`references/lpc-dealscan.md`** - LPC DealScan: legacy vs 2021+ flat schema, borrower ids, the gvkey link and its grain caveats
- **`references/muni-bonds.md`** - Municipal bonds: MSRB RTRS trades, SDC municipals
- **`references/wrds-forms-tables.md`** - `wrdssec_all.wrds_forms` and friends: filing metadata tables and their columns

### Example Files

Working code from real projects:

- **`examples/form4_disposals.py`** - Insider trading analysis (from SVB project)
- **`examples/wrds_connector.py`** - Connection pooling pattern
- **`examples/formd_regd.ipynb`** - Form D / Reg D: dedup validation, SEC TSV download, exemption trend charts
- **`examples/sdc_issuances_eda.ipynb`** - SDC New Issues: annual IPO/SEO/debt counts, 144A share, IG vs HY breakdown
- **`examples/sdc_ma_eda.ipynb`** - SDC M&A: annual deal counts, PE/LBO vs strategic, public vs private target trends
- **`examples/fund_formation_eda.ipynb`** - Fund formation: Form D 3C.1/3C.7 counts, EDGAR N-2 closed-end fund IPOs, Form ADV RIA registrations
- **`examples/pitchbook_eda.ipynb`** - PitchBook: PE deal activity, VC rounds by stage, fund formation by vintage, IRR/TVPI by strategy
- **`npx-ownership-panel` SKILL** (promoted out of this skill's examples) - the full meeting-level proxy-voting x ownership panel: ISS N-PX fund votes reduced to (item x block) cells on the grid, joined to 13-F institutional and MF holdings. One bash command, verified end to end on 2026-07-25. Also carries the ISS->CRSP fund crosswalk. Use it for any N-PX or fund-level voting work.
- **`examples/blockholders_pipeline/`** - 13D/13G → Volkova blockholder panel, end-to-end Python. `redo_bridge.py` is the reference implementation of TR `personid` → SEC `rptOwnerCik` name bridging (97.4% hit rate).
- **`examples/form4_pipeline/`** - Two parallel Form 3/4/5 pipelines: the annualized SAS ownership panel and the XML owner bridge built from the raw filings.
- **`examples/proxy_advisors_pipeline/`** - 485BPOS/485APOS scan for ISS / Glass Lewis / Egan-Jones customer relationships via the `scan_covers` Go framework + SGE.
- **`examples/fjc_eda.ipynb`** - FJC Integrated Database: securities cases (`nos = 850`), filing trends, court distribution
- **`examples/lpc_dealscan_eda.ipynb`** (paired script: `examples/lpc_dealscan_eda.py`) - LPC DealScan: ~171K US facilities 1990-2020 (the normalized facility table; queries are capped at 2020-12-31), volume by year, loan type and purpose mix
- **`examples/voting_ownership_eda.py`** - Standalone Python/PostgreSQL EDA of the same ISS-votes + ownership merge. For production work use the **`npx-ownership-panel` skill**, which is the SGE-ready, verified-end-to-end version of this analysis.

### Scripts

- **`scripts/test_connection.py`** - Validate WRDS connectivity
- **`scripts/inventory_schemas.py`** - Inventory every accessible WRDS PostgreSQL schema, its tables, and row counts — run this before guessing at a table name
- **`scripts/scan_covers/`** - Generic profile-based Go framework for EDGAR extraction (SGE sharding, NFS concurrency, path construction, form-type filtering). Add a `profiles_*.go`, never a new standalone binary — see the Iron Law above.
- **`scripts/parse_13f/`, `scripts/scan_headers/`, `scripts/sec_index/`** - Companion EDGAR tooling: 13F table parsing, SEC header scanning, index building

### Local Sample Notebooks

WRDS-provided samples at `~/resources/wrds-code-samples/`:
- `ResearchApps/CCM2025.ipynb` - Modern CRSP-Compustat merge
- `ResearchApps/ff3_crspCIZ.ipynb` - Fama-French factor construction
- `comp/sas/execcomp_ceo_screen.sas` - ExecuComp patterns

## Date Awareness

When querying historical data, leverage current date context for dynamic range calculations.

Current date is automatically available via `datetime.now()`. Apply this to:
- Data range validation (e.g., "get data for last 5 years")
- Fiscal year calculations
- Event study windows

Implement dynamic date ranges in queries:
```python
from datetime import datetime, timedelta

# Query last 5 years of data
end_date = datetime.now()
start_date = end_date - timedelta(days=5*365)

query = """
SELECT * FROM comp.funda
WHERE datadate BETWEEN %s AND %s
"""
df = pd.read_sql(query, conn, params=(start_date, end_date))
```

Always incorporate current date awareness in date-dependent queries to ensure results remain fresh across time.