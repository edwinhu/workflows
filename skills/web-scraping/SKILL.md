---
name: web-scraping
version: 1.0
description: Use when "scrape this site at scale", "fetch N thousand pages", "how many workers should this scraper use", "am I hammering this server", "we're getting 429s / blocked / CAPTCHAs", "should we use a proxy", "Zyte", "ScrapingBee", "Web Unlocker", "residential proxy", "rotate proxies", "scrape with Web Unlocker", "query Bright Data", "Bright Data datasets", "Bright Data Web Archive / Wayback alternative", "FINRA BrokerCheck data", "SEC IAPD / adviserinfo data", "Investment Adviser Public Disclosure", "broker/adviser disclosure snapshots", "LinkedIn/Crunchbase/Glassdoor company or people dataset", or any use of the Bright Data API (datasets/list, Web Archive search/dump, Web Unlocker zones).
user-invocable: false
---

# Web Scraping

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Bulk fetching from hosts you do not own: how fast you may go, when a paid transport beats a direct
fetch, and how to prove the fallback you are relying on has ever run.

## Contents

- [Iron Law: the rate is computed, not chosen](#iron-law-the-rate-is-computed-not-chosen)
- [Quota vs rate limit](#quota-vs-rate-limit)
- [Verify the fallback before you rely on it](#verify-the-fallback-before-you-rely-on-it)
- [Direct fetch or paid transport](#direct-fetch-or-paid-transport)
- [Vendor table](#vendor-table)
- [Facts](#facts)
- [Red flags — STOP](#red-flags--stop)
- [References](#references)

## Iron Law: the rate is computed, not chosen

<EXTREMELY-IMPORTANT>
**NO CONCURRENT NETWORK CLIENT WITHOUT A COMPUTED EFFECTIVE REQUEST RATE AND THE TARGET'S
DOCUMENTED CEILING, BOTH WRITTEN IN THE CODE.** This is constraint **E7** in the ds engineering
set — `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-network-politeness.md` is the normative
text; this skill is its vendor-facing half.

`workers / sleep_seconds` is the policy. A worker count with no arithmetic beside it is not a tuning
decision — it is an unreviewed multiplication of load on somebody else's server, usually from an IP
the institution owns and cannot swap. Raising 1 worker to 8 to "help the run finish faster" is not
helpful if it is the run that gets the university's address throttled: the user then loses the whole
corpus, not the hours you saved.
</EXTREMELY-IMPORTANT>

```python
# ceiling: SEC EDGAR publishes 10 req/s and requires a declared User-Agent
# https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data (read 2026-09-08)
WORKERS, SLEEP_SECONDS = 8, 1.0
EFFECTIVE_RPS = WORKERS / SLEEP_SECONDS          # 8.0 req/s = 80% of the documented ceiling
assert EFFECTIVE_RPS <= 10.0
```

No published ceiling → say so with the URL and the date you looked, and hold at 1 req/s.
"Not documented" is not "unlimited".

## Quota vs rate limit

Name which one the target enforces, in a comment next to the worker count. The two have **opposite**
corrections, so a client that has not named one has guessed.

| | caps | more workers → |
|---|---|---|
| **Rate limit** | requests per unit time | hits the cap sooner *per second*; total budget untouched, throttled requests retry, job still completes |
| **Quota** | total requests per IP/key per period | does **not** reduce total requests — only **exhausts the budget sooner** |

Under a quota, parallelising buys nothing on the binding constraint and brings the wall forward.
Under a rate limit, parallelising up to the ceiling is exactly right.

A fact recorded in a module docstring but never connected to the worker count is a fact nobody
applied. Put it where the decision is.

## Verify the fallback before you rely on it

A declared fallback transport — proxy, unblocker, mirror, secondary API — is **unverified until it
has executed**. Count it; do not read about it.

```bash
xan frequency -s transport data/output/manifest.csv
# direct,1538
# proxy,0        <- documented as required; has never once run
```

Zero uses forces one of three, stated explicitly:

1. **Exercise it** — force the fallback on a 5–10 row test, record the result, keep the dependency.
2. **Downgrade the claim** — mark it `UNVERIFIED — 0 executions as of <date>` everywhere it appears.
3. **Delete it** — dependency, credentials and docs together.

Leaving a never-run path documented as required is the worst option: it makes an untested branch
look like a safety margin, so the run proceeds at a pressure the fallback was supposed to justify.

## Direct fetch or paid transport

| Situation | Use |
|---|---|
| Public data, documented ceiling, no anti-bot | **Direct fetch** at the computed rate. A proxy here buys nothing and bills per request. |
| Per-IP **quota** you will exhaust | Paid transport — it is the only thing that changes the binding constraint, because it changes the IP. More local workers cannot. |
| Anti-bot / CAPTCHA / fingerprinting | Paid unblocker. Rolling your own is a maintenance treadmill. |
| Geo-restricted content | Proxy with geo-targeting. |
| Data already collected by a vendor | Buy the dataset or archive dump; do not re-crawl. |

## Vendor table

Every figure below was read from the vendor's own page on **2026-09-08**; URLs in
[References](#references). Pricing and limits move — re-read before quoting them to anyone.

| | Zyte API | Bright Data | ScrapingBee |
|---|---|---|---|
| **Throughput model** | **Rate limit, RPM-based** — 3,000 RPM standard, 10,000 RPM enterprise, per API key. Not a concurrency cap. | Per-zone concurrency + spend caps. **Vendor claims no concurrency limit** (SERP pricing FAQ); no canonical docs page states a number — treat as unverified. | **Concurrency cap, per plan** — 25 / 50 / 100 / 200 / 400 concurrent requests, Hobby → Business+. |
| **Over-limit behaviour** | HTTP 429, **charged nothing**, retry with backoff; official clients retry by default. | Per-zone auto-throttling on the target; spend limit is the real guardrail. | 429/5xx from the target; failed attempts still burn credits unless `mode=auto` fails entirely (0 credits). |
| **Client concurrency knob** | `AsyncZyteAPI(n_conn=...)`, `CONCURRENT_REQUESTS` in Scrapy; docs use ~15 as the worked example. | Zone config; raise via support. | Whatever your plan's cap is — cap **per domain**, not just globally. |
| **Billing unit** | Per **successful** response; tier depends on target + HTTP vs browser. Screenshots $0.002; auto-extraction $0.0004–$0.0016/type. | Per successful request: Unlocker/SERP/Crawl from **$1/1k req**; Browser API from $5/GB; Web Archive dump ~$0.001/page; datasets from $250/100k rec. | **Credits**: 1 plain, 5 JS render, 10 premium proxy no-JS, 25 premium+JS, 75 stealth. Plans $19–$599/mo for 75k–8M credits. |
| **Entry price** | PAYG on signup, $5 free credit, $100/mo spend limit. | Free tier on Unlocker/SERP/Scraper APIs. | 1,000 free credits, no card. |
| **Best at** | Scrapy-native pipelines; explicit published rate limits you can compute against. | Breadth — archive corpus, prebuilt datasets, unlocker, all under one token. Already wired for FINRA/IAPD work. | Simple REST unblocking with a hard, legible concurrency number per plan. |

**Do not read the concurrency column as a target.** It is the vendor's ceiling on *their* side; the
target site's ceiling is a different number and is the one E7 measures against. ScrapingBee's own
docs warn that running at the cap provokes 429/5xx from targets and burns credits on failures.

## Facts

- SEC EDGAR publishes **10 requests/second** and requires a declared `User-Agent` naming a contact
  address; it explicitly reserves the right to throttle and states it does not allow botnets or
  automated crawling outside that policy. A scraper that neither declares a UA nor computes its rate
  is not merely impolite — it is the case the policy names, and the block lands on the shared IP.
- **Rate-limited Zyte requests cost nothing**, so retrying with backoff is free; a hand-rolled
  client that treats 429 as a fatal error throws away a retry the vendor already priced at zero.
- **ScrapingBee credits are not requests.** JS rendering is 5×, premium proxy with JS is 25×, stealth
  is 75×. A 1M-credit plan is 1M pages only if nothing renders JS — sizing a job in "requests"
  against a credit allowance overstates capacity by up to 75×.
- **Bright Data's "unlimited concurrency" appears in pricing/marketing copy, not in a docs page with
  a number.** Quoting it as a verified limit is an unverified claim presented as fact; if a run
  depends on it, open a ticket and get the zone provisioned rather than assuming.
- A per-IP **quota** is the one case where local concurrency cannot help at all. Parallelising into a
  quota is the shape of work that looks like a 3× speedup in the log and is a 0× improvement on what
  the run can actually retrieve.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Set `max_workers=N` with no `EFFECTIVE_RPS` beside it | The load change is unreviewed and unrecorded | Compute `workers / sleep`, name the ceiling and its URL |
| Raise workers because the job is slow | If the target enforces a quota this buys nothing and exhausts it sooner | Name quota vs rate limit first; that decides the fix |
| Treat "no documented rate limit" as permission | Absence of a published number is not consent | Hold at 1 req/s and record where you looked |
| Cite a fallback proxy as the answer to a quota | It may never have executed | `xan frequency -s transport` on the manifest; zero uses = untested |
| Quote a vendor concurrency or price figure from memory | These pages changed within the last year | Re-read the vendor page and date the citation |
| Size a ScrapingBee job in requests against a credit allowance | Credits are 1–75× per request | Multiply by the tier you will actually use |
| Call a paid unblocker for public, unprotected pages | Bills per request for something a direct fetch does free | Direct fetch at the computed rate |
| Run a bulk scrape without a 5–10 page test first | Repo rule: test before scaling | Fetch 5–10, inspect, then scale |

## References

Read on **2026-09-08**:

- Zyte rate limits — https://docs.zyte.com/zyte-api/usage/rate-limit.html
- Zyte pricing (3,000/10,000 RPM, spend limits, per-feature costs) — https://docs.zyte.com/zyte-api/pricing.html
- Zyte parallelism guidance — https://docs.zyte.com/zyte-api/usage/optimize.html
- ScrapingBee pricing (plans, credits, concurrency) — https://www.scrapingbee.com/pricing/
- ScrapingBee credit multipliers and `mode=auto` — https://www.scrapingbee.com/documentation/
- Bright Data Web Unlocker overview — https://docs.brightdata.com/scraping-automation/web-unlocker/introduction
- Bright Data pricing — https://brightdata.com/pricing/web-unlocker
- SEC EDGAR fair-access policy — https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data

Local:

- `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-network-politeness.md` — constraint E7, normative.
- `${CLAUDE_SKILL_DIR}/references/bright-data-api.md` — Bright Data API, auth, cost enforcement, endpoints.
- `${CLAUDE_SKILL_DIR}/references/bright-data-webarchive-api.md` — Web Archive filters and parallel-poll harness.
- `${CLAUDE_SKILL_DIR}/references/bright-data-datasets-catalog.md` — the 1,576-dataset marketplace.
- `${CLAUDE_SKILL_DIR}/references/bright-data-finra-sec-coverage.md` — verified FINRA/IAPD coverage and dump costs.
- The `sec-fetch` skill owns SEC.gov specifically (declared-UA access that avoids the 403).
