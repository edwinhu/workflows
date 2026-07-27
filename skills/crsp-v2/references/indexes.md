# CIZ Indexes: INDNO, INDFAM, and Statistics

In legacy SIZ, indexes were reached by name (`vwretd`, `CAP1`) and grouped informally
(Stock File Indexes, Cap-Based Portfolios). In CIZ **every index is a number** (`INDNO`)
belonging to a numbered **family** (`INDFAM`). Nothing is addressable by name any more.

## Contents

- [The `_ind` Suffix](#the-_ind-suffix)
- [Family and Series Tables](#family-and-series-tables)
- [The +400 Monthly Renumbering](#the-400-monthly-renumbering)
- [INDNOs You Will Actually Use](#indnos-you-will-actually-use)
- [The Three S&P 500 Series](#the-three-sp-500-series)
- [Membership](#membership)
- [Stock-Level Statistics and Deciles](#stock-level-statistics-and-deciles)
- [Rebalancing and Breakpoints](#rebalancing-and-breakpoints)

## The `_ind` Suffix

Index tables appear in both the Stock and Index products under the same base name. The
Index-database copies carry an `_ind` suffix and far more data.

Verified 2026-07-26: `crsp.indseriesinfohdr` (stock product) has **4** series;
`crsp.indseriesinfohdr_ind` (index product) has **274**.

The 4 in the stock-only product are the ones CRSP passes through for convenience:

| INDNO | INDFAM | Name | Freq | Range |
|-------|--------|------|------|-------|
| 1000200 | 1100200 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Value-Weighted Market Index | BTH | 1925-12-31 → 2025-12-31 |
| 1000201 | 1100200 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Equal-Weighted Market Index | BTH | 1925-12-31 → 2025-12-31 |
| 1000502 | 1100502 | S&P 500 Composite | BTH | 1962-07-02 → 2025-12-31 |
| 1000503 | 1100503 | Nasdaq Composite | BTH | 1972-12-14 → 2025-12-31 |

If a query against `crsp.indseriesinfohdr` returns nothing for the index you want, you
need the `_ind` table and an Index-database subscription.

Index values in the stock products are calculated on CRSP's legacy system and passed
through, so they may not match precisely what you would get by recalculating from the
CIZ files.

## Family and Series Tables

`crsp.indfamilyinfohdr_ind` — one row per family. Tells you the weighting scheme, the
base level/date, the frequency, and the **INDNO range** of its members:

```sql
SELECT indfam, indfamnm, baselvl, basedt, weighttype, freqavail,
       indfamsize, indfamfirstindno, indfamlastindno
FROM crsp.indfamilyinfohdr_ind ORDER BY indfam;
```

`crsp.indseriesinfohdr_ind` — one row per index:

```sql
SELECT indno, indfam, indfamtype, indnm, indbegdt, indenddt,
       baselvl, basedt, freqavail, weighttype, cntvaltype, portnum
FROM crsp.indseriesinfohdr_ind WHERE indfam = 1100012 ORDER BY indno;
```

`freqavail`: `DLY` daily only, `MTH` monthly only, `BTH` both. `weighttype`: `EV` equal
and value weighted, `MC` market-cap weighted, `X` not applicable (published series).
Four columns that used to exist only in the PDF documentation — `IndFamilyType`,
`FreqAvail`, `WeightType`, `CntValType` — are now data.

Time series live in `crsp.inddlyseriesdata[_ind]` and `crsp.indmthseriesdata[_ind]`,
keyed on `indno` + period.

## The +400 Monthly Renumbering

**The single most common CIZ index mistake.** In legacy SIZ, daily and monthly versions
of an index shared an `INDNO`. In CIZ, CRSP renumbered the monthly series:

> Monthly `INDFAM` and `INDNO` = daily value **+ 400**.

Example — NYSE Market Capitalization Deciles:

| | INDFAM | Members | Freq |
|---|--------|---------|------|
| Daily | 1100012 | 1000002 – 1000011 | `DLY` |
| Monthly | 1100412 | 1000402 – 1000411 | `MTH` |

So `SELECT * FROM crsp.indmthseriesdata_ind WHERE indno = 1000002` returns **zero rows**,
silently — the monthly decile 1 series is `1000402`.

Check `freqavail` before assuming a series exists at your frequency. Families with
`freqavail = 'BTH'` (like the two CRSP market indexes and the S&P 500 composite) keep one
INDNO across both frequencies; families with `DLY` and `MTH` variants are the ones that
were split and renumbered.

## INDNOs You Will Actually Use

| INDNO | INDFAM | Index | Replaces |
|-------|--------|-------|----------|
| 1000000 | 1100000 | CRSP NYSE Value-Weighted Market Index | |
| 1000001 | 1100000 | CRSP NYSE Equal-Weighted Market Index | |
| 1000002 – 1000011 | 1100012 | NYSE Market Cap Deciles 1–10 (daily) | Cap-based portfolios |
| 1000402 – 1000411 | 1100412 | NYSE Market Cap Deciles 1–10 (monthly) | same, monthly |
| 1000102 – 1000111 | 1100112 | NYSE/NYSE American Beta Deciles 1–10 | Risk-based deciles |
| 1000200 | 1100200 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Value-Weighted | `VWRETD` (`DlyTotRet`), `VWRETX` (`DlyPrcRet`) |
| 1000201 | 1100200 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Equal-Weighted | `EWRETD`, `EWRETX` |
| 1000500 | 1100500 | CRSP Value-Weighted Index of the S&P 500 Universe | **membership source** |
| 1000502 | 1100502 | S&P 500 Composite (published) | `SPINDX`, `SPRTRN` (`DlyPrcRet`) |
| 1000503 | 1100503 | Nasdaq Composite (published) | |
| 1000510 | 1100510 | CRSP Value-Weighted Portfolios of the S&P 500 Universe | |
| 1000700 | 1100700 | CRSP 30-Year Bond Returns (monthly only) | |

CIZ also added the investable CRSP Market Indexes and the CRSP ISS ESG Indexes, which
have no SIZ counterpart at all — they contribute the bulk of the extra rows in
`IndDlySeriesData` and `StkIndMembership`.

## The Three S&P 500 Series

CRSP ships three distinct things that all say "S&P 500". Picking the wrong one is a
silent methodology error.

1. **`INDFAM 1100502` / `INDNO 1000502` — S&P 500 Composite.** The official published
   index and its return. `weighttype = 'X'`. This is where `SPINDX` and `SPRTRN` come
   from. **It has no membership rows** — `stkindmembership_ind` for `indno = 1000502`
   returns 0.

2. **`INDFAM 1100500` / `INDNO 1000500`, `1000501` — CRSP Index of the S&P 500
   Universe.** CRSP's own value- and equal-weighted index computed over the S&P 500
   constituent universe. **This is the membership source** (1,956 distinct PERMNOs).
   Uses membership as of the **end of the current period**.

3. **`INDFAM 1100510` / `INDNO 1000510`, `1000511` — CRSP Portfolio of the S&P 500
   Universe.** Identical construction except it uses membership as of the end of the
   **previous** period — i.e. a genuinely tradable portfolio. Use this one for anything
   claiming implementability.

## Membership

```sql
SELECT permno, indno, mbrstartdt, mbrenddt, mbrflg, indfam
FROM crsp.stkindmembership_ind
WHERE indno = 1000500;
```

Output shape (verified):

```
 permno |  indno  | mbrstartdt |  mbrenddt  | mbrflg | indfam
--------+---------+------------+------------+--------+---------
  10006 | 1000500 | 1957-03-01 | 1984-07-18 | NORM   | 1100500
  10030 | 1000500 | 1957-03-01 | 1969-01-08 | NORM   | 1100500
  10049 | 1000500 | 1925-12-31 | 1932-10-01 | NORM   | 1100500
```

Join point-in-time with `BETWEEN mbrstartdt AND mbrenddt`. `INDNO` is the right key;
`INDFAM` is only for comparing against legacy `KEYSET`.

`crsp.msp500list_v2` / `crsp.dsp500list_v2` are WRDS convenience copies filtered to
`indno = 1000500`, in the same column shape.

## Stock-Level Statistics and Deciles

CRSP pre-computes per-security statistics (beta, standard deviation, capitalization) and
the decile assignment that follows from them. In CIZ these live in
`crsp.stkindsecuritystatistics_ind`, keyed by `permno, indfam, yyyy`.

```sql
SELECT permno, indfam, yyyy, secstattype, secstat, secstatflg,
       secassignyyyy, secassignindno, secassignportnum
FROM crsp.stkindsecuritystatistics_ind
WHERE permno = 12490 AND indfam = 1100112;   -- IBM, beta deciles
```

Read it as: the statistic measured in year `yyyy` determines the portfolio assignment
`secassignportnum` (and index `secassignindno`) for year `secassignyyyy`. IBM's 2022
beta of 0.720082 (`secstattype = 'TOB'`) put it in decile 7 for 2023, i.e. index
`1000108`.

`crsp.stkindissuerstatistics_ind` is the issuer-level twin: keyed `permco, indfam, yyyyq`
with `iss*` columns, quarterly rather than annual. It exists because issuer cap-based
statistics used to be duplicated across every PERMNO of a PERMCO in SIZ; CIZ collapses
them to one issuer row.

## Rebalancing and Breakpoints

`crsp.indsecrebalancesummary_ind` (annual, security-based: capitalization, standard
deviation, beta indexes) and `crsp.indissrebalancesummary_ind` (quarterly, issuer
cap-based) carry the decile breakpoints and the add/drop counts per rebalancing.

```sql
SELECT indno, yyyy, secassignstartdt, secassignenddt, secstattype,
       seclowbreakpoint, sechighbreakpoint, secminstat, secmaxstat,
       secminstatpermno, secmaxstatpermno,
       secsecurityallcnt, secsecuritydropcnt, secsecurityaddcnt
FROM crsp.indsecrebalancesummary_ind
WHERE indfam = 1100012 AND yyyy = 2024 ORDER BY portnum;
```

`SecLowBreakpoint` / `SecHighBreakpoint` (and the `Iss*` equivalents) are new in CIZ —
SIZ only gave you the min and max realised statistic, not the breakpoint itself. The
add/drop/all counts are also new; legacy `RUSDCNT` has no direct equivalent.
