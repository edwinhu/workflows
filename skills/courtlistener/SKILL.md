---
name: courtlistener
description: "Use when the user says 'CourtListener', 'Free Law Project', 'RECAP', 'PACER data', 'court opinions', 'get the opinion text', 'federal dockets', 'delch', 'Delaware Chancery opinions', 'state court opinions', 'demand futility opinions', 'judicial financial disclosures', 'oral arguments', or needs case law, dockets or opinion full text for empirical legal research. Also use when someone assumes CourtListener is federal-only, or hits a token or human-verification wall on it."
---

# CourtListener for empirical legal research

Free Law Project's corpus. Three access routes with very different properties, and one
distinction that people get wrong before they start.

## The two corpora are not the same thing

<EXTREMELY-IMPORTANT>
**"CourtListener is federal-only" is true of RECAP and FALSE of opinions.** Getting this wrong
sends you to a paid vendor for state-court data that is sitting here free.

| corpus | source | coverage | contains |
|---|---|---|---|
| **Opinions** (case law) | scraped from court websites | federal **and state** | written decisions, full text |
| **RECAP** | PACER | **federal only** | docket entries, motions, filings |

The tell is on the court record itself: `pacer_court_id: null` + `has_opinion_scraper: true`
means a scraped state court, not a PACER one. Verified on Delaware Chancery:

```
GET /api/rest/v4/courts/delch/
  "full_name": "Court of Chancery of Delaware"
  "jurisdiction": "SA"            <- state
  "has_opinion_scraper": true
  "pacer_court_id": null          <- NOT RECAP
```
</EXTREMELY-IMPORTANT>

## Pick the route before writing any code

| route | auth | best for | cost |
|---|---|---|---|
| **Bulk data files** | **none** | any corpus-scale analysis | quarterly snapshot, big files |
| REST API v4 | `search`/`courts` unauth; `dockets` needs a token | targeted queries, current data | rate-limited, polite pacing on you |
| DB replication / MCP | membership or commercial | continuous sync | contact FLP |

**Default to bulk for research.** It is public domain, needs no account, and does not rate-limit
you. Reach for the API only when you need data newer than the last quarterly snapshot, or when
you want a few hundred records rather than a corpus.

## Bulk data

No authentication. Public Domain Mark. Regenerated **quarterly on the last day of March, June,
September and December**. Snapshots, not deltas — each file is the whole table.

```
https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/
aws s3 ls s3://com-courtlistener-storage/bulk-data/ --no-sign-request
```

Measured sizes, 2026-06-30 snapshot:

| file | size | carries |
|---|---:|---|
| `opinions-YYYY-MM-DD.csv.bz2` | **54.6 GB** | opinion **full text** |
| `opinion-clusters-…` | 2.46 GB | court, `date_filed`, case name, `docket_number` |
| `dockets-…` | 5.01 GB | docket metadata |
| `courts-…` | <10 MB | the court table |
| `citation-map-…` | 0.52 GB | citation graph |

Also published: financial disclosures, judges, oral arguments, and ~2 TB of ModernBERT opinion
embeddings at `s3://com-courtlistener-storage/embeddings/opinions/`.

**Filter clusters first, then stream opinions.** `opinion-clusters` is 22× smaller and carries
the court and date. Select the cluster ids you want, then stream-decompress the 54 GB opinions
file and keep only matching rows. Never materialise the opinions CSV.

Files are `PostgreSQL COPY TO` output: CSV, UTF-8, header row. Schema dumps are published
alongside; field definitions are in the CourtListener GitHub `models.py`, or via an `OPTIONS`
request to the matching API endpoint.

## REST API v4

```
https://www.courtlistener.com/api/rest/v4/
```

- `search` and `courts` work **unauthenticated** — 3,358 `delch` opinions were pulled in 206
  unauthenticated calls.
- `dockets` returns `{"detail":"Authentication credentials were not provided."}` without a token.
- Token lives at `/profile/api/` — **which sits behind a "Let's confirm you are human"
  interstitial**. That gate is the site's bot check and belongs to Free Law Project; the user
  clears it, not you.
- Search type params: `type=o` opinions, `type=r` RECAP dockets.

**Pace politely and back off on 429/5xx.** This is a nonprofit's free service; without a token
there is no quota to raise, so courtesy is the entire budget.

## API Facts

- **`suitNature` is not normalised.** The same NOS 160 appears as `Stockholders Suits`,
  `160 Contract: Stockholders Suits` and `160 Stockholders Suits`. Query the *text*
  (`suitNature:"Stockholders Suits"`), not the numeric code, or you silently lose most of the set.
- **Derivative suits are docketed under more than one NOS.** `"shareholder derivative"` returns
  1,670 under NOS 160 and 2,020 under 850 (Securities/Commodities). Filtering to 160 alone drops
  more than half.
- **`docketNumber` carries the C.A. number**, which joins directly to a Delaware Chancery docket
  from Lex Machina or CourtConnect — measured at **100% match** on 2,350 rows. That join is what
  lets a filing universe from one source meet a ruling from this one.
- **Opinions are written decisions only, and that is a selection, not a gap.** Measured against a
  verified Chancery filing universe: **82% of caption-derivative filings never produce a written
  opinion**, because most dispositions are bench rulings from the transcript. An outcome variable
  built from opinions describes the selected fifth. Reporting a dismissal rate without that
  denominator is an unverified claim dressed as a finding.
- **The bulk snapshot lags up to a quarter.** The 2026-06-30 file lands two weeks after a
  2026-06-15 event, so a study of anything recent gets a truncated post-period until the next
  drop. Check the snapshot date against your event date before designing the test.

## Coverage and what is coming

Delaware Chancery: **3,358 opinions since 2012** (`delch`). Texas currently covers the Supreme
Court, Court of Criminal Appeals and the 15 civil courts of appeal.

From the FLP wiki, verbatim:

> "In 2026, we are collecting content from high and appellate courts at the five most populous
> states: California, New York, Texas, Florida, and Pennsylvania."

> "In 2027 we aim to continue this with the Delaware Chancery Court and the next most populous
> states."

The 2027 item is **filings**, not opinions — Chancery opinions already exist. Docket-level state
coverage would reach the bench rulings the opinion corpus structurally cannot see.

## Red Flags — STOP if you catch yourself

| About to | Why wrong | Do instead |
|---|---|---|
| Tell the user CourtListener is federal-only | True of RECAP, false of opinions — state case law is there | Check `pacer_court_id` / `has_opinion_scraper` on the court |
| Page the REST API for a corpus-scale pull | Rate-limited, slow, and rude to a nonprofit when the same data is a free download | Bulk files |
| Clear the human-verification interstitial to get a token | It is the site's bot check, and you are a bot | Ask the user; or use the unauthenticated endpoints, which cover most needs |
| Decompress the 54 GB opinions CSV to disk | You need a few thousand rows of it | Filter `opinion-clusters` first, then stream and match |
| Filter derivative suits on NOS 160 alone | 2,020 of them are docketed 850 | `160 OR 850` plus a text filter, then hand-check |
| Report a dismissal rate from opinions without the selection denominator | 82% of filings never get a written opinion; the rate describes the selected fifth | Quantify selection against a filing universe and lead with it |
| Assume the bulk snapshot is current | Quarterly, and the boundary may fall days after your event | Read the snapshot date; use the API for the tail |

## Related

- `ui-json-capture` — when the source is a paywalled UI rather than an open corpus
- `wrds` — the SEC-filing side of the same research questions
