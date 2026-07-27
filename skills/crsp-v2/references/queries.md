# CIZ Query Recipes

Every query in this file was executed against `wrds-pgdata.wharton.upenn.edu:9737` on
2026-07-26. Where output is shown, it is real output. Connection setup, `.pgpass`, and
the WRDS Cloud / SGE rules live in `skills/wrds/SKILL.md`.

## Contents

- [Universe: Common Stock](#universe-common-stock)
- [Daily Panel](#daily-panel)
- [Monthly Panel](#monthly-panel)
- [Market Capitalization and Weights](#market-capitalization-and-weights)
- [Delistings](#delistings)
- [Cumulative Adjustment Factors](#cumulative-adjustment-factors)
- [Distributions and Dividends](#distributions-and-dividends)
- [Market and Benchmark Index Returns](#market-and-benchmark-index-returns)
- [S&P 500 Membership](#sp-500-membership)
- [Linking to Compustat (CCM)](#linking-to-compustat-ccm)
- [Looking Up Flags and Columns](#looking-up-flags-and-columns)
- [Rebuilding Legacy MSE-Style Tables](#rebuilding-legacy-mse-style-tables)
- [Performance Notes](#performance-notes)

## Universe: Common Stock

The `SHRCD IN (10,11)` + `EXCHCD IN (1,2,3)` equivalent. All five share/issuer columns
are required; see the Iron Law in `SKILL.md`.

```sql
SELECT permno, secinfostartdt, secinfoenddt, ticker, issuernm
FROM crsp.stksecurityinfohist
WHERE sharetype       = 'NS'
  AND securitytype    = 'EQTY'
  AND securitysubtype = 'COM'
  AND usincflg        = 'Y'
  AND issuertype      IN ('ACOR','CORP')
  AND primaryexch     IN ('N','A','Q')
  AND conditionaltype = 'RW'
  AND tradingstatusflg = 'A';
```

Dropping `conditionaltype`/`tradingstatusflg` widens the sample to include halted
(`tradingstatusflg='H'`, legacy `EXCHCD=-2`) and suspended (`'S'`, legacy `EXCHCD=-1`)
records. That is sometimes what you want — decide, don't default.

## Daily Panel

Verified: returns 84,245 rows for January 2024.

```sql
SELECT d.permno, d.dlycaldt, d.dlyprc, d.dlyprcflg,
       d.dlyret, d.dlyretx, d.dlycap, d.dlyvol
FROM crsp.stkdlysecurityprimarydata d
JOIN crsp.stksecurityinfohist h
  ON  h.permno = d.permno
 AND  d.dlycaldt BETWEEN h.secinfostartdt AND h.secinfoenddt
WHERE d.dlycaldt BETWEEN %(start)s AND %(end)s
  AND h.sharetype = 'NS' AND h.securitytype = 'EQTY' AND h.securitysubtype = 'COM'
  AND h.usincflg = 'Y'   AND h.issuertype IN ('ACOR','CORP')
  AND h.primaryexch IN ('N','A','Q')
  AND h.conditionaltype = 'RW' AND h.tradingstatusflg = 'A';
```

The `BETWEEN secinfostartdt AND secinfoenddt` predicate is what makes the classification
point-in-time. Without it you apply a security's final classification to its whole
history and import survivorship into the sample.

Single-table alternative — `crsp.dsf_v2` already carries the universe columns, `shrout`,
and the cumulative factors, so no join is needed:

```sql
SELECT permno, dlycaldt, dlyprc, dlyret, dlycap, dlyvol, shrout, dlycumfacpr
FROM crsp.dsf_v2
WHERE dlycaldt BETWEEN %(start)s AND %(end)s
  AND sharetype = 'NS' AND securitytype = 'EQTY' AND securitysubtype = 'COM'
  AND usincflg = 'Y' AND issuertype IN ('ACOR','CORP')
  AND primaryexch IN ('N','A','Q');
```

Use `crsp.stkdlysecuritydata` (32 columns) instead of the primary file only when you need
quotes, OHLC, previous-period values, or the denormalized dividend amounts — it is ~3×
the size.

## Monthly Panel

No join required: `stkmthsecuritydata` carries identifiers and the universe columns
as of `mthprcdt`.

```sql
SELECT permno, mthcaldt, mthprc, mthret, mthretx, mthcap, mthvol,
       ticker, issuernm, mthcompflg
FROM crsp.stkmthsecuritydata
WHERE mthcaldt BETWEEN %(start)s AND %(end)s
  AND sharetype = 'NS' AND securitytype = 'EQTY' AND securitysubtype = 'COM'
  AND usincflg = 'Y' AND issuertype IN ('ACOR','CORP')
  AND primaryexch IN ('N','A','Q');
```

`mthcompflg` / `mthcompsubflg` report whether the underlying daily data was complete for
the month. Same idea at quarterly (`qtrcompflg`) and annual (`anncompflg`) frequency —
the annual file exists precisely so studies can avoid scanning the ~100M-row daily file.

## Market Capitalization and Weights

Read it, do not compute it. `dlycap` / `mthcap` are CRSP's own capitalization in
**$ thousands**.

For value-weighted portfolio returns, use the **previous** period's cap — already on the
row, no `LAG()`:

```sql
SELECT dlycaldt,
       sum(dlyprevcap * dlyret) / nullif(sum(dlyprevcap), 0) AS vw_ret,
       avg(dlyret)                                           AS ew_ret,
       count(*)                                              AS n
FROM crsp.stkdlysecuritydata
WHERE dlycaldt BETWEEN %(start)s AND %(end)s
GROUP BY dlycaldt ORDER BY dlycaldt;
```

`dlyprevcap` respects trading gaps and delisting conventions in a way a self-join on the
prior calendar day does not. `dlyprevprc` and `dlyprevdt` are the matching price and
date.

## Delistings

**The delisting return is already in `dlyret`/`mthret`.** Verified for PERMNO 10002,
delisted 2013-02-15:

```sql
SELECT permno, dlycaldt, dlyprc, dlyprcflg, dlyret, dlydelflg
FROM crsp.stkdlysecurityprimarydata
WHERE permno = 10002 AND dlycaldt BETWEEN '2013-02-14' AND '2013-02-20'
ORDER BY dlycaldt;
```

```
 permno |  dlycaldt  |  dlyprc  | dlyprcflg |  dlyret   | dlydelflg
--------+------------+----------+-----------+-----------+-----------
  10002 | 2013-02-14 | 2.920000 | TR        | -0.010170 | N
  10002 | 2013-02-15 | 2.980000 | TR        |  0.020548 | N
  10002 | 2013-02-19 | 0.000000 | DA        |  0.010906 | Y
```

The final row is the delisting return (`dlyprcflg = 'DA'`, `dlydelflg = 'Y'`). Do not
merge `stkdelists` and add `delret`.

Use `crsp.stkdelists` for the *reason*:

```sql
SELECT permno, delistingdt, delactiontype, delstatustype, delreasontype,
       delpaymenttype, delpermno, delpermco, delnextdt, delnextprc, deldivamt
FROM crsp.stkdelists
WHERE delistingdt BETWEEN %(start)s AND %(end)s;
```

Only delisted securities appear here — an inner join is an implicit "delisted only"
filter. Legacy `DLPRC` corresponds to `delnextprc`, **not** `deldtprc`.

## Cumulative Adjustment Factors

`CFACPR` / `CFACSHR` moved to their own tables. Verified for Apple's 4:1 split on
2020-08-31:

```sql
SELECT permno, dlycaldt, dlyshrout, dlycumfacpr, dlycumfacshr
FROM crsp.stkdlycumulativeadjfactor
WHERE permno = 14593 AND dlycaldt BETWEEN '2020-08-28' AND '2020-09-02'
ORDER BY dlycaldt;
```

```
 permno |  dlycaldt  | dlyshrout |  dlycumfacpr   |  dlycumfacshr
--------+------------+-----------+----------------+----------------
  14593 | 2020-08-28 |   4275634 | 4.000000000000 | 4.000000000000
  14593 | 2020-08-31 |  17102536 | 1.000000000000 | 1.000000000000
```

`crsp.stkmthcumulativeadjfactor` is the monthly twin. `crsp.dsf_v2` / `msf_v2` carry
these columns inline, so joining is only needed against the CRSP-native tables.

## Distributions and Dividends

```sql
SELECT permno, disexdt, disseqnbr, distype, disdetailtype, disfreqtype,
       disordinaryflg, disdivamt, disfacpr, disfacshr, dispaydt
FROM crsp.stkdistributions
WHERE permno = %(permno)s ORDER BY disexdt, disseqnbr;
```

`disdivamt` is **NULL**, not 0, for splits and other non-cash distributions — use
`coalesce(disdivamt, 0)` for legacy semantics. `disseqnbr` disambiguates same-ex-date
events.

For daily dividend amounts you usually do not need this table at all:
`crsp.stkdlysecuritydata` carries `dlyorddivamt`, `dlynonorddivamt`, and `dlyfacprc`
already denormalized onto the return row, plus `dlydistretflg` categorising what kind of
distribution (if any) drove the day's return.

Joining `stkdistributions` to a monthly panel duplicates rows when a security has two
distributions in a month. Aggregate first:

```sql
SELECT permno, date_trunc('month', disexdt) AS mth,
       sum(coalesce(disdivamt,0)) AS div_amt, count(*) AS n_dist
FROM crsp.stkdistributions GROUP BY 1,2;
```

## Market and Benchmark Index Returns

There is no `vwretd` column in CIZ. Join the index series table on `indno`.

| Legacy variable | INDNO | Index name | CIZ column |
|-----------------|-------|-----------|------------|
| `VWRETD` | 1000200 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Value-Weighted | `DlyTotRet` / `MthTotRet` |
| `VWRETX` | 1000200 | same | `DlyPrcRet` / `MthPrcRet` |
| `EWRETD` | 1000201 | CRSP NYSE/NYSEMKT/Nasdaq/Arca Equal-Weighted | `DlyTotRet` / `MthTotRet` |
| `EWRETX` | 1000201 | same | `DlyPrcRet` / `MthPrcRet` |
| `SPRTRN` | 1000502 | S&P 500 Composite | `DlyPrcRet` / `MthPrcRet` |

Verified:

```sql
SELECT m.permno, m.mthcaldt, m.mthret, i.mthtotret AS vwretd, i.mthprcret AS vwretx
FROM crsp.stkmthsecuritydata m
JOIN crsp.indmthseriesdata i ON i.mthcaldt = m.mthcaldt AND i.indno = 1000200
WHERE m.permno = 14593 AND m.mthcaldt >= '2025-09-01' ORDER BY m.mthcaldt;
```

```
 permno |  mthcaldt  |  mthret   |  vwretd
--------+------------+-----------+----------
  14593 | 2025-09-30 |  0.096881 | 0.035626
  14593 | 2025-10-31 |  0.061815 | 0.019284
  14593 | 2025-11-28 |  0.032360 | 0.001997
  14593 | 2025-12-31 | -0.025067 | 0.001297
```

Porting shortcut: `crsp.dsp500_v2` / `crsp.msp500_v2` keep the legacy column names
(`vwretd, vwretx, ewretd, ewretx, spindx, sprtrn, totval, totcnt, usdval, usdcnt`).

## S&P 500 Membership

Membership lives under the **CRSP Index of the S&P 500 Universe** (`indno = 1000500`),
not the published composite (`1000502`, which has no membership rows).

```sql
SELECT permno, mbrstartdt, mbrenddt, mbrflg
FROM crsp.stkindmembership_ind
WHERE indno = 1000500;
```

1,956 distinct PERMNOs as of 2026-07-26. `crsp.msp500list_v2` is the same content in the
same shape, for code that expects the legacy table name.

Point-in-time membership on a given date:

```sql
SELECT d.permno, d.dlycaldt, d.dlyret
FROM crsp.stkdlysecurityprimarydata d
JOIN crsp.stkindmembership_ind m
  ON  m.permno = d.permno AND m.indno = 1000500
 AND  d.dlycaldt BETWEEN m.mbrstartdt AND m.mbrenddt
WHERE d.dlycaldt BETWEEN %(start)s AND %(end)s;
```

## Linking to Compustat (CCM)

**Unchanged by CIZ.** The link table is still keyed on `lpermno`, so existing CCM code
ports as-is once the CRSP side is CIZ. Verified for Apple:

```sql
SELECT l.gvkey, l.lpermno, l.linktype, l.linkprim, l.linkdt, l.linkenddt
FROM crsp.ccmxpf_lnkhist l
WHERE l.lpermno = 14593 AND l.linktype IN ('LU','LC') AND l.linkprim IN ('P','C');
```

```
 gvkey  | lpermno | linktype | linkprim |   linkdt   | linkenddt
--------+---------+----------+----------+------------+-----------
 001690 |   14593 | LU       | P        | 1980-12-12 |
```

Full merge:

```sql
SELECT c.gvkey, c.datadate, m.permno, m.mthcaldt, m.mthret, m.mthcap
FROM comp.funda c
JOIN crsp.ccmxpf_lnkhist l
  ON  l.gvkey = c.gvkey
 AND  l.linktype IN ('LU','LC') AND l.linkprim IN ('P','C')
 AND  c.datadate BETWEEN l.linkdt AND coalesce(l.linkenddt, current_date)
JOIN crsp.stkmthsecuritydata m
  ON  m.permno = l.lpermno
 AND  m.mthcaldt BETWEEN c.datadate AND c.datadate + interval '1 year'
WHERE c.indfmt = 'INDL' AND c.datafmt = 'STD'
  AND c.popsrc = 'D' AND c.consol = 'C';
```

WRDS also publishes a CIZ-specific sample program, *Merging CRSP and Compustat using CCM
(CIZ format)*, on its CRSP sample-programs page.

## Looking Up Flags and Columns

Never guess a flag value. Two-step lookup — find the flag type for a column, then its
values:

```sql
SELECT itemname, itemdesc, itemflagtype
FROM crsp.metaiteminfo WHERE itemname = 'DlyPrcFlg';

SELECT flagvalue, flagdesc, flagdef
FROM crsp.metaflaginfo WHERE flagtype = 'PC' ORDER BY flagvalue;
```

Verified example — `flagtype = 'RD'` (Daily Return Duration Flag): `D1` = 1 trading day
and 1 calendar day (the ordinary case), `D2`–`D4` = 1 trading day spanning 2–4 calendar
days (weekends, holidays), `DU` = 1 trading day and ≥5 calendar days, `P1`–`P9` =
multi-period returns spanning 2–10 trading periods, `MR` = missing return, `DD` = other
daily delisting duration.

Find the CIZ column for a legacy one:

```sql
SELECT sizitemname, cizfilename, cizitemname, cizitemdesc, sizcolmapseq
FROM crsp.metasiztociz
WHERE sizitemname = 'PRC' ORDER BY sizcolmapseq;
```

Check coverage before designing around a column:

```sql
SELECT itemname, colcountpct, colcountidpct, colmindt, colmaxdt
FROM crsp.metacolumncoverage WHERE filename = 'StkDlySecurityData';
```

Trading-day calendar without deriving it:

```sql
SELECT caldt, tradingflg, holidayflg, weekendflg, datestatusflg
FROM crsp.metaexchangecalendar
WHERE caldt BETWEEN '2001-09-10' AND '2001-09-18' ORDER BY caldt;
```

## Rebuilding Legacy MSE-Style Tables

WRDS does not host `msedelist`/`msedist`/`msenames`/`mseshares` in CIZ form — it
publishes rebuild code instead. SQL translations of the WRDS SAS programs:

**MSENames:**

```sql
SELECT permno, secinfostartdt AS namedt, secinfoenddt AS nameendt,
       cusip AS ncusip, hdrcusip, ticker, issuernm AS comnam,
       shareclass AS shrcls, tradingsymbol AS tsymbol,
       primaryexch AS primexch, tradingstatusflg AS trdstat,
       conditionaltype AS secstat, siccd, naics,
       nasdcompno AS compno, nasdissuno AS issuno,
       sharetype, securitytype, securitysubtype, usincflg, issuertype
FROM crsp.stksecurityinfohist;
```

**MSEDelist:**

```sql
SELECT DISTINCT a.*, b.permco, b.primaryexch AS primexch, b.conditionaltype,
       b.siccd, b.hdrcusip, b.cusip, b.nasdcompno AS compno, b.nasdissuno AS issuno
FROM crsp.stkdelists a
LEFT JOIN crsp.stksecurityinfohist b
  ON  b.permno = a.permno
 AND  a.delistingdt BETWEEN b.secinfostartdt AND b.secinfoenddt;
```

(rename `delistingdt→dlstdt`, `delpermno→nwperm`, `delpermco→nwcomp`,
`delnextdt→nextdt`, `delamtdt→dlpdt`, `deldivamt→dlamt`)

**MSEDist** — same shape against `crsp.stkdistributions` joined on
`disexdt BETWEEN secinfostartdt AND secinfoenddt`, renaming `disdivamt→divamt`,
`disfacpr→facpr`, `disfacshr→facshr`, `disdeclaredt→dclrdt`, `disexdt→exdt`,
`disrecorddt→rcrddt`, `dispaydt→paydt`, `dispermno→acperm`, `dispermco→accomp`.

**MSEShares** — `crsp.stkshares` joined the same way, renaming `shrstartdt→shrsdt`,
`shrenddt→shrenddt`.

Columns that **cannot** be rebuilt: `SHRCD`, `DISTCD`, `DLSTCD`, `EXCHCD`, `DLRETX`.
WRDS explicitly declines to reverse-engineer the packed codes. See
`known-differences.md` for the row-count differences you will see against the legacy
tables.

## Performance Notes

- The January-2024 universe-joined daily query above ran in **1.9 s**. Index-series and
  single-PERMNO lookups ran in 12–25 ms. Full-history daily pulls are a different
  animal — `StkDlySecurityData` is ~20 GB / ~100M rows.
- Prefer `stkdlysecurityprimarydata` (~7 GB, 12 columns) whenever the extra 20 columns
  are unused. Same row count, under a quarter of the bytes.
- Prefer the pre-aggregated `stkmth`/`stkqtr`/`stkannsecuritydata` files over aggregating
  the daily file yourself — that is what the completeness flags are for.
- Filter on `dlycaldt`/`mthcaldt` ranges before joining. Push the universe predicate into
  the same `WHERE` clause rather than filtering in pandas after the pull.
- Bulk pulls belong on the WRDS Cloud via `qsub`, never on the login node. See
  `skills/wrds/SKILL.md`.
