# GovFiles — US Business Entity (Secretary of State registries)

Dataset page: `app.deweydata.io/data/govfiles/business-entity` · Provider: GovFiles ·
DOI `10.82551/KKNT-RW30` · **Included in the UVA/NYU Platform Subscription** (page states
"You have access to this dataset through your Dewey subscription").

Cite as: `GovFiles. (2026). GovFiles Companies [Dataset]. Dewey Data. https://doi.org/10.82551/KKNT-RW30`

## Coverage is uneven: check the state before you build on it

The vendor pitch is registry data from all 50 Secretary of State offices, normalized, with the
value as filed kept beside the normalized one, and dead entities (dissolved, revoked, withdrawn,
merged) included. Vendor claims 75M+ entities; the Dewey primary table ships **84,376,737 rows**.
State coverage does not match the pitch. Measured 2026-10-07 and re-checked 2026-10-08 on the
2026-09-23 refresh (`AS_OF` 2026-05..07; scripts in `~/projects/nevada/scratch/entity_status/`):

- **Delaware has no status.** All 1,777,879 DE domestic corporations have `STATUS = 'unknown'`; `STATUS_RAW` and `DISSOLVED_ON` are 0% filled and Filings has 0 `us_de` rows. Only identity fields (name, entity number, `FORMED_ON`) are present.
- **Nevada is a thin slice.** Only 37,319 `us_nv` rows (1,827 domestic corporations); 37,307 were formed in 2023 (entity numbers `NV2023…`, mostly Feb–Jun) and 2 domestic corporations predate 2020. Status is filled (use `STATUS_RAW`: the enum maps both Revoked and Default to `suspended`), but Revoked/Default have no dated filing and `DISSOLVED_ON` is filled for 1 of 1,827 NV domestic corporations. Only 3 of 80 listed Nevada reincorporations (all 2023 moves) were matchable.
- **No CIK bridge.** See Company Identifiers below: 0 `us_sec_cik` rows.
- **It is a snapshot.** The Companies table holds current status; there is no status-change-date column (`AS_OF`/`LAST_CHECKED` are retrieval dates), so "status within N years" outcomes cannot be built from it.

Before using a state, profile it: row count by `FORMED_ON` year and `STATUS_RAW` fill for that
`JURISDICTION_CODE`. Re-run `recheck_20261008/r1_profile.py` after a Dewey refresh to see whether
Nevada has been loaded in full.

## GovFiles vs OpenCorporates

For Nevada the user holds a complete OpenCorporates bulk snapshot, and for Nevada entity status it
is the source to use. Figures as of 2026-10-08, from `~/projects/nevada/scratch/opencorp_profile/report.md` (OpenCorporates) and `scratch/entity_status/{govfiles_test.md,recheck_20261008/report.md}` (GovFiles):

| | GovFiles (Dewey, refresh 2026-09-23) | OpenCorporates bulk (2023-07-06) |
|---|---|---|
| Access | Dewey subscription, server-side duckdb over parquet URLs | one-off bulk delivery, on disk (below) |
| Vintage | `AS_OF` 2026-05..07 | status at last refresh, 2021–2023 (`retrieved_at` up to 2023-06-29) |
| `us_nv` rows | 37,319 (1,827 domestic corps), ~all formed 2023 | 1,690,221 (556,847 Domestic Corporation), all eras |
| `us_nv` status | `STATUS_RAW` filled for the slice | `current_status` 100%; Domestic Corp: Permanently Revoked 61%, Dissolved 20%, Active 10% |
| `us_de` rows / status | 5,735,982 / none | 4,921,816 / none (Delaware sells status per entity) |
| SEC CIK link | none (0 `us_sec_cik` rows) | `additional_identifiers` scheme `us_sec_cik` for `us_nv` only: 15,682 companies, noisy free text (4,348 plausible CIKs; 404 CIKs map to >1 company) |
| Dated status change | none | none: `dissolution_date` in `us_nv` is mostly a charter term date (2030+), blank for matched filers |
| Match to Nevada SEC filers | 3 of 80 listed movers | CIK step then exact normalized name among domestic types with incorporation ≤ reference date + 365 d: 35/39 listed and 153/181 OTC movers (moves by 2023-07-06), 90.8% of full-sample NV filers |
| Fresher data | yes, if the state is covered | needs a new delivery (below) |

Neither source supports a Nevada-vs-Delaware status comparison or a time-to-lapse outcome;
comparisons stay within Nevada, and SEC-side measures (Form 15, last 10-K date) are the
NV-vs-DE alternative. GovFiles remains the better choice for states it covers in full and for its
supplementary tables (addresses, filings, names).

### The OpenCorporates bulk snapshot

