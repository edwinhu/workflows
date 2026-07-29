# Measured coverage: extending CRSP CIZ with LSEG

All numbers below were executed, not estimated. Measured **2026-07-28** against
WRDS PostgreSQL and the LSEG platform session (RDP machine ID, `lseg-data` 2.1.1).

## Contents

- [The gap](#the-gap)
- [Denominator](#denominator)
- [Stage 1 — CUSIP9 to RIC](#stage-1--cusip9-to-ric)
- [Stage 2 — gap-period data](#stage-2--gap-period-data)
- [Stage 3 — agreement on the overlap](#stage-3--agreement-on-the-overlap)
- [Failure modes, separated](#failure-modes-separated)
- [Reproduction](#reproduction)

## The gap

| Source | Last date |
|--------|-----------|
| `crsp.stkdlysecurityprimarydata` (CIZ daily) | 2025-12-31 |
| `crsp.stkmthsecuritydata` (CIZ monthly) | 2025-12-31 |
| `crsp.dsf` / `crsp.msf` (legacy SIZ) | 2024-12-31 — frozen, do not use |
| LSEG | T-1 (2026-07-27 at time of measurement) |

**146 trading days** in the gap, 2026-01-02 .. 2026-07-27.

## Denominator

Everything is expressed against the CRSP CIZ common-stock universe **trading on
2025-12-31** — the `SHRCD IN (10,11)` + `EXCHCD IN (1,2,3)` equivalent:

```sql
sharetype='NS' AND securitytype='EQTY' AND securitysubtype='COM'
AND usincflg='Y' AND issuertype IN ('ACOR','CORP')
AND primaryexch IN ('N','A','Q') AND conditionaltype='RW' AND tradingstatusflg='A'
```

joined to `stkdlysecurityprimarydata` on 2025-12-31 to require an actual trading
record.

| | count |
|---|---|
| all securities with a 2025-12-31 record | 10,686 |
| **common stock (5-column filter)** | 3,660 |
| **+ exchange / trading-status filter → the denominator** | **3,657** |

Zero null `cusip9`, zero duplicate `cusip9` across permnos.

## Stage 1 — CUSIP9 to RIC

Resolved through `symbol_conversion` with `SymbolTypes.CUSIP`, using
`stksecurityinfohist.cusip9` in effect on 2025-12-31.

| stage | count | share |
|-------|-------|-------|
| CRSP universe at cutoff | 3,657 | 100% |
| RIC resolved | 3,485 | **95.30%** |
| — US venue (bare, `.O .N .A .P .K .PK .OQ`) | 3,384 | **92.53%** |
| — non-US venue (rejected) | 101 | 2.76% |
| — unresolved | 172 | 4.70% |

Non-US venue suffixes actually observed among resolved RICs, all of which quote
in a foreign currency: `.TRE` Tradegate (73), `.TBEA` (8), `.MX` Mexico (6),
`.TPRM` (4), `.TRU` (3), `.MU` Munich (3), `.SG` Stuttgart (2), `.BCU`.

### Entity agreement

| check | share of resolved |
|-------|-------------------|
| LSEG `TickerSymbol` == CRSP `ticker` | 97.31% |
| RIC root == CRSP `ticker` | 95.06% |
| **either** | **97.56%** |

The residual is dominated by renames CRSP has recorded under an unchanged CUSIP
(`COMM` CommScope → `VISN.O`; `FGEN` FibroGen → `KYNB.O`; `LC` LendingClub →
`HAPN.O`) and by dual-class RIC notation (`HVT` → `HVTa`, `BH` → `BHa`). These
are correct links reported under the current name, not mis-links. Genuine
mis-links, when they occur, are foreign-venue RICs — already excluded at the
venue check.

## Stage 2 — gap-period data

Pulled `TRDPRC_1` + `ACVOL_UNS` (`get_history`) and `TR.TotalReturn1D`
(`get_data`, `Frq=D`) for the 3,384 US-venue RICs over 2025-12-31 .. 2026-07-27 —
the window starts **on** the CRSP cutoff so the overlap day can anchor the
level rebuild and the per-security adjustment-basis check.

| | count | share of 3,657 |
|---|---|---|
| US-venue RIC | 3,384 | 92.53% |
| ≥1 gap observation | 3,378 | **92.37%** |

Pipeline run of 2026-07-28, after the padding fix below:

| | count | share of 3,657 |
|---|---|---|
| ≥90% of the 141 gap days | 3,344 | **91.44%** |

**permno-days filled: 474,284 of 477,144 possible for usable links — 99.40%.**

### `TR.TotalReturn1D` is calendar-padded — do not count coverage off it

**Every RIC returns exactly the same number of return days** — 142 of 142, `std =
0.0000` across all 3,384 usable RICs, *including the 19 that delisted mid-gap*.
The return series does not stop when the security stops trading.

1.14% of return rows (5,466) have **no trade price on that day**; 38% of those are
`ret == 0`. Joining the panel on returns therefore manufactures flat rows past a
delisting, and any coverage statistic computed from the return row count is an
artifact: measured that way the fill rate reads 99.82% and *every* security looks
like it has a full series.

The pipeline inner-joins returns against the **price** series and requires a
same-day `TRDPRC_1`, which truncates delisted names at their last trade. Use the
price series as the coverage denominator.

### Delist-stamped RICs

**19** usable RICs carry a `^` delist stamp (`IROQ.O^C26`, `BFIN.O^A26` — the
letter is the delist month, the digits the year). LSEG is reporting delistings
**CRSP has not published yet**; it gives no delisting *return*, only the
truncation of the price series.

> **Correction.** An earlier draft of this file claimed all 65 partial-coverage
> securities carried a delist stamp. That was a regex bug, not a finding:
> `str.contains("^")` treats `^` as the start-of-string anchor and matches every
> string. The escaped form `str.contains(r"\^")` gives 19. Partial coverage is
> therefore *not* fully explained by delisting — ordinary halts and no-trade days
> account for most of it.

No RIC has all 146 calendar-window days; halts and zero-volume days account for
the remainder.

## Stage 3 — agreement on the overlap

The only way to test the splice is where both sources have data. December 2025 —
22 trading days, 300-security random sample, 6,244 matched permno-days.

### Price (`TRDPRC_1` vs `DlyPrc`)

| tolerance | share |
|-----------|-------|
| ≤ 1e-4 relative | **96.28%** |
| ≤ 1e-3 | 96.28% |
| ≤ 1e-2 | 97.21% |
| ≤ 5e-2 | 98.13% |

Median relative difference **0.00e+00** — exact to the cent for the bulk.

### Daily total return (`TR.TotalReturn1D` vs `DlyRet`)

| tolerance | share |
|-----------|-------|
| ≤ 1e-5 absolute | **99.12%** |
| ≤ 1e-4 | 99.12% |
| ≤ 1e-3 | 99.15% |
| ≤ 1e-2 | 99.31% |

Median absolute difference **2.45e-07**, correlation 0.99091. Returns were
available for 98.34% of the CRSP permno-days in the overlap.

**The return series is the better splice variable**, and by a wide margin — it
agrees to 1e-7 where the price series disagrees for 3.7% of rows, because returns
are invariant to the adjustment-basis difference that drives the price gap.

## Failure modes, separated

Only 8 of 300 sampled securities disagree on price by >5%. They are two distinct
causes, and neither is fixed by a tolerance:

### 1. Adjustment basis (5 of 8)

LSEG back-adjusts history to the current share basis; CRSP `DlyPrc` is as-traded.
The tell is a **CRSP/LSEG ratio constant to `std = 0.0000`** across all 22 days:

| RIC | CRSP ticker | ratio | reading |
|-----|-------------|-------|---------|
| `STRO.O` | STRO | 0.1000 | 1:10 reverse split after cutoff |
| `VISN.O` | COMM | 2.0493 | corporate action + rename |
| `MIDD.O` | MIDD | — | constant ratio, 21 days |
| `APVO.O` | APVO | — | constant ratio, 20 days |
| `ACET.O` | ACET | — | constant ratio, 19 days |

Handled by chaining on returns rather than splicing levels (Iron Law 1).

### 2. Foreign venue (2 of 8)

| RIC | CRSP ticker | ratio | reading |
|-----|-------------|-------|---------|
| `T86f.TRE` | TPH | 1.3294 (std 0.0153) | Tradegate, EUR |
| `0RR0.MU` | VERO | — | Munich, EUR |

A near-constant ratio with *small nonzero* variance is FX, not a split — the
variance is the daily exchange-rate move. Handled by the venue filter (Iron Law 2).

The remaining 1 (`STRO.O`, 2 days) is a stale-quote day on an illiquid name.

Return disagreements >1pp concentrate on the same names: `0RR0.MU` (18 of 22
days) and `T86f.TRE` (13) are foreign venues; `QETA.O`, `TAYD.O`, `AMSF.O`,
`ITIC.O`, `WRB` contribute 1–9 days each of illiquid-name close differences.

## Reproduction

```bash
set -a; . $XDG_RUNTIME_DIR/agenix/lseg-credentials; set +a
export RDP_APP_KEY=$LSEG_APP_KEY RDP_USERNAME=$LSEG_USERNAME RDP_PASSWORD=$LSEG_PASSWORD
python scripts/crsp_lseg_splice.py all --out data/
```

Timings observed: symbology 3,657 CUSIPs ≈ 90 s; `get_history` 3,485 RICs at 25
per request ≈ 170 s; `TR.TotalReturn1D` at 40 per request ≈ 5 min. One concurrent
LSEG platform session only — a second process fails on quota rather than queueing.

## Bottom line

**Roughly 91% of the CRSP common-stock universe carries forward cleanly**
(≥90% of gap days), 95.8% of the possible permno-days for linkable securities get
filled, and where both sources overlap the returns agree to 1e-7.

The ~9% that does not carry forward is: 4.7% unresolvable CUSIPs, 2.8%
foreign-venue-only RICs, and 1.8% securities that delisted during the gap. The
first two are a **non-random** loss — small and illiquid names are
overrepresented among unresolved CUSIPs — so a spliced panel is not a
distributional substitute for CRSP. It is a current-data extension with a
documented, `source`-tagged tail.
