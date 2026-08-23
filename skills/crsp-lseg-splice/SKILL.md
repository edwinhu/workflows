---
name: crsp-lseg-splice
version: 1.0
description: 'Use when "CRSP is stale / out of date", "CRSP only goes through December", "my panel ends in December", "why do my returns stop", "extend CRSP to today", "fill forward CRSP with LSEG", "current stock prices for my CRSP panel", "up-to-date returns for permnos", "splice CRSP and LSEG", "CUSIP to RIC for a CRSP universe", "backfill the CRSP gap", or any request to carry a CRSP daily/monthly stock series past CRSP''s last data date using LSEG/Refinitiv. Use proactively whenever a CRSP panel has to reach a date after CRSP''s annual cutoff, even if the user never mentions LSEG — CRSP returns a short panel without erroring, and a naive concat fabricates the seam return. NEGATIVE ROUTING: a CRSP query that stays inside CRSP''s coverage, or CIZ table and column names, is crsp-v2; LSEG session, quota, entitlement or general symbology questions are lseg-data; raw WRDS PostgreSQL access and connection patterns are wrds — this skill covers only the join between CRSP and LSEG.'
user-invocable: true
---

## Contents

- [The Problem](#the-problem)
- [Splice Enforcement](#splice-enforcement)
- [Symbology Enforcement](#symbology-enforcement)
- [Measured Coverage](#measured-coverage)
- [The Pipeline](#the-pipeline)
- [Additional Resources](#additional-resources)

## The Problem

CRSP ships annually. The CIZ daily file stops at the last December close and does
not error when you query past it — it returns a short panel. LSEG is current to
T-1 but is keyed on RIC, not PERMNO, so the join runs through CUSIP.

Verified 2026-07-28 on WRDS PostgreSQL:

| Source | Last date | Gap |
|--------|-----------|-----|
| `crsp.stkdlysecurityprimarydata` (CIZ) | **2025-12-31** | — |
| `crsp.stkmthsecuritydata` (CIZ) | **2025-12-31** | — |
| LSEG `TRDPRC_1` / `TR.TotalReturn1D` | **T-1** (2026-07-27) | **141 trading days** |

This skill assumes `crsp-v2` (CIZ table and column names) and `lseg-data`
(session, quota, entitlements). It covers only what is specific to joining them.

## Splice Enforcement

### IRON LAW: NO LSEG PRICE LEVEL SPLICED ONTO A CRSP PRICE LEVEL

<EXTREMELY-IMPORTANT>
**LSEG's `get_history` price series is back-adjusted to the CURRENT share basis.
CRSP's `DlyPrc` is the price as traded on the day.** For any security that split
after CRSP's cutoff, the two series are on different bases and the seam between
them is a fabricated return.

Measured on the Dec-2025 overlap, where both sources have the same 22 trading
days: **8 of 300 sampled securities disagree on price by >5%, at a ratio that is
constant to `std = 0.0000` across all 22 days** — the signature of an adjustment
factor, not a data error. `STRO.O` ratio `0.1000` (1:10 reverse split),
`VISN.O` ratio `2.0493`.

- `pd.concat([crsp_prc, lseg_prc])` → **WRONG.** A 1:10 reverse split after the
  cutoff prints a +900% one-day return on the seam.
- Chain the gap off CRSP's last `DlyPrc` with LSEG's daily total returns →
  **CORRECT.** `p_t = p_cutoff * cumprod(1 + ret)`.
</EXTREMELY-IMPORTANT>

A fabricated ±90% return on a known date, in a panel that otherwise validates, is
worse than a missing tail — it survives every summary statistic and lands in the
event window. `scripts/crsp_lseg_splice.py::rebuild_price()` does the chaining.

The chained series is a **total-return index anchored at CRSP's last price**, not
a quoted price: total-return chaining reinvests dividends into the level. The raw
LSEG quote is carried alongside as `lseg_prc` for anyone who needs the level.

### Return Facts

- **`TR.TotalReturn1D` is the `DlyRet` analogue and it validates.** On the
  Dec-2025 overlap, 99.12% of permno-days agree to within `1e-5`, median absolute
  difference `2.45e-07`, correlation 0.991. This is the field to splice on.
- **It is returned in PERCENT.** `-6.369427` means −6.37%. CRSP `DlyRet` is a
  decimal. Divide by 100 at the boundary or every return in the gap is off by 100×,
  which is loud in a mean but silent inside a signal that gets standardized.
- **It is CALENDAR-PADDED, and that breaks any coverage count taken from it.**
  Every instrument comes back with the *identical* number of return days —
  measured `std = 0.0000` across 3,384 RICs — including the 19 that delisted
  mid-gap. 1.14% of return rows have no trade price that day and 38% of those are
  `ret == 0`. Build the panel by inner-joining returns against the **price**
  series: otherwise a delisted stock keeps emitting flat rows to the end of the
  window, and the fill rate reads 99.8% because every security looks complete.
- **It is dividend-inclusive**, like CIZ `DlyRet`, so no distribution merge is
  needed — and, per `crsp-v2`, no delisting-return merge either.
- **`DlyCap` must scale on the PRICE relative, not the return chain.** Chaining
  market cap on `TR.TotalReturn1D` reinvests every dividend into shares
  outstanding and inflates cap by the cumulative dividend yield over the gap.
  `lseg_prc_t / lseg_prc_cutoff` is the right multiplier: both legs sit on LSEG's
  single adjusted basis, so splits cancel (as they must for cap, which is
  split-invariant) and dividends are excluded. `TR.CompanyMarketCap` exists but is
  not on CRSP's `DlyCap` definition or units (CIZ `DlyCap` is **$ thousands**).
- **Start the LSEG pull ON the CRSP cutoff date, not the day after.** That one
  overlapping day is the anchor. `crsp_prc / lseg_prc` on the same day measures
  each security's adjustment-basis ratio directly: ~1.0 means the two agree,
  anything else is a post-cutoff corporate action LSEG has back-adjusted for (or a
  bad link that survived the venue screen). The pipeline carries it as `adj_ratio`
  and `coverage` reports it — it is what makes the splice auditable per security
  rather than trusted in bulk.
- LSEG serves data for **still-listed** instruments. A security that delists
  inside the gap stops on its delist date, and its RIC gets a `^`-stamp
  (`IROQ.O^C26` = delisted March 2026) — which is how you learn the delist
  happened, since CRSP has not published it yet. There is no delisting *return*
  from this path.

## Symbology Enforcement

### IRON LAW: NO RIC ACCEPTED WITHOUT A US-VENUE CHECK

<EXTREMELY-IMPORTANT>
**LSEG resolves a US CUSIP to a foreign cross-listing's RIC for ~3% of the
universe, and that RIC returns prices in a FOREIGN CURRENCY with no error.**

Measured: **101 of 3,485 resolved RICs (2.76%)** carry a non-US venue suffix —
`.TRE` (Tradegate), `.MU` (Munich), `.SG` (Stuttgart), `.TBEA`, `.MX`, `.BCU`.

| CRSP | LSEG RIC | effect |
|------|----------|--------|
| `TPH` TRI POINTE HOMES | `T86f.TRE` | prices in EUR; CRSP/LSEG ratio 1.3294 (≈ USD/EUR) |
| `VERO` VENUS CONCEPT | `0RR0.MU` | Munich listing; 18 of 22 days differ >1pp |
| `CIVI` CIVITAS RESOURCES | `US17888H1032.TRE` | ISIN-form RIC, Tradegate |

- Taking `RIC` straight from `symbol_conversion` → **WRONG.** An FX series enters
  the panel as a price series.
- Filter on the suffix before pulling → **CORRECT.** US venues are the bare RIC
  (composite) and `.O .N .A .P .K .PK .OQ`.
</EXTREMELY-IMPORTANT>

A EUR price series is *plausible* — right order of magnitude, right shape, moves
with the stock. It fails no null check and no range check. It is only caught at
the venue, which is why the check belongs before the pull, not after.

### Symbology Facts

- **Use CRSP's date-effective `cusip9` from `crsp.stksecurityinfohist`, never
  `stksecurityinfohdr.hdrcusip`.** CIZ inverted the SIZ naming — CIZ `cusip` is
  the *historical* value and `hdrcusip` is the header one — so header-CUSIP code
  attaches a security's most-recent CUSIP to its entire history. For a
  fill-forward anchored at the cutoff date the two usually agree, but the same
  script pointed at an earlier as-of date silently mis-links.
- Pass the **9-character CUSIP** to `SymbolTypes.CUSIP`. CRSP CIZ carries both
  `cusip9` and the 8-character `cusip`; LSEG returns 9-char. Trimming to CUSIP8 to
  join is fine as a *post-hoc* key, but resolve on the 9.
- **Unresolved CUSIPs come back absent, not wrong.** Misses land as explicit
  nulls. The precision risk in this pipeline is the foreign venue and the entity
  mismatch, not the miss.
- **Entity agreement is the cheap guard:** CRSP `ticker` vs LSEG `TickerSymbol`
  agrees for 97.31%, RIC root vs CRSP ticker for 95.06%, **either for 97.56%**.
  Most residual disagreement is a rename CRSP has recorded and LSEG reports under
  the current name (`COMM` → `VISN.O`), not a mis-link — flag it, do not drop it.
- `symbol_conversion` chunks fine at 200 symbols; the session cap is 500
  requests/minute and the binding limit is `get_data` at 10,000 data points and
  `get_history` at 3,000 rows per request.

## Measured Coverage

Full numbers, denominators, and the validation method: **`references/coverage.md`**.

Universe = the 3,657 CRSP CIZ common stocks (5-column `SHRCD 10/11` equivalent,
`primaryexch IN ('N','A','Q')`) trading on 2025-12-31. Measured 2026-07-28.

| Stage | count | share of universe |
|-------|-------|-------------------|
| CRSP common stocks at cutoff | 3,657 | 100% |
| CUSIP9 → RIC resolved | 3,485 | **95.30%** |
| — of those, US venue | 3,384 | 92.53% |
| — of those, entity-agreeing | — | 97.56% of resolved |

Agreement on the Dec-2025 overlap (300-security sample, 6,244 permno-days):

| check | result |
|-------|--------|
| price exact (`reldiff ≤ 1e-4`) | **96.28%** |
| price within 5% | 98.13% |
| daily return within `1e-5` | **99.12%** |
| return available where CRSP has a day | 98.34% |

The 1.87% of price rows outside 5% are the split-adjustment and foreign-venue
cases above — both handled by the two Iron Laws, neither by a tolerance.

## The Pipeline

`scripts/crsp_lseg_splice.py` — five cached steps, `all` runs them in order:

```bash
set -a; . $XDG_RUNTIME_DIR/agenix/lseg-credentials; set +a
export RDP_APP_KEY=$LSEG_APP_KEY RDP_USERNAME=$LSEG_USERNAME RDP_PASSWORD=$LSEG_PASSWORD
python scripts/crsp_lseg_splice.py all --out data/ --start 2020-01-01
```

| step | does | writes |
|------|------|--------|
| `universe` | CRSP CIZ common stocks alive at `max(dlycaldt)` + their daily panel | `universe.parquet`, `crsp_panel.parquet`, `asof.txt` |
| `map` | CUSIP9 → RIC, venue + entity screen, `link_status` per row | `link.parquet` |
| `pull` | gap-period `TRDPRC_1`/`ACVOL_UNS` + `TR.TotalReturn1D` | `lseg_hist.parquet`, `lseg_ret.parquet` |
| `splice` | return-chained continuous panel, `source` column marks provenance | `panel_spliced.parquet` |
| `coverage` | coverage table + seam sanity check | stdout |

Output panel is `permno × date` with `dlyprc, dlyret, dlycap, dlyvol, source`,
plus `RIC`, `lseg_prc` (the raw quote) and `adj_ratio` on the LSEG rows.
`source ∈ {CRSP, LSEG}`. **Keep `source` in anything downstream** — the two halves
have different provenance and the LSEG half is unaudited by CRSP.

### Red Flags — STOP If You're About To:

- **`pd.concat` a CRSP price and an LSEG price** → STOP. Different adjustment
  bases; chain on returns (Iron Law 1).
- **Use a RIC without checking its suffix** → STOP. 4.3% are foreign-currency
  venues (Iron Law 2).
- **Use `TR.TotalReturn1D` without `/100`** → STOP. It is percent; CRSP is decimal.
- **Join on `hdrcusip`** → STOP. Header CUSIP, not date-effective.
- **Query `crsp.dsf` / `crsp.msf` for the recent panel** → STOP. Legacy SIZ, frozen
  at 2024-12-31 — a year *before* the CIZ cutoff. See `crsp-v2`.
- **Open a second LSEG session while a pull runs** → STOP. One concurrent platform
  session; the second fails on quota rather than queueing.
- **Count coverage from the return series** → STOP. `TR.TotalReturn1D` is
  calendar-padded; every security looks complete. Count from the price series.
- **Report the panel as "CRSP data through today"** → STOP. It is CRSP through the
  cutoff and LSEG after, at 91% of the universe. Say so.

## Additional Resources

- **`references/coverage.md`** — full measured coverage, per-failure-mode breakdown, validation method, and the reproduction commands
- **`scripts/crsp_lseg_splice.py`** — the pipeline
- **`${CLAUDE_SKILL_DIR}/../crsp-v2/SKILL.md`** — CIZ tables, the 5-column universe filter, delisting returns, CUSIP inversion
- **`${CLAUDE_SKILL_DIR}/../lseg-data/SKILL.md`** — session setup, quota, entitlements, rate limits
- **`${CLAUDE_SKILL_DIR}/../lseg-data/references/symbology.md`** — `SymbolTypes` enum names and the conversion API
- **`${CLAUDE_SKILL_DIR}/../wrds/SKILL.md`** — WRDS Postgres connection and `.pgpass`
