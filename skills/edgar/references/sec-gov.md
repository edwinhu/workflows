# Fetching from SEC.gov

For what WRDS lacks: rules releases, SEC web pages, data.sec.gov XBRL APIs, EDGAR full-text search, filings newer than `max(fdate)` in `wrds_forms`, and a one-filing spot check. More than one filing goes through WRDS (`../SKILL.md`).

## Declare yourself

<EXTREMELY-IMPORTANT>
**SEC blocks anonymous and browser-spoofing requests (a `Mozilla/5.0` User-Agent gets 403) and allows programmatic access that declares a real name and contact email. NEVER SPOOF A BROWSER.** Spoofing is not helpful: it is exactly what gets blocked.
</EXTREMELY-IMPORTANT>

```bash
UA="${SEC_USER_AGENT:?set SEC_USER_AGENT to a name and contact email}"
curl -s -A "$UA" "$url" -o out.pdf
```

- The contact email must be real: SEC writes to it about traffic, and a fake one risks a block. This repo is public, so the value lives in the environment and never in these files. If it is unset, ask the user.
- At most 10 requests/second, or the IP is blocked for a while; `sleep 0.15` between successive requests.
- WebFetch spoofs a browser and gets 403 on sec.gov. Use `curl` with the declaring User-Agent.

## Rules releases

```bash
curl -s -A "$UA" "https://www.sec.gov/files/rules/proposed/2026/34-105655.pdf" -o release.pdf
curl -s -A "$UA" "https://www.sec.gov/files/rules/final/34-51808.pdf" -o adopting.pdf
```

Path: `https://www.sec.gov/files/rules/{proposed,final}/<year>/<release>.pdf`; older releases omit the year.

## data.sec.gov JSON APIs

```bash
# XBRL company facts, then one concept across time (CIK zero-padded to 10 digits)
curl -s -A "$UA" "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
curl -s -A "$UA" "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json"
# One CIK's filings newer than WRDS's lag; every older list comes from wrds_forms
curl -s -A "$UA" "https://data.sec.gov/submissions/CIK0000320193.json"
```

## EDGAR full-text search (2001 to present)

Every document in every filing, exhibits included, is indexed. The UI is `https://www.sec.gov/edgar/search/`; scripts call the JSON endpoint behind it. Use it to find hits; to fetch more than one, pass the accessions to `edgar_filing.py fetch`.

```bash
curl -s -A "$UA" 'https://efts.sec.gov/LATEST/search-index?q=%22transition%20agreement%22%20%22continue%20to%20vest%22&forms=8-K&startdt=2020-01-01&enddt=2026-09-30' \
  | jq '.hits.total, [.hits.hits[] | {_id, form: ._source.form, type: ._source.file_type, date: ._source.file_date, who: ._source.display_names[0], items: ._source.items}]'
```

- **`q`**: quoted phrases, all required, all in one document (phrases split across a filing's exhibits do not match).
- **`forms`**: base forms, comma-separated (`8-K,10-K`). A base form already includes its amendments, and listing any `/A` form collapses the result to amendments only: `forms=8-K` gives 149 hits, `forms=8-K,8-K/A` gives 5.
- **`startdt`/`enddt`**: `YYYY-MM-DD`. Omit `dateRange=custom`, which intermittently returns `{"message": "Internal server error"}`; retry once on that body. **`ciks`**: 10-digit.
- **One hit is one document, not one filing**, so hit counts overstate agreements. `_id` is `<accession>:<filename>`; `_source` carries `adsh`, `ciks`, `display_names`, `file_date`, `form`, `file_type` (`EX-10.1`), `file_description`, `items` (8-K items), `sics`, `biz_states`, `inc_states`, `period_ending`.
- **Paging**: 100 per page (`&from=100`, `&from=200`). Results stop at 10,000, where `hits.total` reads `{"value":10000,"relation":"gte"}` and is not a count. Split by date range until each slice has `relation: "eq"`.
- For a phrase screen over many filings on WRDS, see `sec-text-search.md`; neither route finds everything.

## When the SEC page is down

A live "File Unavailable / undergoing maintenance" page is an outage, not a block. The Wayback Machine mirrors SEC:

```bash
snap=$(curl -s "http://archive.org/wayback/available?url=$url" | jq -r '.archived_snapshots.closest.url')
curl -s "$snap" -o page.html
```

`nlm source add` accepts `web.archive.org/web/<ts>/<sec-url>` snapshot URLs.
