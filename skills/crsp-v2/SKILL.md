---
name: crsp-v2
version: 1.0
description: Use when "CRSP CIZ", "CRSP v2", "CRSP flat file format 2.0", "crsp.dsf_v2 / msf_v2", "StkDlySecurityData", "StkMthSecurityData", "StkSecurityInfoHist", "stocknames_v2", "DlyRet / MthRet / DlyPrc / MthPrc", "SHRCD or EXCHCD equivalent in new CRSP", "SIZ to CIZ migration", "CRSP data after 2024", "CRSP delisting returns", "CRSP cumulative adjustment factors", "CRSP index INDNO / INDFAM", or any CRSP stock/index query where the legacy SIZ column names no longer exist.
user-invocable: false
---

## Contents

- [Format Enforcement](#format-enforcement)
- [Universe Enforcement](#universe-enforcement)
- [Return Enforcement](#return-enforcement)
- [What Changed at a Glance](#what-changed-at-a-glance)
- [Table Map](#table-map)
- [Canonical Queries](#canonical-queries)
- [Additional Resources](#additional-resources)

## Format Enforcement

### IRON LAW: NO LEGACY SIZ TABLE FOR ANY DATA AFTER 2024-12-31

<EXTREMELY-IMPORTANT>
CRSP's legacy Stock & Indexes Flat File Format 1.0 (SIZ) was **discontinued after the
December 2024 data release**. The legacy tables still exist on WRDS and still answer
queries — they just stop.

Verified on WRDS PostgreSQL (2026-07-26):

| Table | Format | `max(date)` |
|-------|--------|-------------|
| `crsp.dsf` | legacy SIZ | **2024-12-31** |
| `crsp.stkdlysecurityprimarydata` | CIZ | **2025-12-31** |
| `crsp.stkmthsecuritydata` | CIZ | **2025-12-31** |

- `SELECT ... FROM crsp.dsf WHERE date >= '2025-01-01'` → **WRONG. Returns zero rows, silently.**
- `SELECT ... FROM crsp.msf WHERE date >= '2025-01-01'` → **WRONG. Same silent truncation.**
- `SELECT ... FROM crsp.stkdlysecurityprimarydata` → **CORRECT.**

A legacy query does not error when it runs off the end of the data. It returns a
short panel, the regression runs, and the sample period is quietly wrong.
</EXTREMELY-IMPORTANT>

**Handing back a silently truncated panel is not helpful — it is worse than an error,
because the user ships it.** You reach for `crsp.dsf` because the legacy names are in
your weights and in every paper you have read. The weights are stale. Confirm the
format before writing the first `SELECT`.

### Red Flags — STOP Immediately If You're About To:

- **Write `crsp.dsf`, `crsp.msf`, `crsp.dse`, `crsp.dsedelist`, or `crsp.stocknames`** → STOP. Legacy SIZ, frozen at 2024-12-31. Use the CIZ table (`references/tables.md`).
- **Write `WHERE shrcd IN (10,11)`** → STOP. `shrcd` does not exist in CIZ. Five columns replace it (below).
- **Write `WHERE exchcd IN (1,2,3)`** → STOP. `exchcd` does not exist in CIZ. Use `primaryexch`.
- **Write `abs(prc)` or `WHERE prc > 0`** → STOP. CIZ prices are always positive. Use `dlyprcflg`.
- **Add a delisting return to `dlyret`/`mthret`** → STOP. CIZ already embeds it. You are double-counting.
- **Assume `mthret` reproduces legacy `ret`** → STOP. Different methodology (compounded daily). See `references/known-differences.md`.
- **Guess what a flag value means** → STOP. `references/flags.md` has all 774 values; `crsp.metaflaginfo` is live.
- **Substitute `comp.secd` (or any Compustat price table) because CIZ ran out at 2025-12-31** → STOP. Use the `crsp-lseg-splice` skill. `secd` carries no delisting returns, null `trfd` on ~48% of firm-days, and `ajexdi` that goes stale through corporate actions (one gvkey prints +17,700% on an unadjusted reverse split). It also applies none of CIZ's universe screens, so its cross-section is not comparable: measured on one event-study design, swapping CRSP for `secd` left Delaware flat at ~2,075 firms while doubling non-Delaware from 968 to 1,923.

### Format Facts

- The CIZ format shipped in July 2022 and became the only updated format in February 2025 (December 2024 data was the last SIZ release). Both formats sit in the **same** `crsp` schema in Postgres and the same `crsp` library in SAS — the schema name does not tell you which format you are in. The table name does. Reporting "I queried the `crsp` schema, so this is v2 data" is an unverified claim presented as fact.
- WRDS-built convenience tables keep their legacy names with a `_v2` suffix: `crsp.dsf_v2`, `crsp.msf_v2`, `crsp.stocknames_v2`. CRSP-built tables use the new CIZ names (`crsp.stkdlysecuritydata`). Both are CIZ; the `_v2` ones are pre-joined and wider. Treating the absence of a `_v2` suffix as evidence a table is legacy sends you back to the frozen data.
- On the WRDS Cloud filesystem, SIZ stays at `/wrds/crsp/sasdata/a_stock` and CIZ is at `/wrds/crsp/sasdata/a_stock_v2`.
- Column names carry their frequency as a prefix: `Dly`, `Mth`, `Qtr`, `Ann`. There is no frequency-agnostic `ret` or `prc` in CIZ — `DlyRet` and `MthRet` are different columns in different tables, not the same column read from two files.
- The `62` suffix (`crsp.stkdlysecuritydata62`) is the 1962-start subset product; the `_ind` suffix (`crsp.stkindmembership_ind`) is the full Index database. Stock-only products carry just 4 index series; `crsp.indseriesinfohdr_ind` carries 274. Querying the wrong one returns zero rows rather than an error, so "that index isn't in CRSP" is usually the wrong suffix, not a missing index.

## Universe Enforcement

### IRON LAW: NO CIZ COMMON-STOCK SAMPLE WITHOUT ALL FIVE COLUMNS

<EXTREMELY-IMPORTANT>
Legacy `SHRCD IN (10, 11)` was unpacked into **five** CIZ columns across two tables.
No single column reproduces it.

```sql
sharetype       = 'NS'                 -- No Special Share Type
AND securitytype    = 'EQTY'
AND securitysubtype = 'COM'
AND usincflg        = 'Y'
AND issuertype      IN ('ACOR', 'CORP')
```

- `WHERE sharetype = 'COM'` → **WRONG. Returns 0 rows.** `COM` lives at the *SecuritySubType* level; `ShareType` is never `'COM'` in CIZ. CRSP support confirmed this in writing.
- `WHERE securitysubtype = 'COM'` alone → **WRONG.** Picks up non-US-incorporated firms, ADRs (`sharetype='AD'`), and REITs (`issuertype='REIT'`) that legacy `SHRCD` excluded.
- All five, ANDed → **CORRECT.**
</EXTREMELY-IMPORTANT>

**A universe that silently differs from `SHRCD IN (10,11)` breaks comparability with
every prior paper in the literature — that is an anti-helpful result dressed as a
working query.** The one-column version is faster to type and returns plausible row
counts, which is exactly why it survives review.

Verified distribution in `crsp.stksecurityinfohist` (2026-07-26): `EQTY/COM/NS/CORP/Y`
= 90,515 rows and `EQTY/COM/NS/ACOR/Y` = 21,682 rows are the two `SHRCD 10/11` cells;
`EQTY/COM/AD/CORP/N` (6,279 ADR rows) and `EQTY/COM/NS/REIT/Y` (2,347 REIT rows) are
what the sloppy filter lets in.

### Exchange Facts

- `EXCHCD` is gone. `primaryexch` is a single letter: `N` (NYSE), `A` (NYSE American), `Q` (NASDAQ), `R` (NYSE ARCA), `B` (BATS), `I` (IEX), `C` (Consolidated), `X` (Unknown), `N/A`.
- `EXCHCD IN (1,2,3)` maps to `primaryexch IN ('N','A','Q')` — but `primaryexch` alone also carries the halted and suspended records that legacy `EXCHCD` split into `-2` and `-1`. To reproduce legacy `EXCHCD IN (1,2,3)` exactly, add `conditionaltype = 'RW' AND tradingstatusflg = 'A'`.
- Legacy `EXCHCD = -2` (halted) → `tradingstatusflg = 'H'`. Legacy `EXCHCD = -1` (suspended) → `tradingstatusflg = 'S'`.
- The universe columns live on the **history** table (`stksecurityinfohist`, one row per attribute-change interval), not only the header. Filtering on `stksecurityinfohdr` applies today's classification to the whole 1925–2025 panel and back-fills survivorship into the sample.

### CUSIP Facts

- CIZ **inverted the CUSIP naming**. `CUSIP` is now the *historical* CUSIP (legacy `NCUSIP`); `HdrCUSIP` is the *header/most-recent* CUSIP (legacy `CUSIP`).
- Code ported from SIZ that joins on `cusip` therefore changes meaning silently — it starts joining on the historical value. For a point-in-time match to Compustat/IBES this is usually what you wanted; for a header match it is a bug.

## Return Enforcement

### IRON LAW: NEVER ADD A DELISTING RETURN TO A CIZ RETURN

<EXTREMELY-IMPORTANT>
In SIZ, delisting returns lived only in `crsp.dsedelist`/`msedelist` and every
researcher hand-merged them in. **CIZ embeds the delisting return directly in the
daily and monthly return series.**

Verified for PERMNO 10002 (delisted 2013-02-15):

| dlycaldt | dlyprc | dlyprcflg | dlyret | dlydelflg |
|----------|--------|-----------|--------|-----------|
| 2013-02-14 | 2.92 | `TR` | -0.010170 | `N` |
| 2013-02-15 | 2.98 | `TR` | 0.020548 | `N` |
| 2013-02-19 | 0.00 | `DA` | **0.010906** | `Y` |

The 2013-02-19 row *is* the delisting return. `crsp.stkdelists` still exists, but it is
for the delisting *reason* and *event* detail — not for patching the return series.

- `coalesce(dlyret,0) + coalesce(dlret,0)` → **WRONG. Double-counts.**
- `(1+dlyret)*(1+dlret)-1` → **WRONG. Same double-count, compounded.**
- Use `dlyret` as-is → **CORRECT.**
</EXTREMELY-IMPORTANT>

**Silently inflating delisting-month returns reintroduces exactly the survivorship
artifact the merge was supposed to fix.** The old merge is muscle memory and the
result looks normal — the bias only shows up in the delisting tail, which is where
the identification usually lives.

### Return Facts

- `MthRet` is a **compound of daily returns within the month**, with dividends reinvested on the ex-date. Legacy `RET` was a month-end-to-month-end holding period return with dividends reinvested at month-end. These are different estimators, not a renaming. WRDS found 90 stock-months differing by >100% and 3,479 differing by >5%.
- The same change applies to delisting returns (`DelRet`), where the divergence can be larger.
- `DLRETX` (delisting return without dividends) **does not exist** in CIZ. There is no substitute.
- `DlyRetMissFlg` and `DlyRetDurFlg` explain missing and multi-period returns. `DlyRetDurFlg = 'D1'` is the ordinary adjacent-trading-day case; `P1`–`P9` mean the return spans 2–10 trading periods; `MR` means missing. Filtering on this flag replaces the old ad-hoc "drop returns after a gap" heuristics.
- `DlyPrc` is always positive. The bid-ask-average case that legacy encoded as a negative price is now `DlyPrcFlg = 'BA'`; a real closing trade is `'TR'`; a delisting amount is `'DA'`. Never call `abs()`.

## What Changed at a Glance

| Concept | Legacy SIZ | CIZ (v2) |
|---------|-----------|----------|
| Daily price | `prc` (negative = bid/ask avg) | `dlyprc` (always positive) + `dlyprcflg` |
| Daily return | `ret` | `dlyret` (delisting return included) |
| Monthly return | `ret` from `msf` | `mthret` (compounded daily) |
| Common stock | `shrcd IN (10,11)` | 5 columns (see above) |
| Exchange | `exchcd IN (1,2,3)` | `primaryexch IN ('N','A','Q')` |
| Historical CUSIP | `ncusip` | `cusip` |
| Header CUSIP | `cusip` | `hdrcusip` |
| Delisting code | `dlstcd` (3-digit) | `delactiontype`, `delstatustype`, `delreasontype`, `delpaymenttype` |
| Distribution code | `distcd` (4-digit) | `distype`, `disfreqtype`, `dispaymenttype`, `disdetailtype`, `distaxtype`, `disorigcurtype`, `disordinaryflg` |
| Adjustment factors | `cfacpr`, `cfacshr` in `dsf` | `crsp.stkdlycumulativeadjfactor` (separate table) |
| Market index | `vwretd` in `dsf` | `indno=1000200` in `crsp.inddlyseriesdata` |
| Issuer attributes | mixed into `stocknames` | `crsp.stkissuerinfohdr` / `stkissuerinfohist` (PERMCO-keyed) |

## Table Map

Most-used CIZ tables. Full catalog with verified columns: `references/tables.md`.

| Table | Grain | Use for |
|-------|-------|---------|
| `crsp.stkdlysecurityprimarydata` | permno × day, 12 cols | Daily returns/prices/cap — **default daily table**, ~7 GB |
| `crsp.stkdlysecuritydata` | permno × day, 32 cols | Adds bid/ask, high/low, open, prev-price, dividend amounts — ~20 GB |
| `crsp.stkmthsecuritydata` | permno × month, 37 cols | Monthly aggregates + identifiers |
| `crsp.stkqtrsecuritydata` / `stkannsecuritydata` | permno × qtr / year | Pre-aggregated panels; check `qtrcompflg`/`anncompflg` |
| `crsp.stksecurityinfohist` | permno × interval | **Universe filters, historical CUSIP/ticker** |
| `crsp.stksecurityinfohdr` | permno | Current/header attributes only |
| `crsp.stkissuerinfohdr` / `stkissuerinfohist` | permco | Issuer-level SIC/NAICS/ICB, non-duplicated issuer counts |
| `crsp.stkshares` | permno × interval | Shares outstanding history |
| `crsp.stkdistributions` | permno × exdt × seq | Dividends, splits, factors |
| `crsp.stkdelists` | permno | Delisting reason/status detail (**not** for returns) |
| `crsp.stkdlycumulativeadjfactor` | permno × day | `dlycumfacpr`, `dlycumfacshr`, `dlyshrout` |
| `crsp.inddlyseriesdata` / `indmthseriesdata` | indno × period | Index returns and levels |
| `crsp.stkindmembership_ind` | permno × indno | Index constituents (S&P 500 = `indno 1000500`) |
| `crsp.dsf_v2` / `msf_v2` / `stocknames_v2` | WRDS-built | Pre-joined convenience tables (identifiers + data + `shrout` + factors) |
| `crsp.metafileinfo`, `metaiteminfo`, `metaflaginfo`, `metasiztociz` | metadata | Self-documenting schema — query these instead of guessing |

## Canonical Queries

All queries below were executed against WRDS PostgreSQL on 2026-07-26. Full set with
output: `references/queries.md`.

**Common-stock daily panel** (the `SHRCD 10/11` + `EXCHCD 1/2/3` equivalent):

```sql
SELECT d.permno, d.dlycaldt, d.dlyprc, d.dlyret, d.dlycap, d.dlyvol
FROM crsp.stkdlysecurityprimarydata d
JOIN crsp.stksecurityinfohist h
  ON h.permno = d.permno
 AND d.dlycaldt BETWEEN h.secinfostartdt AND h.secinfoenddt
WHERE d.dlycaldt BETWEEN %(start)s AND %(end)s
  AND h.sharetype = 'NS' AND h.securitytype = 'EQTY' AND h.securitysubtype = 'COM'
  AND h.usincflg = 'Y' AND h.issuertype IN ('ACOR','CORP')
  AND h.primaryexch IN ('N','A','Q')
  AND h.conditionaltype = 'RW' AND h.tradingstatusflg = 'A';
```

The `BETWEEN secinfostartdt AND secinfoenddt` join is mandatory — it is what makes the
classification point-in-time. Dropping it applies the security's final classification
to its entire history.

**Market capitalization** — do not compute it. `dlycap` (and `mthcap`) is CRSP's own
capitalization in **$ thousands**, already on the row. `dlyprc * shrout` reintroduces
the precision and rounding differences CRSP documented.

**Market index return** — join on `indno`, do not look for `vwretd`:

```sql
SELECT m.permno, m.mthcaldt, m.mthret, i.mthtotret AS vwretd, i.mthprcret AS vwretx
FROM crsp.stkmthsecuritydata m
JOIN crsp.indmthseriesdata i ON i.mthcaldt = m.mthcaldt AND i.indno = 1000200;
```

`1000200` = CRSP NYSE/NYSEMKT/Nasdaq/Arca Value-Weighted (`vwretd`/`vwretx`),
`1000201` = Equal-Weighted (`ewretd`/`ewretx`), `1000502` = S&P 500 Composite
(`sprtrn` = `dlyprcret`/`mthprcret`).

**Compustat merge** — the CCM link is **unchanged** by CIZ. `crsp.ccmxpf_lnkhist` is
still keyed on `lpermno`, so existing CCM code ports as-is once the CRSP side is CIZ.

## Additional Resources

- **`references/tables.md`** — full CIZ table catalog, verified column lists, grain and key columns
- **`references/siz-to-ciz.md`** — column-by-column crosswalk from every legacy SIZ file
- **`references/flags.md`** — all 774 flag values across 62 flag types, dumped from `crsp.metaflaginfo`
- **`references/known-differences.md`** — WRDS/CRSP-documented value discrepancies and the monthly-return methodology change
- **`references/queries.md`** — verified query recipes (universe, delisting, factors, indexes, CCM, MSE-style rebuilds)
- **`references/indexes.md`** — INDNO/INDFAM conventions, the +400 monthly rule, S&P 500 series, decile statistics
- **`examples/ciz_panel.py`** — end-to-end Python pull of a CIZ common-stock panel
- **`${CLAUDE_SKILL_DIR}/../crsp-lseg-splice/SKILL.md`** — CRSP updates annually, so the CIZ daily file stops at the last December. That skill carries the panel forward to T-1 with LSEG via CUSIP→RIC, and has the measured coverage (~91% of the common-stock universe) and the two splice hazards (adjustment basis, foreign-venue RICs).
- **`${CLAUDE_SKILL_DIR}/../../skills/wrds/SKILL.md`** — connection, `.pgpass`, WRDS Cloud/SGE rules (this skill assumes them)
- CRSP source PDFs (WRDS login required): [User Guide](https://wrds-www.wharton.upenn.edu/documents/1996/CRSP_US_Stock__Indexes_Database_Guide_Flat_File_Format_2.0.pdf), [Cross-Reference Guide](https://wrds-www.wharton.upenn.edu/documents/1942/CRSP_Cross_Reference_Guide_1.0_to_2.0.pdf), [Metadata Guide](https://wrds-www.wharton.upenn.edu/documents/1941/CRSP_Metadata_Guide_Flat_File_Format_2.0.pdf), [Executive Summary](https://wrds-www.wharton.upenn.edu/documents/1943/Executive_Summary_File_Format_1.0_SIZ_to_File_Format_2.0_CIZ.pdf)
- WRDS transition pages: [Announcement](https://wrds-www.wharton.upenn.edu/pages/data-announcements/changes-to-crsp-data/), [Transition FAQ](https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/crsp/stocks-and-indices/crsp-ciz-faq/), [Index Overview](https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/crsp/stocks-and-indices/siz-to-ciz-wrds-overview-of-index/), [Recreate MSE Tables](https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/crsp/stocks-and-indices/recreate-legacy-mse-style-tables/)
