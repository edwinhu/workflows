---
name: bright-data
version: 1.0
description: Use when "query Bright Data", "Bright Data datasets", "Bright Data Web Archive / Wayback alternative", "scrape with Web Unlocker", "FINRA BrokerCheck data", "SEC IAPD / adviserinfo data", "Investment Adviser Public Disclosure", "broker/adviser disclosure snapshots", "LinkedIn/Crunchbase/Glassdoor company or people dataset", or any use of the Bright Data API (datasets/list, Web Archive search/dump, Web Unlocker zones). Covers the verified FINRA BrokerCheck + SEC IAPD archive coverage finding.
user-invocable: false
---

## Contents

- [Cost Enforcement](#cost-enforcement)
- [Auth](#auth)
- [What Bright Data Offers](#what-bright-data-offers)
- [Web Archive API (verified)](#web-archive-api-verified)
- [Dataset Marketplace API](#dataset-marketplace-api)
- [Pricing Model](#pricing-model)
- [FINRA BrokerCheck & SEC IAPD Coverage](#finra-brokercheck--sec-iapd-coverage)
- [Additional Resources](#additional-resources)

## Cost Enforcement

<EXTREMELY-IMPORTANT>
Bright Data bills real money. Two API actions are FREE, the rest cost.

- **FREE:** `GET /datasets/list`; `POST /webarchive/search` + polling `GET /webarchive/search/<id>` (returns counts + `dump_cost_usd` WITHOUT charging).
- **PAID:** `POST /webarchive/dump` (~$0.001/page), Web Unlocker requests (~$1.5–3 per 1k successes), dataset record purchases/triggers (per-record).

NEVER call `/webarchive/dump`, trigger a dataset collection, or create/use a Web Unlocker zone unless the user has explicitly approved the spend for THAT operation. Always run a free `search` first to get the exact `dump_cost_usd` and show it to the user before any dump.

The default read-only token (`BRIGHTDATA_API_TOKEN`) can list datasets and run archive searches but CANNOT create zones. Do not attempt zone creation with it.
</EXTREMELY-IMPORTANT>

## Auth

All endpoints use a Bearer token. NEVER hardcode it. Read from env or a gitignored key file:

```bash
# preferred: env var
export BRIGHTDATA_API_TOKEN=...        # set in shell profile / .env (gitignored)
# fallback used during this project:
TOKEN=$(cat ~/projects/batm/scratch/brd_token.txt)   # gitignored key file
```

```python
import os
TOKEN = os.environ.get("BRIGHTDATA_API_TOKEN") or open(os.path.expanduser("~/.config/brightdata/token")).read().strip()
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
```

## What Bright Data Offers

Three relevant products:

1. **Dataset marketplace** — ~1,576 pre-collected datasets (`GET /datasets/list`). Heavily social/company/people (LinkedIn 115M people, Instagram 620M, Crunchbase 2.3M, Glassdoor, etc.). **No government/regulatory/licensing products** except a "US lawyers directory" (1.4M). See `references/datasets-catalog.md`.
2. **Web Archive** — Bright Data's own crawl archive (a Wayback-like corpus). Searchable for free by domain/URL/date; dumps cost ~$0.001/page. This is where the **FINRA/SEC coverage** lives. See `references/webarchive-api.md`.
3. **Web Unlocker / scraping zones** — on-demand unblocked fetch of live pages (anti-bot bypass). Requires a writable token to create zones. ~$1.5–3 per 1k successful requests.

## Web Archive API (verified)

Base: `https://api.brightdata.com/webarchive`. Async — search returns a `search_id`, poll until `status == "done"`.

```bash
# 1. Launch a FREE search (returns {"search_id": "..."})
curl -s -X POST https://api.brightdata.com/webarchive/search \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filters":{"min_date":"2015-01-01","max_date":"2026-06-10","domain_whitelist":["brokercheck.finra.org"]}}'

# 2. Poll (FREE) — when done returns files_count, dump_cost_usd, estimate_batch_count
curl -s https://api.brightdata.com/webarchive/search/<search_id> \
  -H "Authorization: Bearer $TOKEN"
```

**Filters** (body `{"filters":{...}}`):
- Required: either `max_age` OR `min_date`+`max_date` (YYYY-MM-DD).
- `domain_whitelist` — exact host match, array.
- `domain_like_whitelist` — SQL LIKE, e.g. `["%finra%"]`.
- `url_like_whitelist` — SQL LIKE on full URL (use to scope a cheap subset dump).
- `unique_url` (bool) — count/dump distinct URLs only (dedupes repeat snapshots).

Searches can take 9+ minutes. Launch many in parallel, then poll every ~20s. See `references/webarchive-api.md` for a working parallel-poll Python harness.

`dump_cost_usd ≈ files_count / 1000` confirms the ~$0.001/page dump price.

## Dataset Marketplace API

```bash
curl -s https://api.brightdata.com/datasets/list -H "Authorization: Bearer $TOKEN"
# -> [{"id":"gd_...","name":"...","size":<approx record count>}, ...]
```

`size` is approximate record count. Pulling records (snapshot/trigger) is a separate paid step — not covered by the read-only token. See `references/datasets-catalog.md` for the categorized highlights.

## Pricing Model

| Action | Cost | Notes |
|---|---|---|
| `GET /datasets/list` | free | metadata only |
| `POST /webarchive/search` + poll | free | returns count + `dump_cost_usd` |
| `POST /webarchive/dump` | ~$0.001 / page | the paid step; confirm cost first |
| Web Unlocker request | ~$1.5–3 / 1k successes | needs writable token + zone |
| Dataset records | per-record | snapshot/trigger; varies by dataset |

## FINRA BrokerCheck & SEC IAPD Coverage

Verified 2026-06-10 via free Web Archive searches. **Bright Data IS a viable source for current BrokerCheck/IAPD data — via the Web Archive, not the marketplace.**

- **No FINRA/broker/adviser/IAPD/RIA dataset exists in the marketplace.**
- **Web Archive has a massive recent crawl:**
  - `brokercheck.finra.org` — 1,434,501 snapshots / **714,614 distinct URLs** (~$715 to dump distinct).
  - `adviserinfo.sec.gov` — 1,635,389 snapshots / **664,043 distinct URLs** (~$664 to dump distinct).
  - `api.brokercheck.finra.org` and `reports.adviserinfo.sec.gov` = **0** (only the HTML profile pages were captured, not the JSON API or PDF reports).
- **Temporal:** zero pre-2024; essentially all 2025 (~1.0–1.2M each) + 2026 (~235k–633k). It's a **current cross-section + start of a 2025→2026 panel**, NOT a deep historical time series.

Full numbers, year brackets, and verdict in `references/finra-sec-coverage.md`. For deep disclosure history (pre-2024), use FINRA/SEC bulk downloads or WRDS instead (see the `wrds` skill, Form ADV).

## Additional Resources

### Reference Files

- **`references/webarchive-api.md`** — full Web Archive API reference, filters, the parallel-poll Python harness, `url_like_whitelist` subset-dump pattern, cost arithmetic.
- **`references/datasets-catalog.md`** — categorized highlights of the 1,576-dataset marketplace (company/people/finance/professional), with ids and sizes; how to re-fetch the catalog.
- **`references/finra-sec-coverage.md`** — verified FINRA BrokerCheck + SEC IAPD coverage: totals, distinct, year-by-year temporal spread, dump costs, and the viability verdict.
