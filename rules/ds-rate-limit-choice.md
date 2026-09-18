---
name: ds-rate-limit-choice
applies-to: [ds]
---

**What a script already decides:** `constraints/ds-network-politeness.py` decides that a concurrent client states a computed rate. Whether that rate is polite to the host is this rule.

# E7 — Network politeness: state the rate, name the failure mode, prove the fallback ran

**Rule.** Any code that fetches from a host it does not own must carry three facts **in the code**,
each of them a number or a named alternative rather than a disposition. A worker count chosen
without them is not a tuning decision, it is an unreviewed increase in request pressure on somebody
else's server — and when the client runs from an institutional IP, the address that gets throttled
or blocked belongs to the university, not to the run.

## The three facts

**1. The effective request rate, computed, against the target's documented ceiling.**
Concurrency is not a policy. `workers / sleep_seconds` is. The code states the arithmetic and the
ceiling it is measured against, with the ceiling's source:

```python
# SEC EDGAR publishes a ceiling of 10 requests/second and requires a declared User-Agent
# (https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data, read 2026-09-08).
WORKERS = 8
SLEEP_SECONDS = 1.0
EFFECTIVE_RPS = WORKERS / SLEEP_SECONDS   # 8.0 req/s — 80% of the documented 10 req/s ceiling
assert EFFECTIVE_RPS <= 10.0, f"{EFFECTIVE_RPS} req/s exceeds the documented SEC ceiling"
```

A bare `ThreadPoolExecutor(max_workers=8)` with no `EFFECTIVE_RPS` beside it is the violation,
and so is `EFFECTIVE_RPS` with no ceiling to compare it to. If the target publishes no ceiling, the
code says **that** — `# no documented ceiling found at <url>, read <date>; holding at 1 req/s` — and
holds low. "Not documented" is not "unlimited".

**2. Quota or rate limit — the code names which, because concurrency helps one and hurts the other.**

| | what it caps | what concurrency does |
|---|---|---|
| **Rate limit** | requests per unit time | raising workers hits the cap *sooner per second*; the total budget is untouched, so throttled requests are usually retryable and the job still finishes |
| **Quota** | total requests per IP/key per period | raising workers does **not** reduce total requests — it only **reaches exhaustion sooner**, and every worker keeps spending against the same finite pool |

Under a quota, parallelising is a throughput change that buys nothing on the binding constraint and
brings the wall forward. Under a rate limit, parallelising up to the ceiling is exactly right. A
client that has not written down which one it faces has not decided; it has guessed, and the two
guesses have opposite corrections. Name it in a comment next to the worker count, with the evidence:

```python
# IAPD enforces a per-IP QUOTA, not a rate limit: total fetches per IP per window are capped, so
# more workers exhausts the same budget faster and does not increase what the run can retrieve.
```

Where the fact is already recorded elsewhere in the module — a docstring, a vendor note — the
constraint is still violated if it is not connected to the worker count. A load-bearing fact sitting
three hundred lines from the decision it should govern is a fact nobody applied.

**3. A declared fallback transport is unverified until it has executed.**
A proxy, a mirror, a paid unblocker, a secondary API — if the manifest, log or run record shows
**zero** uses across the corpus, that path is untested code, and neither the code nor the docs may
describe it as required, as the answer to the quota, or as the reason a limit is survivable.

The check is a count, not a reading:

```bash
# the manifest records a transport per row; count them
xan frequency -s transport data/output/manifest.csv
# direct,1538
# proxy,0      <- the documented fallback has never once run
```

Zero uses forces one of exactly three edits, and the choice is stated in the code or the run notes:

1. **Exercise it** — force the fallback on a 5–10 row test (E7 inherits the repo's test-before-scaling
   rule), record the result, and keep the dependency.
2. **Downgrade the claim** — mark it `UNVERIFIED — 0 executions as of <date>` wherever it is
   described, and stop treating it as the mitigation for anything.
3. **Delete it** — remove the dependency, its credentials and its documentation together.

What is not permitted is leaving a never-run path documented as required. It makes an untested
branch look like a safety margin, so the run proceeds at a pressure the fallback was supposed to
justify, and discovers on the day it is needed that nobody has ever seen it work.

## The check

Decidable from the code and one count, in this order:

1. **Grep for the concurrency primitive** — `ThreadPoolExecutor`, `ProcessPoolExecutor`, `asyncio.gather`,
   `Semaphore`, `CONCURRENT_REQUESTS`, `n_conn`. For each one whose tasks make an outbound request:
   is there a computed effective rate within the same file, and a documented ceiling with a source?
   No → violation.
2. **Read the comment at the worker count** — does it say `quota` or `rate limit`, with the basis?
   Neither word present → violation.
3. **Count fallback executions** — if a fallback transport is named anywhere in the module or its
   docs, the run record must show a nonzero count for it, or the description must carry
   `UNVERIFIED`. Zero uses plus prose calling it required → violation.
