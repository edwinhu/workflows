# Known SIZ vs CIZ Value Differences

WRDS compared every data item between the legacy SIZ and new CIZ formats. **The vast
majority match exactly.** The discrepancies below are documented, investigated, and in
most cases confirmed by CRSP as intentional convention changes — they are not bugs to
work around, and they are not yours to "fix".

Source: WRDS *SIZ to CIZ Transition FAQ — Stock*, WRDS *Recreate Legacy MSE Style
Tables*, CRSP *Cross-Reference Guide* and *Executive Summary of Differences*.

## Contents

- [Monthly Returns — the big one](#monthly-returns--the-big-one)
- [Delisting Prices and Amounts](#delisting-prices-and-amounts)
- [Shares Outstanding](#shares-outstanding)
- [Market Capitalization](#market-capitalization)
- [SIC Code](#sic-code)
- [Distribution Factor to Adjust Price](#distribution-factor-to-adjust-price)
- [Distribution Dividend Amount Missingness](#distribution-dividend-amount-missingness)
- [Monthly Volume](#monthly-volume)
- [Row-Count Differences That Are Not Value Differences](#row-count-differences-that-are-not-value-differences)
- [Duplicate Rows in WRDS Query Tables](#duplicate-rows-in-wrds-query-tables)

## Monthly Returns — the big one

`MthRet` and legacy `RET` (from `crsp.msf`) are **different estimators of different
quantities**, not the same number under a new name.

| | Legacy `RET` | CIZ `MthRet` |
|---|---|---|
| Basis | Month-end price to month-end price | Compound of daily returns within the month |
| Dividend reinvestment | At month-end | On the ex-date |
| Missing month-end price | Loses **two** consecutive months of returns | Unaffected |
| Partial first month | Lost (new securities, all NASDAQ at 1972-12-14) | Captured |
| Delisting proceeds | Assumed received at delisting payment date | Compounded through the daily series |

Magnitude of the divergence, as measured by WRDS across the full panel:

| Absolute return difference | Stock-months |
|----------------------------|--------------|
| > 100% | 90 |
| > 50% | 355 |
| > 5% | 3,479 |

The largest cases are concentrated in (1) months with trading gaps, where the SIZ number
is contaminated by stale prices, and (2) months with distributions, where the
reinvestment-timing assumption bites. Example: PERMNO 15017, December 2017 —
`MthRet = 111.79%` vs legacy `RET = 769.57%`, a difference of 6.58. `MthRetFlg = 'GP'`
flags the gap.

The same methodology change applies to **delisting returns** (`DelRet`), where CRSP
warns the divergence can be larger still.

**Implication for replication:** a paper whose monthly returns came from SIZ will not
reproduce exactly on CIZ, and no amount of coding fixes that. Say so in the write-up
rather than tuning the query until the numbers agree. WRDS published a separate note,
*Comment on CRSP CIZ Monthly Return*, for the full analysis.

Daily returns, by contrast, show negligible differences between the formats.

## Delisting Prices and Amounts

Two separate issues, often mistaken for one bug (~20,000 apparently mismatched records).

**1. You are comparing the wrong column.** Legacy `SFZ_DEL.DLPRC` contains the price on
`NEXTDT`. In CIZ, `DelDtPrc` is the price on the *delisting date* and `DelNextPrc` is the
price on `DelNextDt`. `DLPRC` maps to **`DelNextPrc`**.

**2. Convention change on the amount.** Legacy `DLAMT` contained either post-delisting
distribution amounts *or* the `NEXTDT` price. CIZ `DelDivAmt` contains **only**
post-delisting distribution amounts, and is zero when there are none — even when
`DelNextPrc` is non-missing.

## Shares Outstanding

About 70 PERMNOs differ from legacy `SHROUT`, always by **exactly 1** (thousand shares).

Cause: single-precision (32-bit) vs double-precision (64-bit) storage of `FacShr`,
combined with rounding to the nearest integer. CRSP's worked example: a prior `ShrOut` of
66,940 adjusted by `FACSHR = -0.9750` gives 66,940 × (1 − 0.9750) = 1673.5 → rounds to
**1674** in CIZ. In the legacy single-precision system, −0.9750 was stored as
−0.97500002384, giving 1673.4984 → rounds to **1673**.

Separately, in the rebuilt `MseShares`-style comparison, 88 records show genuinely
different `ShrOut` values (mean difference 1.23%, median 0.07%) — same rounding family.

CRSP calls this known and accepted. It is not correctable and not material.

## Market Capitalization

50+ PERMNOs show `DlyCap ≠ legacy TCAP`. Three distinct causes, all accepted:

1. **Share rounding propagation.** A one-thousand-share difference times the price gives
   a cap difference equal to the price. PERMNO 88007 on 1994-09-29: `DlyCap = 22,224` vs
   `TCAP = 22,212`, price $12.
2. **Improved bid/ask-average precision** for quotes in 32nds and 64ths, multiplied by
   large share counts.
3. **Floating-point limits.** Caps range from 1.75 to ~3×10⁹; double precision carries
   ~14 significant digits, so differences up to ~0.0001 are structural.

This is one more reason to read `dlycap` off the row rather than computing
`dlyprc × shrout` — your recomputation will not match CRSP's and the difference will
look like a data error.

## SIC Code

100+ PERMNOs have `SICCD = 0` in `StkSecurityInfoHdr` where legacy `HSICCD` had a valid
code.

Definitional change: legacy `HSICCD` was "the last **non-zero** SICCD"; CIZ `SICCD` in
the header is "the SICCD from the **last active name record**", zero or not. PERMNO 10859
carried 5031 on the name record valid 1972-12-14 → 1973-05-03, but its final active name
record (1973-05-04 → 1978-10-03) has SICCD 0, so the header shows 0.

If you need the legacy behaviour, take the last non-zero `siccd` from
`stksecurityinfohist` yourself — and note that you did.

## Distribution Factor to Adjust Price

Seven records where CIZ `DisFacPr = 0` and legacy `FACPR` was non-zero (e.g. PERMNO 40388
on 1997-05-01: legacy 40.70%, CIZ 0.00%).

Convention change: the price factor for spin-offs is the dividend amount divided by the
ex-date price. For distributions **after delisting** the ex-date price is unknown, so CIZ
sets `DisFacPr` to zero (no impact). CRSP indicated it will likely edit the seven legacy
records to match.

## Distribution Dividend Amount Missingness

Legacy `divamt` was **never missing** — no amount meant 0. CIZ `DisDivAmt` is **NULL**
for distribution types that have no cash amount.

Concrete case: legacy `DISTCD = 5523` had `divamt = 0` throughout. The CIZ equivalent
(`DisType = 'FRS'`, `DisPaymentType = 'SS'`, `DisDetailType = 'STKSPL'`) has
`DisDivAmt` missing.

Consequence: `SUM(disdivamt)`, `AVG(disdivamt)`, and any `WHERE disdivamt = 0` behave
differently than the legacy code they were ported from. Use
`coalesce(disdivamt, 0)` when you need legacy semantics.

## Monthly Volume

Large `MthVol` vs legacy `VOL` gaps for some securities — e.g. Citigroup (PERMNO 70519)
in 2009-08, 2009-12, and 2010-12, and PERMNO 17854 in 2021-01.

This one is **not** a CIZ change. CRSP corrected the monthly volume problem in SIZ
several years ago; WRDS never loaded that SIZ correction. So the CIZ values are right and
the WRDS-hosted SIZ values are the stale ones.

Note also the unit change when comparing: legacy `VOL` is quoted in units of 100.

## Row-Count Differences That Are Not Value Differences

- **`StkDelists` has far fewer rows than `SFZ_DEL`.** Legacy carried a row for every
  security, including active ones (`DLSTCD = 100`, `DLSTDT` artificially set to the most
  recent period end). CIZ includes only genuinely delisted securities. PERMNO 14593
  (Apple) has no `StkDelists` row. An inner join to `stkdelists` is now an implicit
  "delisted only" filter.

- **`StkSecurityInfoHist` has more rows than `msenames`.** Two causes: CIZ emits a
  separate one-day record for the delisting event (`TradingStatusFlg = 'D'`), and it
  splits intervals on `ExchangeTier` changes that SIZ ignored. PERMNO 10001: 14 CIZ rows
  vs 10 legacy rows.

- **`StkShares` splits intervals more finely than `mseshares`.** PERMNO 10001's single
  legacy record 1986-06-30 → 1986-09-29 (`SHROUT = 985`) becomes two CIZ records
  (1986-06-30 → 1986-09-01 with `ShrSource = 'OBS'`, and 1986-09-02 → 1986-09-29 with
  `ShrSource = 'NC'`), both with `ShrOut = 985`. Comparing on exact date ranges produces
  a *false* mismatch.

## Duplicate Rows in WRDS Query Tables

The WRDS-built Daily and Monthly Stock File queries (and `dsf_v2`/`msf_v2` lineage) join
stock data to shares, distributions, and index data in one table. When a security has
**more than one distribution in a period**, the join duplicates the stock row.

Documented example: Apple, August 2020 — a cash dividend with ex-date 2020-08-07 and a
4:1 split with ex-date 2020-08-31. The August 2020 monthly row appears twice.

This behaviour existed in the legacy WRDS queries too. If duplicates matter, query
`crsp.stkdlysecuritydata` / `crsp.stkmthsecuritydata` directly — they have no duplicates
— and join `crsp.stkdistributions` yourself with an explicit aggregation.