- **Files:** `companies`, `additional_identifiers`, `alternative_names`, `non_reg_addresses`, `officers` (`.csv.gz`, 12.7 GB, all 61 jurisdictions, 104.5M company rows) plus `md5sum.txt`. Schema: OpenCorporates' Client Bulk Data Dictionary v1.6 (attached to the delivery ticket).
- **Copies:** UVA OneDrive `Documents/resources/opencorp/` (uploaded by rclone 2024-06-04; the `uva-onedrive` rclone token may be expired, so read through the Graph token from `ortie -a msgraph token show`). `companies` and `additional_identifiers` are md5-verified at `/data/nevada/data/raw/opencorporates_20230706/` with `provenance.json`. A duckdb/polars profile and the linking code are in `~/projects/nevada/scratch/opencorp_profile/` and `~/projects/nevada/src/nevada/nv_registry/`.
- **Provenance:** granted under OpenCorporates' public-benefit program to the NYU Law Institute for Corporate Governance and Finance (PI: the user; ticket OCESD-5924, data transfer agreement via Adobe Sign, June 2023). Delivered once to SFTP `files.opencorporates.io:22`, user `prod-sftp-nyu_law`, folder `2023-07-06`. The credentials email ("Your OpenCorporates SFTP Credentials", 2023-06-28) is in the user's NYU Gmail (eh2889@nyu.edu, 1Password item `nyu.edu`). As of 2026-10-08 the account still logs in and holds only that folder.
- **Refresh:** there is no standing feed. A refresh was requested from support@opencorporates.com on 2026-10-08 (citing OCESD-5924); a new delivery may need a new agreement under UVA.
- **API:** the user's web login (1Password item `opencorporates.com`) has no API token. Self-serve API plans start at £225/month for 500 calls; academic access is by application. **Do not scrape the website as a substitute.**

## Tables (7)

`GovFiles Companies` is PRIMARY; the other six are SUPPLEMENTARY and every one of them joins on
the composite key **`(JURISDICTION_CODE, ENTITY_NUMBER)`** — both 100% populated everywhere.

| Table | Grain |
|---|---|
| **GovFiles Companies** (primary) | one row per registered entity |
| GovFiles Company Addresses | one row per address slot (registered / headquarters / mailing) |
| GovFiles Company Filings | one row per statutory filing (annual reports, amendments) |
| GovFiles Company Identifiers | one row per external identifier — FEIN and four state legacy IDs in FL, MA, MI, TX, VT, WA only; **0 `us_sec_cik` rows** (2026-10-07) |
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
scheme examples are `us_fein`, `us_sec_cik`, `lei`, but the 2026-10-07 snapshot has **0 `us_sec_cik` rows** and only 5 schemes (FEIN plus four state legacy IDs), in 6 states (FL, MA, MI, TX, VT, WA); 0 identifier rows for `us_nv` or `us_de`. The CIK bridge does not exist in practice.

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

**There is no CIK bridge in the 2026-10-07 snapshot.** The documented schemes include `us_sec_cik`
and `lei`, but `Company Identifiers` has 0 `us_sec_cik` rows and identifiers only in FL, MA, MI, TX,
VT, WA. Link to the securities-research identifier space by name instead: take EDGAR company names
from `wrdssec_all.wrds_forms`, match exactly on normalized legal name (see `fuzzy-name-matching`
for anything looser), and measure the match rate and the multi-candidate share on your sample
first. In the nevada test, strict name matching reached 82–87% of CIKs for DE but only a 3.8%
true match for NV movers, because of NV coverage.

Other fits: Delaware-domicile questions via `JURISDICTION_CODE = 'us_de'` + `DOMICILE`
(`domestic`/`foreign`); formation/dissolution dating for survival analysis (`FORMED_ON` 92%,
`DISSOLVED_ON` 23% — and note the base rate, since most entities are not dissolved);
administrative-vs-voluntary dissolution as a distress signal via `STATUS_RAW`; and
mass-registration / shell detection through shared registered-agent addresses in
`Company Addresses`.

## Worked pattern — DuckDB over the downloaded Parquet

Per the SKILL Iron Law, sample first. Then the composite key drives everything:

```sql
-- Delaware corporations with an FEIN identifier (illustrative: us_de has no identifier rows in the
-- 2026-10-07 snapshot, so run this on FL/MA/MI/TX/VT/WA), plus their registered address
SELECT c.ENTITY_NUMBER, c.LEGAL_NAME, c.STATUS, c.FORMED_ON,
       i.VALUE AS fein, a.STREET_ADDRESS, a.LOCALITY, a.REGION
FROM companies c
JOIN identifiers i USING (JURISDICTION_CODE, ENTITY_NUMBER)
LEFT JOIN addresses a USING (JURISDICTION_CODE, ENTITY_NUMBER)
WHERE c.JURISDICTION_CODE = 'us_fl'
  AND c.LEGAL_FORM = 'corporation'
  AND i.SCHEME = 'us_fein'
  AND a.ADDRESS_KIND = 'registered';
```

Two things that will bite: joining `identifiers` without the `SCHEME` filter fans out one row per
scheme, and joining `addresses` without `ADDRESS_KIND` fans out up to three ways. Both are silent
row multipliers — check your row count against `COUNT(DISTINCT (JURISDICTION_CODE, ENTITY_NUMBER))`
after every join.
