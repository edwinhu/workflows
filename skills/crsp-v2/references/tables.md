# CIZ Table Catalog

Every table and column list below was read from `information_schema.columns` on the
WRDS PostgreSQL server (`wrds-pgdata.wharton.upenn.edu:9737`) on 2026-07-26. Where CRSP's
PDF documentation disagrees with this file, this file is right — the PDFs describe the
flat files, and WRDS adds columns when it loads them.

## Contents

- [Naming and Suffixes](#naming-and-suffixes)
- [Time Series — Stock](#time-series--stock)
- [Identifier Tables](#identifier-tables)
- [Event Tables](#event-tables)
- [Index Tables](#index-tables)
- [Metadata Tables](#metadata-tables)
- [WRDS Convenience Tables](#wrds-convenience-tables)
- [Coverage Notes](#coverage-notes)

## Naming and Suffixes

All CIZ tables live in the `crsp` schema alongside the legacy SIZ tables.

| Suffix | Meaning | Example |
|--------|---------|---------|
| *(none)* | 1925-start US Stock product (CIZ) | `crsp.stkdlysecuritydata` |
| `62` | 1962-start subset product | `crsp.stkdlysecuritydata62` |
| `_ind` | Full Index database (many more rows) | `crsp.stkindmembership_ind` |
| `_v2` | WRDS-built convenience table, CIZ content, legacy name | `crsp.dsf_v2` |

Index tables appear in both the Stock and Index products under the same base name.
Subscribers to the Index database should use `_ind` — the stock-product copies carry
only 4 index series versus 274 in `crsp.indseriesinfohdr_ind`.

The CRSP file-name/product codes: `CIZyyyymm` (1925 Stock & Index), `CAZ` (1925 Stock),
`C6Z` (1962 Stock), `CXZ` (1962 Stock & Index), `COZ` (1925 Indexes). Their SIZ
predecessors were `SIZ`, `SAZ`, `S6Z`, `SXZ`, `SFZ`.

## Time Series — Stock

### `crsp.stkdlysecurityprimarydata` — daily, 12 columns (~7 GB)

Key: `permno, dlycaldt`. The default daily table; every column here also exists in
`stkdlysecuritydata`. Analogous to legacy `SFZ_DP_DLY`.

```
permno, dlycaldt, dlydelflg, dlyprc, dlyprcflg, dlycap, dlycapflg,
dlyret, dlyretx, dlyretmissflg, dlydistretflg, dlyvol
```

### `crsp.stkdlysecuritydata` — daily, 32 columns (~20 GB)

Key: `permno, yyyymmdd`. Superset of the primary file; adds quotes, OHLC, previous-period
values, denormalized dividend amounts, and the price factor.

```
permno, yyyymmdd, dlycaldt, dlydelflg, dlyprc, dlyprcflg, dlycap, dlycapflg,
dlyprevprc, dlyprevprcflg, dlyprevdt, dlyprevcap, dlyprevcapflg,
dlyret, dlyretx, dlyreti, dlyretmissflg, dlyretdurflg,
dlyorddivamt, dlynonorddivamt, dlyfacprc, dlydistretflg,
dlyvol, dlyclose, dlylow, dlyhigh, dlybid, dlyask, dlyopen,
dlynumtrd, dlymmcnt, dlyprcvol
```

`dlyprevprc` / `dlyprevcap` / `dlyprevdt` remove the need for `LAG()` or a self-join —
they are the exact values CRSP used in the return and weight calculations. Use them
rather than re-deriving, because they respect trading gaps that a naive `LAG()` does not.

`dlylow`/`dlyhigh` are trade-based low/high; `dlybid`/`dlyask` are closing quotes. In
SIZ these were overloaded into `bidlo`/`askhi`, and some values that used to sit in
`BIDLO`/`ASKHI` now sit in `DlyBid`/`DlyAsk` instead.

### `crsp.stkmthsecuritydata` — monthly, 37 columns

Key: `permno, yyyymm`. Aggregated from daily. Carries identifiers as of `mthprcdt`.

```
permno, yyyymm, mthcaldt, mthcompflg, mthcompsubflg,
mthprc, mthprcflg, mthprcdt, mthdtflg, mthdelflg, mthcap,
mthprevprc, mthprevprcflg, mthprevdt, mthprevdtflg, mthprevcap,
mthret, mthretx, mthretflg, mthdiscnt, mthvol, mthvolflg, mthprcvol,
mthfacshrflg, mthprcvolmisscnt,
cusip, ticker, issuernm, usincflg, issuertype, securitytype, securitysubtype,
sharetype, exchangetier, primaryexch, tradingstatusflg, conditionaltype
```

Because identifiers are already on the row, a monthly common-stock panel needs **no join**
to `stksecurityinfohist` — the five universe columns are present and are already
point-in-time (as of `mthprcdt`). `crsp.stkqtrsecuritydata` (`yyyyq`, `qtr*` prefixes) and
`crsp.stkannsecuritydata` (`yyyy`, `ann*` prefixes) have identical shapes at their
frequencies.

`mthcompflg` / `mthcompsubflg` (and `qtr*`/`ann*` equivalents) are the completeness flags —
they tell you whether the underlying daily data for that period was complete. Filter on
them instead of hand-checking day counts. This is what makes the annual file usable as a
substitute for scanning the ~100M-row daily file.

### `crsp.stkdlycumulativeadjfactor` — daily, 5 columns

Key: `permno, dlycaldt`. Where `CFACPR`/`CFACSHR` went.

```
permno, dlycaldt, dlyshrout, dlycumfacpr, dlycumfacshr
```

`crsp.stkmthcumulativeadjfactor` is the monthly twin (`mthcaldt`, `mthshrout`,
`mthcumfacpr`, `mthcumfacshr`).

### `crsp.stkmthfloatshares` — monthly, 4 columns

Key: `permno, yyyymm`. New in CIZ; float shares for a subset of securities from as early
as December 1999.

```
permno, yyyymm, mthfloatshrqty, mthfloatshrpct
```

## Identifier Tables

### `crsp.stksecurityinfohist` — permno × interval, 36 columns

Key: `permno, secinfostartdt`. **The table for universe filters and point-in-time
identifiers.** Replaces `msenames`/`stocknames`.

```
permno, secinfostartdt, secinfoenddt, securitybegdt, securityenddt, securityhdrflg,
hdrcusip, hdrcusip9, cusip, cusip9,
primaryexch, conditionaltype, exchangetier, tradingstatusflg,
securitynm, shareclass, usincflg, issuertype, securitytype, securitysubtype, sharetype,
securityactiveflg, delactiontype, delstatustype, delreasontype, delpaymenttype,
ticker, tradingsymbol, permco, siccd, naics, icbindustry, uesindustry,
nasdcompno, nasdissuno, issuernm
```

`crsp.stksecurityinfohdr` has the **same 36 columns** but one row per `permno` (header /
most-recent values). Using the header for a historical filter back-fills today's
classification across the whole panel.

CIZ produces **more** interval rows than legacy `msenames`: it splits on `exchangetier`
changes that SIZ ignored, and it emits a separate one-day row for the delisting event
(`tradingstatusflg = 'D'`). PERMNO 10001 has 14 CIZ rows against 10 legacy rows.

### `crsp.stkissuerinfohdr` / `crsp.stkissuerinfohist` — permco, 18 columns

Key: `permco` (plus `issinfostartdt, issinfoenddt` for the history table). New in CIZ.
Gives non-duplicated issuer counts and enforces consistency for issuer-level fields.

```
permco, issinfostartdt, issinfoenddt, issuerbegdt, issuerenddt, issuerhdrflg,
cnum, issuernm, securityrangecnt, securitytotalcnt,
usincflg, issuertype, issuerstatustype, siccd, naics, icbindustry, uesindustry, nasdcompno
```

(`stkissuerinfohdr` uses `issinfostartdt`/`issinfoenddt` in the same positions.)

About 98% of issuers have exactly one security. Most issuer fields are duplicated onto
the security-level tables for convenience, so you rarely need to join — the issuer tables
matter when you need a clean count of *firms* rather than *securities*, or issuer-level
cap-based statistics.

`icbindustry` and `uesindustry` are new in CIZ (high-level ICB and UES industry only).

## Event Tables

### `crsp.stkdelists` — 19 columns

Key: `permno`. **Only actually-delisted securities appear.** Legacy `SFZ_DEL` carried a
row for every security including active ones (with `DLSTCD = 100`); CIZ does not. An
inner join to this table is now an implicit "delisted only" filter.

```
permno, delistingdt, deldtprc, deldtprcflg,
delactiontype, delstatustype, delreasontype, delpaymenttype,
delpermno, delpermco, delret, delretmisstype,
delnextdt, delnextprc, delnextprcflg, delamtdt, deldivamt, deldistype, deldlydt
```

`deldtprc` is the price **on the delisting date**; `delnextprc` is the price on
`delnextdt`. Legacy `DLPRC` corresponds to **`delnextprc`**, not `deldtprc` — comparing
`DLPRC` to `deldtprc` produces 20,000+ spurious mismatches.

`DLRETX` has no CIZ equivalent.

### `crsp.stkdistributions` — 19 columns

Key: `permno, disexdt, disseqnbr`. `disseqnbr` is new — it disambiguates multiple
distributions with the same ex-date, which legacy handled through `distcd` + `acperm`.

```
permno, disexdt, disseqnbr, disordinaryflg,
distype, disfreqtype, dispaymenttype, disdetailtype, distaxtype, disorigcurtype,
disdivamt, disfacpr, disfacshr,
disdeclaredt, disrecorddt, dispaydt, dispermno, dispermco, disamountsourcetype
```

The 4-digit `DISTCD` is unpacked into the seven type/flag columns above.

`disdivamt` is **missing (NULL), not 0**, for distributions with no cash amount — e.g.
splits (`distype='FRS'`, `dispaymenttype='SS'`, `disdetailtype='STKSPL'`). Legacy
`divamt` was always 0 in that case. `SUM(disdivamt)` behaves differently as a result;
`coalesce(disdivamt, 0)` restores legacy behaviour if you need it.

A security can have two distributions in one month (AAPL, August 2020: a cash dividend
on 8/7 and a 4:1 split on 8/31). Joining distributions to a monthly panel therefore
duplicates rows — this is the documented cause of "duplicate rows" in the WRDS Daily and
Monthly Stock File queries.

### `crsp.stkshares` — 7 columns

Key: `permno, shrstartdt`.

```
permno, shrstartdt, shrenddt, shrout, shrsource, shrfactype, shradrflg
```

CIZ splits share-observation intervals more finely than legacy `mseshares`, so an equality
join on date ranges will appear to mismatch even when `shrout` agrees. About 88 records
genuinely differ (mean 1.23%, median 0.07%) due to float-precision rounding — a documented
and accepted difference.

## Index Tables

### `crsp.inddlyseriesdata` / `crsp.indmthseriesdata` — 15 columns

Key: `indno, yyyymmdd` (or `indno, yyyymm`).

```
indno, yyyymmdd, dlycaldt, dlytotret, dlytotind, dlyprcret, dlyprcind,
dlyincret, dlyincind, dlyusdcnt, dlyusdval, dlytotcnt, dlytotval,
dlyeligcnt, dlywgtamt
```

`dlyeligcnt` and `dlywgtamt` are new in CIZ. Monthly uses `mth*` prefixes throughout.

### `crsp.indseriesinfohdr` — 12 columns

```
indno, indfam, indfamtype, indnm, indbegdt, indenddt,
baselvl, basedt, freqavail, weighttype, cntvaltype, portnum
```

### `crsp.indfamilyinfohdr_ind` — 23 columns

```
indfam, indfamtype, indfamnm, indfambegdt, indfamenddt, baselvl, basedt,
freqavail, weighttype, cntvaltype, universetype, exchangegroup,
indfamsize, indfamfirstindno, indfamlastindno, underlyingdatacd,
portorder, assignstattype, breakpointformtype, breakpointstattype,
breakpointfreqtype, betastatmrktindno, breakpointindfam
```

### `crsp.stkindmembership_ind` — 6 columns

Key: `permno, indno, mbrstartdt, mbrenddt`.

```
permno, indno, mbrstartdt, mbrenddt, mbrflg, indfam
```

### `crsp.stkindsecuritystatistics_ind` / `crsp.stkindissuerstatistics_ind` — 9 columns

Pre-calculated stock-level statistics (beta, standard deviation, capitalization) and the
resulting decile assignment.

```
permno, indfam, yyyy, secstattype, secstat, secstatflg,
secassignyyyy, secassignindno, secassignportnum
```

The issuer version is keyed on `permco, indfam, yyyyq` with `iss*` column names.

### `crsp.indsecrebalancesummary_ind` / `crsp.indissrebalancesummary_ind` — 20 columns

Breakpoints and rebalancing statistics per index and period.

```
indno, yyyy, indfam, portnum, secassignyyyy, secassignstartdt, secassignenddt,
secissuerallcnt, secstattype, seclowbreakpoint, sechighbreakpoint,
secminstat, secmaxstat, secminstatpermno, secminstatissuernm,
secmaxstatpermno, secmaxstatissuernm,
secsecurityallcnt, secsecuritydropcnt, secsecurityaddcnt
```

## Metadata Tables

Ten metadata tables ship with CIZ. They are the fastest way to answer "what is this
column" without opening a PDF, and they are queryable, so prefer them.

| Table | Key | Contents |
|-------|-----|----------|
| `crsp.metafileinfo` | `filename` | One row per CIZ file: description, category, row frequency, column count, key columns |
| `crsp.metaiteminfo` | `itemname` | One row per item: description, definition, category, class, **`itemflagtype`** |
| `crsp.metacolumninfo` | `filename, colposition` | Per-column SQL/SAS/R datatypes, null flag, ASCII field width |
| `crsp.metaflaginfo` | `flagtype, flagvalue` | All ~774 flag values with descriptions and definitions |
| `crsp.metaflagtype` | `flagtype` | The 62 flag types |
| `crsp.metacolumncoverage` | `filename, colposition` | Non-missing counts/percentages, first and last date with data |
| `crsp.metaflagcoverage` | `filename, colposition, flagvalue` | How often each flag value actually occurs |
| `crsp.metacalendarperiod` | `calperiodkey` | Daily/monthly/quarterly/annual period boundaries, CRSP trading start/end, next/prev period keys, trading-day counts |
| `crsp.metaexchangecalendar` | `caldt` | Every day from 1925-12-31: trading/holiday/weekend flags and reason |
| `crsp.metasiztociz` | `sizfilename, sizcolposition, sizcolmapseq` | The machine-readable SIZ→CIZ crosswalk |

Column shapes:

```
metafileinfo   :: filename, filedesc, filedef, filecategory, filerowfreq,
                  filecolumncnt, filedatacolumncnt, filekeycnt, filekeytype,
                  fileitemname1..4, fileactiveflg, filekey, fileitemkey1..4
metaiteminfo   :: itemname, itemdesc, itemdef, itemcategory, itemclass,
                  itemmaxcharlen, itemnullflg, itemmissingflg, itemhasdataflg,
                  itemflagtype, itemactiveflg, itemfilecnt, itemkey
metaflaginfo   :: flagtype, flagvalue, flagtypedesc, flagdesc, flagdef,
                  flagcoverageflg, flagkey
metasiztociz   :: sizfilename, sizcolposition, sizcolmapseq, sizitemname, sizitemdesc,
                  cizfilename, cizitemname, cizitemdesc,
                  sizmappingtype, sizmappingsubtype,
                  cizcolumnkey, cizfilekey, cizitemkey, sizcolumnmappingkey
metacolumncoverage :: filename, colposition, itemname, colcount, colcountid,
                  colmindt, colmaxdt, colcountpct, colcountidpct, coldatepct,
                  columnkey, filekey, itemkey
metacalendarperiod :: calperiodkey, calperiodtype, calperiodstartdt, calperiodenddt,
                  calperiodcrspstartdt, calperiodcrspenddt, calperiodnextkey,
                  calperiodprevkey, calperiodprevenddt, calperiodprevcrspenddt,
                  calperiodnbr, calperioddaycnt, calperiodcrspdaycnt, calperiodflg
metaexchangecalendar :: caldt, tradingflg, holidayflg, weekendflg, datestatusflg,
                  weekday, exchangegroup
```

In `metasiztociz`, `sizcolmapseq = 1` is the best default mapping when a SIZ column maps
to several CIZ columns. `sizcolposition = 0` rows describe the **join keys** between the
SIZ and CIZ files; `sizcolposition > 900` rows describe CIZ columns that were *added*
(denormalized from another SIZ file, or promoted out of the PDF documentation).

Coverage figures worth knowing before designing a study, from `metacolumncoverage`:
`DlyPrc` is 98% non-missing and present for 100% of PERMNOs; `DlyClose` 81% / 88%;
`DlyOpen` 60% / 77%; `DlyNumTrd` starts only on 1982-11-01 and covers 48% of securities.

## WRDS Convenience Tables

Built by WRDS, not CRSP. They pre-join identifiers, shares, and adjustment factors onto
the time series, so they are the fastest path for a straightforward panel — at the cost
of the duplicate-row behaviour when a security has multiple distributions in a period.

### `crsp.dsf_v2` — 50 columns

```
permno, hdrcusip, permco, siccd, nasdissuno, yyyymmdd,
sharetype, securitytype, securitysubtype, usincflg, issuertype,
primaryexch, conditionaltype, tradingstatusflg,
dlycaldt, dlydelflg, dlyprc, dlyprcflg, dlycap, dlycapflg,
dlyprevprc, dlyprevprcflg, dlyprevdt, dlyprevcap, dlyprevcapflg,
dlyret, dlyretx, dlyreti, dlyretmissflg, dlyretdurflg,
dlyorddivamt, dlynonorddivamt, dlyfacprc, dlydistretflg,
dlyvol, dlyclose, dlylow, dlyhigh, dlybid, dlyask, dlyopen,
dlynumtrd, dlymmcnt, dlyprcvol,
dlycumfacpr, dlycumfacshr, cusip, ticker, exchangetier, shrout
```

This is `stkdlysecuritydata` + the universe columns + `shrout` + cumulative factors, so a
common-stock daily panel can be written against `dsf_v2` alone with no joins.

### `crsp.msf_v2` — 45 columns

`stkmthsecuritydata` plus `hdrcusip, permco, siccd, nasdissuno, mthcumfacpr,
mthcumfacshr, shrout, mthfloatshrqty`.

### `crsp.stocknames_v2` — 22 columns

```
permno, permco, namedt, nameenddt, securitybegdt, securityenddt,
hdrcusip, hdrcusip9, cusip, cusip9, ticker, issuernm,
primaryexch, conditionaltype, tradingstatusflg, shareclass,
sharetype, securitytype, securitysubtype, usincflg, issuertype, siccd
```

Keeps the legacy `namedt`/`nameenddt` column names (rather than
`secinfostartdt`/`secinfoenddt`), which makes porting legacy `stocknames` code easier.

### Index convenience tables

`crsp.msp500list_v2` and `crsp.dsp500list_v2` are S&P 500 membership in the CIZ
membership shape (`permno, indno, mbrstartdt, mbrenddt, mbrflg, indfam`), filtered to
`indno = 1000500`.

`crsp.dsp500_v2` / `crsp.msp500_v2` keep the legacy index-series column names:
`yyyymmdd, caldt, vwretd, vwretx, ewretd, ewretx, totval, totcnt, usdval, usdcnt,
spindx, sprtrn` — the easiest drop-in when porting code that referenced `vwretd`.

Also present: `crsp.wrds_dsfv2_query`, `crsp.wrds_msfv2_query` (the backing tables for
the WRDS web query tool), and `crsp.idx_const_*_v2` (index constituent files).

## Coverage Notes

Verified 2026-07-26:

- `crsp.stkdlysecurityprimarydata`: 1925-12-31 → 2025-12-31
- `crsp.stkmthsecuritydata`: → 2025-12-31
- `crsp.dsf` (legacy SIZ): → 2024-12-31, frozen
- `crsp.indseriesinfohdr`: 4 series (stock product); `crsp.indseriesinfohdr_ind`: 274 series
- `crsp.stkindmembership_ind` for `indno = 1000500`: 1,956 distinct PERMNOs
