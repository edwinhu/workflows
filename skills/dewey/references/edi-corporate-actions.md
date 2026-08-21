# Exchange Data International (EDI) — Global Equity Corporate Actions

Dataset page: `app.deweydata.io/data/exchange-data-international/global-equity-corporate-actions`
· Category **Finance** · **Included in the UVA/NYU Platform Subscription** (`DL`).

EDI's **WCA (Worldwide Corporate Actions)** book, delivered as the **RCAN** (Readable Corporate
Action Notice) product. Global equity corporate actions — dividends, splits, mergers, tenders,
rights, capital changes — normalized into one very wide event table.

**Vendor context** (`exchange-data.com/product/worldwide-corporate-actions-data/`): WCA spans
**150+ exchanges**, Albania through Zimbabwe, plus 250k+ open-ended funds. The event taxonomy
splits into **~25 mandatory** types (dividends, mergers, splits, bankruptcies, liquidations) and
**~15 voluntary** types (rights, buybacks, redemptions), with mixed arrangements/conversions on
top — that is what `MANDVOLUFLAG` encodes. The commercial feed updates **daily across seven
releases** and ships as TAB/TXT/XML or ISO 15022 **MT564/MT568** messages over portal/S3/SFTP/API/
Snowflake. **The Dewey share is none of those** — it is a CSV snapshot of the same book, so treat
vendor statements about intraday latency and message formats as not applying here. The vendor does
not publish a full event-code list, so `EVENTCD` values have to be enumerated from the data.

## The two tables

| Table (slug) | Coverage | Rows | Cols | Size | Format |
|---|---|---|---|---|---|
| `global-equity-corporate-actions` | 2001-01-17 → **2026-12-13** | 8.64M | 175 | 492 MB | **CSV** |
| `global-equity-corporate-actions-notes` | **2024-01-29** → 2026-04-09 | 587K | 9 | 261 MB | **CSV** |

Both are **CSV, not Parquet** — unlike most of the Dewey catalog. Both are time-partitioned, so
`partition_key_after/before` works.

<EXTREMELY-IMPORTANT>
**Two coverage traps, and both bite silently.**

1. **The end date is in the FUTURE (2026-12-13).** This file carries *announced* events whose
   ex/pay/effective dates have not yet arrived. Filtering on `PRIMARYDTVALUE <= today` is not the
   same as filtering on what was *known* at a date. For any point-in-time or event study, condition
   on the announcement/record stamps (`EVENTCREATEDT`, `EVTCHANGEDT`) — using the event's own
   calendar date as if it were the information date builds look-ahead straight into the design.
2. **The Notes table starts 2024-01, the main table starts 2001-01.** Narrative text exists for
   roughly the last two years only. Any design that needs `NOTESTEXT` is a 2024-onward design, not
   a 25-year one — check this before scoping, not after pulling 492 MB.
</EXTREMELY-IMPORTANT>

## Grain — one event is many rows

The row key is `LSTUNIQUEID` (listing) + `EVTUNIQUEID` (event record). One corporate action
explodes across rows along three axes:

- **`OPTIONID` — options are ORs.** Elective events (e.g. cash-or-stock dividends) carry one row
  per election branch. `DEFAULTOPTIONFLAG` marks what a passive holder receives.
- **`SERIALID` — serials are ANDs.** Multi-leg events carry one row per leg; all legs happen.
- **`LISTSOURCEFLAG`** is `M`ain or `S`econdary, and `SCEXHID` is *"duplicated in all secondary
  listing records."* A cross-listed security repeats the same event once per listing.

**Counting events without collapsing these three overstates everything.** For a firm-level event
count, restrict to `LISTSOURCEFLAG = 'M'` and count distinct `(EVENTCD, EVENTID)`, not rows.

## Identifier hierarchy (the reason to use this dataset)

Three nested WCA ids, coarsest to finest:

- **`ISSID`** — issuer level; "links all securities of an issuer."
- **`SECID`** — security level; "links all multiple listings" of one security.
- **`LSTUNIQUEID`** / `SCEXHID` — individual listing.

