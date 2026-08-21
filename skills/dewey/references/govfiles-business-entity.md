# GovFiles — US Business Entity (Secretary of State registries)

Dataset page: `app.deweydata.io/data/govfiles/business-entity` · Provider: GovFiles ·
DOI `10.82551/KKNT-RW30` · **Included in the UVA/NYU Platform Subscription** (page states
"You have access to this dataset through your Dewey subscription").

Cite as: `GovFiles. (2026). GovFiles Companies [Dataset]. Dewey Data. https://doi.org/10.82551/KKNT-RW30`

## Why this over OpenCorporates

Registry data collected **directly from all 50 state Secretary of State offices** and replicated in
full, not fanned out live to state websites per query. Normalized into one schema, with both the
normalized value and the **value as filed** preserved on every record. Includes **dissolved,
revoked, withdrawn, and merged** entities, not just active ones — the dead-shell coverage is the
part OpenCorporates is weakest on and the part corporate-structure work actually needs.

Vendor claims 75M+ entities; the Dewey primary table ships **84,376,737 rows**.

## Tables (7)

`GovFiles Companies` is PRIMARY; the other six are SUPPLEMENTARY and every one of them joins on
the composite key **`(JURISDICTION_CODE, ENTITY_NUMBER)`** — both 100% populated everywhere.

| Table | Grain |
|---|---|
| **GovFiles Companies** (primary) | one row per registered entity |
| GovFiles Company Addresses | one row per address slot (registered / headquarters / mailing) |
| GovFiles Company Filings | one row per statutory filing (annual reports, amendments) |
| GovFiles Company Identifiers | one row per external identifier — **incl. SEC CIK and LEI** |
| GovFiles Company Industry Codes | one row per industry code, **as filed** |
| GovFiles Company Names | one row per non-current name (former legal name, DBA, alias) |
| GovFiles Company Relationships | one row per entity-to-entity link — **mostly unusable, see below** |

### Supplementary schemas (verified from each table's data dictionary)

Percentages are the platform's own fill rates. They are the whole story here — several of these
columns are too sparse to build on, and the dataset page does not warn you.

**Company Addresses** — `ADDRESS_KIND` (100%: `registered, headquarters, mailing`), `RAW` (1%,
verbatim string only when the source was unstructured), `STREET_ADDRESS` (95%), `LOCALITY` (98%),
`REGION` (100%), `POSTAL_CODE` (95%), `COUNTRY` (79%), `COUNTRY_CODE` (83%). Parsed fields are
dense, so address-based clustering (shared registered agent addresses, mass-registration shells)
is viable — this is the closest thing to a network view the dataset supports.

**Company Identifiers** — `SCHEME` (100%) + `VALUE` (100%). A tall key-value table; documented
scheme examples are **`us_fein`, `us_sec_cik`, `lei`**.

**Company Industry Codes** — `CODE` (100%), `SCHEME` (100%, e.g. `us_naics_2017`, `us_sic_1987`),
`DESCRIPTION` (62%). Tall, as filed, and **multi-scheme** — one entity can carry both a NAICS and
an SIC row, so filter on `SCHEME` before joining or you duplicate entities.

**Company Names** — `NAME` (100%), `NAME_KIND` (100%: `previous_legal` = former legal name,
`trading` = DBA/trade name, `alias`), `STARTED_ON` (64%), `ENDED_ON` (32%). This is the table that
makes name-history work possible, but **only a third of rows have an end date** — you can often
tell that a name was used, not when it stopped being used. Point-in-time name resolution is
therefore partial; don't build a strict as-of join on `ENDED_ON` without measuring the loss first.

**Company Filings** — `FILING_ID` (86%), `TITLE` (60%), `FILED_ON` (100%, DATE),
`FILING_TYPE_CODE` (20%), `FILING_TYPE_NAME` (100%), `URL` (39%), `DESCRIPTION` (20%). Note the
inversion: the *name* is 100% populated but the *code* only 20%, so classify on
`FILING_TYPE_NAME` (a free-ish string that varies by state) rather than the tidy-looking code.

> **`FILED_ON` carries sentinel dates.** Its published range is **`0001-01-01` to `9999-12-31`**.
> Those are placeholders, not filings. Any min/max, duration, or first-filing calculation must
> exclude them, and a naive `MIN(FILED_ON)` will silently return year 1.

**Company Relationships** — `RELATIONSHIP_KIND` (100%: `merged_into`, `home_entity`,
`subsequent_registration`, `alternate_registration`), `RELATED_JURISDICTION_CODE` (99%),
`RELATED_NAME` (**3%**), `RELATED_ENTITY_NUMBER` (**1%**), `EFFECTIVE_DATE` (**1%**).

