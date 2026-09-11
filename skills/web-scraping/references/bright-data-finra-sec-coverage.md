# Bright Data — FINRA BrokerCheck & SEC IAPD Coverage

Verified 2026-06-10 via FREE Web Archive searches (counts + estimated dump cost; no charge incurred, no dumps run).

## Verdict

**Bright Data IS a viable source for FINRA BrokerCheck and SEC IAPD data — via the Web Archive, NOT the dataset marketplace.**

- No FINRA/broker/adviser/IAPD/RIA dataset in the 1,576-dataset marketplace.
- The Web Archive holds a massive, near-complete **recent** crawl of both registries.
- **Caveat:** it is a current cross-section + the start of a 2025→2026 panel, NOT a deep historical time series. Zero coverage before 2024. For pre-2024 disclosure history, use FINRA/SEC bulk downloads or WRDS Form ADV (see the `wrds` skill).

## Domain totals (range 2015-01-01 → 2026-06-10)

| Domain | Filter | Snapshots | Dump cost |
|---|---|---|---|
| brokercheck.finra.org | exact | **1,434,501** | $1,434.41 |
| brokercheck.finra.org | distinct (`unique_url`) | **714,614** | $714.54 |
| api.brokercheck.finra.org | exact | 0 | — |
| `%finra%` | LIKE | 1,643,164 | $1,642.57 |
| adviserinfo.sec.gov | exact | **1,635,389** | $1,634.46 |
| adviserinfo.sec.gov | distinct (`unique_url`) | **664,043** | $663.57 |
| reports.adviserinfo.sec.gov | exact | 0 | — |
| `%adviserinfo%` | LIKE | 1,636,411 | $1,635.48 |

Notes:
- `%finra%` is only ~209k above `brokercheck.finra.org` — the extra is other FINRA hosts (e.g. `www.finra.org`). BrokerCheck dominates FINRA coverage.
- `%adviserinfo%` ≈ `adviserinfo.sec.gov` — that is effectively the only adviserinfo host.
- The **API and PDF-report subdomains have ZERO snapshots** — only the **HTML profile pages** were captured, not the JSON API or downloadable PDF reports. Extraction means parsing rendered HTML.
- Distinct ratio: BrokerCheck ~50% unique (~2 snapshots/page); IAPD ~41% unique (~2.4 snapshots/page) — consistent with a registry crawled roughly twice across 2025–2026.

## Temporal spread (the key value question)

| Year | brokercheck.finra.org | adviserinfo.sec.gov |
|---|---|---|
| 2016 | 0 | 0 |
| 2018 | 0 | 0 |
| 2020 | 0 | 0 |
| 2022 | 0 | 0 |
| 2024 | 1,300 | 482 |
| 2025 | 1,174,869 | 1,001,990 |
| 2026 | 235,371 | 632,575 |

**Not a longitudinal archive.** Value = (1) a current, near-universe cross-section (~715k distinct broker pages, ~664k distinct adviser pages — plausibly close to the full registrant universe); (2) the beginning of a panel (2025 vs 2026 enables ~1-year change detection: new disclosures, departures, status changes).

## Cost & extraction

- Search = free; dump ≈ **$0.001/page**.
- Clean current cross-section (dump the `unique_url` set): BrokerCheck ~$715; IAPD ~$664.
- To pull a cheaper subset, add `url_like_whitelist` (e.g. only individual broker summary pages) and re-search to get the subset's exact cost before dumping.
- Captured content = HTML profile page → parse rendered HTML (the structured JSON API and PDF reports were not archived).

## Reproduce

Run the parallel-poll harness in `webarchive-api.md` with these filters (all FREE):
```python
ALL = {"min_date": "2015-01-01", "max_date": "2026-06-10"}
searches = {
    "brokercheck":          {**ALL, "domain_whitelist": ["brokercheck.finra.org"]},
    "brokercheck_distinct": {**ALL, "domain_whitelist": ["brokercheck.finra.org"], "unique_url": True},
    "adviserinfo":          {**ALL, "domain_whitelist": ["adviserinfo.sec.gov"]},
    "adviserinfo_distinct": {**ALL, "domain_whitelist": ["adviserinfo.sec.gov"], "unique_url": True},
    # year brackets: set min_date/max_date to one year to map the temporal spread
}
```
