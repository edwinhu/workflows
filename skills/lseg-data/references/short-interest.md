# Short Interest

Measured 2026-07-27 while backfilling a 2003–2025 CRSP/Compustat panel. The
headline is a coverage boundary that is invisible from the API surface: **LSEG
serves short interest only for still-listed instruments.**

## Contents

- [The only field that works](#the-only-field-that-works)
- [Delisted instruments have no short interest](#delisted-instruments-have-no-short-interest)
- [History depth and frequency](#history-depth-and-frequency)
- [It disagrees with Compustat by a lot](#it-disagrees-with-compustat-by-a-lot)
- [Batching](#batching)

## The only field that works

`TR.ShortInterest` — in **shares**, at the observation date, on the security's own
share basis. Every plausible sibling fails field resolution on this entitlement:

| field | result |
|---|---|
| `TR.ShortInterest` | **works** — shares |
| `TR.SIShortInterest` | works, but it is a **percentage** (`Short Interest %`), not shares |
| `TR.ShortInterestValue` | `Unable to resolve all requested fields` |
| `TR.ShortInterestPctFloat` | `Unable to resolve all requested fields` |
| `TR.ShortInterestPctOfFloat` | `Unable to resolve all requested fields` |
| `TR.ShortInterestDaysToCover` | `Unable to resolve all requested fields` |
| `TR.SecuritiesLendingQuantityOnLoan` | `Unable to resolve all requested fields` |

The `SI` app in Workspace *displays* Days to Cover, % of Float and 52w ranges, but
those are StarMine model outputs on the app surface — they are not retrievable as
`TR.` fields here.

Values are not always integers (~6% carry a fractional part), so do not cast to
int and do not treat a fraction as a parsing bug.

## Delisted instruments have no short interest

A delisted RIC resolves normally and returns other `TR.` fields, but its short
interest series is **not retained**. Verified on mega-caps, so it is not a
size or liquidity effect:

| security | RIC | `TR.PriceClose` | `TR.ShortInterest` |
|---|---|---|---|
| Lehman Brothers | `LEH.N^I08` | 24/24 rows | **0 rows** |
| Wachovia | `WB^A09` | ✓ | **0 rows** |
| Compaq | `CPQ^E02` | ✓ | **0 rows** |
| Gillette | `G^J05` | ✓ | **0 rows** |
| Anheuser-Busch | `BUD^K08` | ✓ | **0 rows** |
| Wyeth | `WYE^J09` | ✓ | **0 rows** |
| EMC | `EMC^I16` | ✓ | **0 rows** |
| IBM (live control) | `IBM` | ✓ | 307 monthly obs |

Checked every way available and the answer does not change:

- both call paths — `get_history(interval=...)` and
  `get_data("TR.ShortInterest(SDate=…,EDate=…,Frq=M)")`;
- both session classes — `PlatformSession` (RDP machine ID) and Codebook's
  `DesktopSession`;
- **and in the Workspace UI**, which is the useful confirmation: the `SI` app
  renders for IBM but is not offered for the delisted instrument. Requesting
  `view=ShortInterest` falls back to Overview, and the Price & Charts menu drops
  the Short Interest entry. The delisted company page is otherwise well populated
  (debt by maturity, ratings history, filings, 2008-era news), so this is
  selective removal on delisting, not archival deletion.

**Consequence for historical work: any panel built from this is survivorship-
biased, and worst in the earliest years.** Backfilling a 2003–2025 panel, the fill
rate ran 17.4% for 2003–2006 against 91.7% for 2025 — entirely delisting attrition,
not a mapping defect. A probe on one surviving mega-cap (IBM reaches back to
2000-06) will look like full early coverage and does not generalise.

There is no workaround inside LSEG. If delisted-name short interest is required,
the source has to be FINRA or Markit.

## History depth and frequency

- Starts **2000-06-30** for long-lived US names; earlier dates return nothing.
- Monthly series is dense from then on (307 non-null months to 2025-12, no gaps).
- Instrument lifecycle is respected: Philip Morris International starts 2008-03,
  its spin-off date, rather than back-filling the parent.
- ETFs start later and vary by fund — QQQ from 2004-12, SPY only from 2008-12.
- `interval="quarterly"` returns calendar quarter-end bars (3/31, 6/30, 9/30,
  12/31), which is usually what a quarterly panel wants — no resampling needed.

## It disagrees with Compustat by a lot

Compared against `comp.sec_shortint` on 149,887 overlapping permno-quarters:

```
corr(log SI)              0.9254     <- same underlying quantity
median LSEG/Compustat     1.6491     <- systematic 65% level gap
within +/- 5%             5.38%
within +/- 20%            20.67%
```

Not a units or split-adjustment artifact (`cfacshr` is 1.0 at the median;
adjusting moves the median ratio only 1.69 → 1.56), and not confined to small
names (large US common still 1.43).

Which is right is genuinely unresolved. LSEG's median SI/shares-outstanding of
2.84% sits closer to the published 2–4% norm than Compustat's 1.60%, and spot
checks favour it (TXN 2025Q1: LSEG 16.6M vs Compustat 3.84M on ~910M shares).
But LSEG breaches SI > shares outstanding 230× more often (0.2976% vs 0.0013%) —
the signature of aggregation across venues or share classes.

**Do not splice the two series together.** Filling Compustat's gaps with LSEG puts
a ~65% level step inside the merged column, correlated with year and security
type. Use LSEG as a robustness check computed on the overlap instead.

## Batching

`get_history` caps at **3,000 rows** per request, counted across the whole
universe. Quarterly over 2003–2025 is 92 rows per RIC, so **30 RICs per request**
fits with headroom; monthly is 276 rows, so ~10.

One unresolvable RIC rejects the **entire chunk** with `Unable to resolve all
requested identifiers`, not just the bad symbol. Retry the chunk one RIC at a time
so the good ones survive, or the failure silently costs 29 valid securities.

Rate limit is 500 requests/minute per session. ~19,500 RICs at 30 per request is
~650 requests, which runs in about 30 minutes single-threaded — and it must be
single-threaded, because of the one-session quota.

## See Also

- [SKILL.md](../SKILL.md) — session setup, `signon_control`, Codebook
- [symbology.md](symbology.md) — CUSIP → RIC, and the `'TickerSymbol'` trap
- [wrds-comparison.md](wrds-comparison.md) — LSEG vs WRDS data mapping