Plus a genuinely unusual density of external identifiers on every row: `ISIN`, **`USCODE`
(US domestic CUSIP)**, `SEDOL` (+ `SEDOLDEFUNCT`, `SEDOLMIC`), `FIGI` / `FIGITICKER`,
`BBGCOMPID` / `BBGCOMPTICKER`, `OPERATIONALMIC` / `SEGMENTMIC` (ISO 10383), `EXCHGCD`
(EDI's own, described as "equivalent to the MIC but more stable"), and four local-code
formattings (`LOCALCODE`, `LOCALDOT`, `LOCALSLASH`, `LOCALSPACE`).

That makes this an effective **bridge table** into CRSP/Compustat (via CUSIP), LSEG (via SEDOL/
ISIN), and anything Bloomberg-keyed (FIGI) — see `linkage.md` and the `fuzzy-name-matching` skill
when no identifier is shared. `SEDOLDEFUNCT` matters for historical joins: a defunct SEDOL still
matches, and you usually do want it to.

**Outturn identifiers.** Events that deliver a *new* security carry a parallel `OUT*` block —
`OUTISIN`, `OUTUSCODE`, `OUTSEDOL`, `OUTFIGI`, `OUTSECID`, `OUTLOCALCODE`, `OUTSECTYCD`,
`OUTTURNSTYLECD`. This is what lets you follow a spinoff or merger to the successor security
rather than just observing the parent disappear.

## Event coding

- `EVENTCD` (WCA event code) + `EVENTID` — unique at event level as a pair; `EVENTID` alone is not.
- `EVENTSUBTYPECD` — populated for a limited set of events only.
- `RELATEDEVENTCD` + `RELATEDEVENTID` — direct link to another event; how a chain (announcement →
  amendment → completion) is traversed.
- `MANDVOLUFLAG` — mandatory vs voluntary participation.
- `EVTACTIONCD` — record action status (insert/update/delete semantics); `EVTCHANGEDT` is the
  last-changed stamp. **These two are how you reconstruct what the file said on a past date.**
- `RDID` groups all events for a security sharing a record date; **`RDPRIORITY` gives the order
  they must be applied in.** Ignoring `RDPRIORITY` when compounding same-record-date adjustments
  (e.g. a split and a dividend) produces a wrong adjustment factor.

## Ratios, rates, and the label/value slots

`RATIOOLD` / `RATIONEW` are **European-style**: denominator = existing holding, numerator =
*additional* shares. A US-style "2-for-1" is not `RATIONEW=2, RATIOOLD=1` — read the definition
before converting, and sanity-check against a known split.

Most of the 175 columns are **generic slots whose meaning is carried in a sibling label column**,
not fixed fields:

| Slots | Pattern |
|---|---|
| `DATELABEL01..08` / `DATEVALUE01..08` | event-assignable dates |
| `RATELABEL01..02` / `RATEVALUE01..02` | event-specific payment fields |
| `EVENTLABEL01..24` / `EVENTVALUE01..24` | event-assignable fields |

So the *same* column means different things for a dividend and a tender offer, and **all
`*VALUE` slots are typed `str`** — including numeric payment amounts. You must pivot on the label
and cast per event type; never `SUM()` a `RATEVALUE` column across mixed `EVENTCD`s. Named date
columns (`EXDT`, `RECORDDT`, `PAYDT`, `EFFECTIVEDT`, plus subscription/withdrawal/option windows)
do exist and are properly typed `date` — prefer those wherever the event populates them.
`PRIMARYDTLABEL` / `PRIMARYDTVALUE` give the headline date and its meaning per event.

Tender-offer specifics live in their own block: `TNDRSTRKPRICE`, `TNDRPRICESTEP`, and the
quantity bands `MIN/MAXOFRQTY` (what a holder may offer), `MIN/MAXQLYQTY` (what qualifies),
`MIN/MAXACPQTY` (what the company will accept in total) — all `str`.

## Notes table (9 cols)

`EVENTCD`, `EVENTID`, `NTSACTIONCD`, `NTSCHANGEDT`, `REFLINKID`, `NOTESTYPE`, `NOTESTEXT`,
`CREATED_BY`, `CREATED_AT`. Join on `(EVENTCD, EVENTID)`.

`REFLINKID` is **polymorphic** — it holds `SECID` for security-level events and `ISSID` for
issuer-level ones. Joining it blindly to either will silently mismatch a subset; branch on the
event level first. `NOTESTEXT` is versioned narrative (re-issued when the text changes), so
dedupe on `NTSCHANGEDT` before treating one event as one note.

## Worked pattern — US dividend events joined to a CUSIP universe

Three things must happen before the numbers mean anything: collapse to the main listing, restrict
to one event type so the generic slots have a fixed meaning, and pull the amount out of whichever
`RATELABEL` slot holds it.

```sql
WITH ev AS (
  SELECT DISTINCT ON (EVENTCD, EVENTID, OPTIONID, SERIALID)
         EVENTCD, EVENTID, OPTIONID, SERIALID,
         USCODE AS cusip, ISSUERNAME, EXDT, RECORDDT, PAYDT,
         RATECURENCD,
         -- the payment amount lives in a label/value pair, not a fixed column
         CASE WHEN RATELABEL01 ILIKE '%amount%' THEN RATEVALUE01
              WHEN RATELABEL02 ILIKE '%amount%' THEN RATEVALUE02 END AS rate_raw,
         EVENTCREATEDT, EVTCHANGEDT
  FROM corporate_actions
  WHERE LISTSOURCEFLAG = 'M'                  -- main listing only; secondaries duplicate
    AND LISTCNTRYCD   = 'US'
    AND EVENTCD       = '<dividend code>'      -- enumerate EVENTCD first; not vendor-published
    AND EVENTCREATEDT <= DATE '2024-12-31'     -- information set, NOT the ex-date
)
SELECT e.*, TRY_CAST(rate_raw AS DOUBLE) AS rate
FROM ev e
WHERE cusip IS NOT NULL;
```

Notes on each guard. `LISTSOURCEFLAG = 'M'` is what stops a cross-listed firm contributing one row
per venue. The `DISTINCT ON` over `(EVENTCD, EVENTID, OPTIONID, SERIALID)` keeps genuine election
branches and legs while removing repeats. `TRY_CAST` rather than `CAST` because every `*VALUE`
slot is `str` and mixed event types put non-numeric text there. Filtering on `EVENTCREATEDT`
rather than `EXDT` is the look-ahead guard — see the coverage trap above.

**Enumerate the codes before writing the real query**, since the vendor publishes no list:

```sql
SELECT EVENTCD, MANDVOLUFLAG, count(*) AS n,
       min(PRIMARYDTVALUE) AS first_dt, max(PRIMARYDTVALUE) AS last_dt
FROM corporate_actions GROUP BY 1, 2 ORDER BY n DESC;
```

Do the same for `PRIMARYDTLABEL` and for each `RATELABEL0n` / `EVENTLABEL0n` **within** an
`EVENTCD` — that is the only way to learn what the slots mean for the events you care about.

## Sibling EDI datasets in the same subscription

| Dataset | Coverage | Rows | Note |
|---|---|---|---|
| Global Equity End of Day Pricing w/ Adjustment Factors | 2006-03 → 2026-05 | 145K | the adjustment factors that pair with these actions; 170+ exchanges |
| Global FX Rates – US Base Rate | 2014-01 → 2026-05 | 821K | 168 currencies, USD base |
| Futures and Options | 2025-08 → 2025-12 | 183.5M | 9 GB — sample before pulling |
| F&O Reference | 2025-08 → 2025-10 | 698K | contract reference |

For a corrected global return series, the pricing-with-adjustment-factors file is the intended
companion — don't hand-roll adjustment factors out of the actions table if the vendor already
computed them.