<EXTREMELY-IMPORTANT>
**The Relationships table cannot be traversed as a graph.** The counterparty key
`RELATED_ENTITY_NUMBER` is **1% populated** and `RELATED_NAME` is **3%** — so for ~97–99% of rows
you know a relationship exists and its jurisdiction, but not *which entity is on the other end*.
`EFFECTIVE_DATE` is likewise 1%, so you cannot date the merger either.

This kills the headline use case govfiles.dev advertises ("trace corporate networks", "surface
dissolved shells, predecessors"). Treat `RELATIONSHIP_KIND` as a **flag on the focal entity**
("this one merged into something", "this is a foreign re-registration of a home entity") — useful
for filtering and for counting, useless as an edge list. For actual linkage, go through shared
addresses or `Company Names`, and expect to fall back on `fuzzy-name-matching`.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
**There is NO officers / directors / registered-agent (parties) table in the Dewey distribution.**
govfiles.dev markets "find the people behind a company — officers, directors, and registered
agents", and Dewey's own primary-table blurb miscounts the companion tables as "seven … (addresses,
**parties**, filings, identifiers, names, relationships, and industry codes)". The actual table
menu has six supplementary tables and no parties table; the dataset summary above it also says
"six further tables" and omits parties. **Do not plan officer-network or shared-director analysis
on this dataset without first confirming a parties table exists.** Registered-agent *addresses*
are in the Addresses table — agent *names* are not.
</EXTREMELY-IMPORTANT>

## Primary table schema (18 columns, verified from the data dictionary)

`Rows Populated` is the platform's own fill rate — treat the low ones as unusable at scale.

| Column | Type | Fill | Notes |
|---|---|---|---|
| `JURISDICTION_CODE` | TEXT | 100% | ISO 3166-2 style, e.g. `us_de`, `us_co` |
| `ENTITY_NUMBER` | TEXT | 100% | registry-assigned; **composite key with jurisdiction** |
| `LEGAL_NAME` | TEXT | 100% | legal name as registered |
| `STATUS` | TEXT | 100% | normalized enum: `active, inactive, dissolved, suspended, merged, withdrawn, unknown` |
| `STATUS_RAW` | TEXT | 87% | verbatim registry string (e.g. `Good Standing`, `Administratively Dissolved`, `Delinquent`) |
| `LEGAL_FORM` | TEXT | 100% | normalized enum: `llc, corporation, nonprofit, limited_partnership, limited_liability_partnership, partnership, trust, other, unknown` |
| `LEGAL_FORM_RAW` | TEXT | 97% | verbatim company-type string |
| `DOMICILE` | TEXT | 100% | `domestic, foreign, unknown` |
| `FORMED_ON` | DATE | 92% | incorporation / formation date |
| `DISSOLVED_ON` | DATE | 23% | populated only where dissolved |
| `WEBSITES` | ARRAY | **<1%** | effectively empty |
| `PHONE` | TEXT | **<1%** | effectively empty |
| `FAX` | TEXT | **<1%** | effectively empty |
| `ENTITY_URL` | TEXT | 50% | direct registry link, "often null" |
| `SEARCH_URL` | TEXT | 100% | state entity-search page — the always-available fallback |
| `AS_OF` | DATE | 100% | retrieval date of this record |

**Key traps.** `ENTITY_NUMBER` is unique only *within* a jurisdiction — always key on the pair.
`STATUS`/`LEGAL_FORM` are the normalized enums; `*_RAW` preserves the filed string and the two
disagree in kind, not just spelling (`dissolved` covers both `Voluntarily Dissolved` and
`Administratively Dissolved`, which are legally different events — use `STATUS_RAW` when that
distinction matters). `WEBSITES`/`PHONE`/`FAX` are <1% populated: do not build on them.

## Maturity — treat the sparse columns as provisional

This product **launched on Dewey in June 2026** (announced as "COMING SOON … this week" in the
June 2026 platform newsletter). Its **Changelog tab is empty** — "No changes have been published
yet" as of 2026-08-21 — so nothing has been corrected or backfilled since launch.

That is the most likely explanation for the sparse counterparty fields in Relationships (1%) and
the partial `ENDED_ON` in Names (32%): a new pipeline that has parsed the easy structured cases and
not yet the rest. **Expect these to improve, and re-check the fill rates before concluding a design
is impossible.** The Changelog is the place that would say so.

But do not assume every low number is a backfill artifact — several are structural and will never
move:

| Sparse field | Will backfill? |
|---|---|
| `RELATED_ENTITY_NUMBER` 1%, `RELATED_NAME` 3%, `EFFECTIVE_DATE` 1% | **plausibly** — unparsed counterparties |
| `Names.ENDED_ON` 32% | **plausibly** — many registries do file an end date |
| `Filings.FILING_TYPE_CODE` 20%, `DESCRIPTION` 20% | **maybe** — varies by state |
| `DISSOLVED_ON` 23% | **no** — this is a base rate; most entities are not dissolved |
| `Addresses.RAW` 1% | **no** — by design, populated only when the source was unstructured |
| `WEBSITES`/`PHONE`/`FAX` <1% | **no** — most registries simply do not collect these |

**Also check the refresh stamp before trusting the "monthly" cadence.** The page reads
**Refreshed Jun 29, 2026** — which on 2026-08-21 is nearly two months stale against a monthly
promise. Either the cadence has not held or the stamp is not being updated; either way, read
`AS_OF` off the data rather than believing the label.

## Delivery & refresh

- Format **Parquet**, primary table **4.83 GB / 84.4M rows / 18 columns**, region US.
- **Refreshed monthly as a FULL SNAPSHOT that replaces the prior one** — there is no incremental
  feed and no vendor-side history of snapshots. If you need a point-in-time panel, **you** must
  retain each month's pull; `AS_OF` is the per-record retrieval stamp, not a version key.
  (govfiles.dev's own `llms.txt` says "refreshed weekly" while both the site body and the Dewey
  page say monthly — the Dewey distribution is the monthly one.)
- Snapshot seen on the page: **Refreshed Jun 29, 2026**.
- Not time-partitioned, so the usual `partition_key_after/before` filter does not apply — filter on
  `JURISDICTION_CODE` and column projection instead. At 4.83 GB the primary table is one of the
  few Dewey products you *can* pull whole, but per the SKILL Iron Law still `read_sample` first.

## Direct API (outside Dewey — only if the subscription path is insufficient)

GovFiles also sells its own REST API, billed **per row returned** (a 25-row search costs 25
credits; a direct entity lookup costs 1). Free tier 1,000 rows/month, then $0.01/row; Scale
$499/mo for 100k rows then $0.004/row. Base `https://api.govfiles.dev`, auth via `X-API-Key`,
search is `POST /v1/companies/search` with `{"q":"acme"}`. Docs: `docs.govfiles.dev`;
machine-readable brief at `govfiles.dev/llms.txt`.

**Prefer the Dewey path.** It is already covered by the institutional subscription, whereas the
direct API is metered spend on a personal card. Reach for the API only for real-time single-entity
lookups the monthly snapshot cannot answer — and note the Dewey academic terms (no redistribution
of raw data) do not travel with API-sourced rows, which are governed by GovFiles' own terms.

## Use cases in this research programme

**The CIK bridge is the highest-value thing here.** `Company Identifiers` carries
`SCHEME = 'us_sec_cik'`, which links a state registry entity straight to EDGAR — and from there to
gvkey/permno by the usual routes (`wciklink` in the `wrds` skill). It also carries `lei` and
`us_fein`. That turns GovFiles from "a big list of companies" into a **linking table between
state incorporation records and the securities-research identifier space**, which is exactly what
`fuzzy-name-matching` exists to work around when no shared key is available. Measure the CIK fill
rate on your sample first — the *table* is 100% populated on `SCHEME`/`VALUE`, but that says
nothing about how many entities have a CIK row at all.

Other fits: Delaware-domicile questions via `JURISDICTION_CODE = 'us_de'` + `DOMICILE`
(`domestic`/`foreign`); formation/dissolution dating for survival analysis (`FORMED_ON` 92%,
`DISSOLVED_ON` 23% — and note the base rate, since most entities are not dissolved);
administrative-vs-voluntary dissolution as a distress signal via `STATUS_RAW`; and
mass-registration / shell detection through shared registered-agent addresses in
`Company Addresses`.

## Worked pattern — DuckDB over the downloaded Parquet

Per the SKILL Iron Law, sample first. Then the composite key drives everything:

```sql
-- Delaware corporations with an SEC CIK, plus their current registered address
SELECT c.ENTITY_NUMBER, c.LEGAL_NAME, c.STATUS, c.FORMED_ON,
       i.VALUE AS cik, a.STREET_ADDRESS, a.LOCALITY, a.REGION
FROM companies c
JOIN identifiers i USING (JURISDICTION_CODE, ENTITY_NUMBER)
LEFT JOIN addresses a USING (JURISDICTION_CODE, ENTITY_NUMBER)
WHERE c.JURISDICTION_CODE = 'us_de'
  AND c.LEGAL_FORM = 'corporation'
  AND i.SCHEME = 'us_sec_cik'
  AND a.ADDRESS_KIND = 'registered';
```

Two things that will bite: joining `identifiers` without the `SCHEME` filter fans out one row per
scheme, and joining `addresses` without `ADDRESS_KIND` fans out up to three ways. Both are silent
row multipliers — check your row count against `COUNT(DISTINCT (JURISDICTION_CODE, ENTITY_NUMBER))`
after every join.
