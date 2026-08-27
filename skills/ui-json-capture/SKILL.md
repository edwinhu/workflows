---
name: ui-json-capture
description: "Use when the user asks to 'scrape Lex Machina', 'capture Bloomberg Law results', 'get all the search results', 'export more than the row cap', 'the export only gives me 1,000', 'pull the whole docket', 'grab every page of results', 'capture the JSON behind this page', 'page through this site and save the data', or wants the full result set out of an authenticated research UI (Lex Machina, Bloomberg Law, Westlaw, Docket Alarm, UniCourt) whose export is capped or absent. Also use when a site's results are clearly JSON-backed but there is no documented API."
---

# Capturing paginated JSON from an authenticated research UI

Drive the user's logged-in browser over CDP, hook `XMLHttpRequest`, click through the result
pages, and keep the JSON the page already received. No direct API calls, no credential handling,
no fighting the export cap.

## Decide the access route BEFORE touching anything

<EXTREMELY-IMPORTANT>
## The Iron Law of Terms of Service

**Systematic capture of a paid research corpus is the user's decision to make knowingly, not
yours to slide into. Surface the trade-off once, in plain terms, then do what they decide.**

LexisNexis, Bloomberg and Thomson Reuters terms prohibit systematic downloading; the export row
cap is that prohibition's enforcement mechanism, and paging the XHR endpoint routes around it.
The exposure — account termination, an institutional licence, a research programme — lands on the
user, not on you.

Say it once and move on. Repeating it after they decide is not caution, it is nagging, and it
wastes the turn they already spent answering.

Two routes make the question moot and are worth naming in the same breath, because they are
often available and nobody thinks of them: these vendors sell **API access as a contract line**,
and they grant **academic bulk agreements**. Either produces a citable, reproducible dataset. A
scrape does not.
</EXTREMELY-IMPORTANT>

## Check whether you need to page at all

**A single response usually carries the facet counts.** Before capturing 667 pages to count
things, read the facets in page one. The Lex Machina response that answered "how many derivative
suits are there" carried `de-dcc-case_tag` (12 terms), `de-dcc-case_type` (15 terms) and a
`filed_on` year histogram — every count the question needed, from one ordinary page load.

**Then check whether a filtered slice fits under the export cap.** Lex Machina caps exports at
1,000 rows, but annual filings ran 932–1,510, so year-by-year exports were under the cap for
every year but one. Fourteen sanctioned exports beat one unsanctioned scrape.

Page only when you need per-record fields across a population that will not slice under the cap.

## Procedure

Load the `browser-automation` skill first — it owns port/prefix selection. Use the **interactive**
browser (9222 / `mcp__chrome-devtools__*` on Linux), because the session must be logged in.

1. **Find the JSON.** With the results page open, `list_network_requests` filtered to
   `xhr`/`fetch`, then `get_network_request` on the one whose response is `application/json`.
   Often it is the *same URL as the page*, differing only by an `X-Requested-With:
   XMLHttpRequest` request header. Save the body with `responseFilePath` and read its shape —
   you need the **array field**, the **offset field**, the **total**, and the **page size**.
2. **Install the hook** — `scripts/01-install-hook.js`, after editing the three site-specific
   lines it flags (URL test, array field, offset field).
3. **Smoke-test 4 pages** before committing to the run. Confirm offsets advance and `errors` is
   empty.
4. **Start the pager** — `scripts/02-run-pager.js`. It returns immediately by design.
5. **Poll and drain** — `scripts/03-status.js` to check, `scripts/04-dump.js` to write a batch,
   passing `filePath`. Drain every few hundred pages.
6. **Stop** — `scripts/05-stop.js`, or let it end on the disabled Next button.
7. **Assemble and prove it** — `scripts/assemble.py`. Its non-zero exit is the gate.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/assemble.py" \
  --batches scratch/capture --glob 'batch_*.json' --out data/raw/cases.jsonl \
  --expect-total 16670 --page-size 25 --id-field id --first-page scratch/page0.json
```

## Capture Facts

- **`evaluate_script` dies at the CDP `protocolTimeout` (~120 s) but the in-page loop keeps
  running.** A 50-page awaited batch returned `Runtime.callFunctionOn timed out` while the page
  went on to capture 20 more. Awaiting a long loop therefore reports failure for work that
  succeeded — you lose the return value, not the data. Detach and poll; that is why
  `02-run-pager.js` returns immediately.
- **Route the payload to disk with `filePath`, never through the return value.** 16,670 records
  was 258 MB. Returning that inline would blow the context window for zero benefit — the model
  never needs to see the rows, only the integrity counts.
- **`filePath` is restricted to configured workspace roots.** A path under a symlinked data
  directory resolving outside them fails with `Access denied … not within any of the configured
  workspace roots`. Write into the repo (e.g. `scratch/`), then move it.
- **Page 1 is missed if the hook is installed after the page loaded.** The hook only sees
  requests made after it is installed. Recover it from the `responseFilePath` you already saved
  in step 1 and splice it with `--first-page`; do not re-run the whole capture for one page.
- **Scrolling and other UI events fire the same endpoint**, so extra pages arrive unbidden — 6
  captured against 2 clicks in one measured stretch. The dedupe key makes this harmless. Absent
  it you would silently double-count records.
- **A saved "default column view" silently overrides `cols=` URL parameters.** Two navigations in
  a row came back with the columns stripped and the old view restored. Set columns through the
  UI control, then read the URL the app rewrote — that is the authoritative parameter list.
- **Drawer and checkbox UIs need a real click and two round-trips.** `getElementById` fails on
  ids containing spaces, and the panel's contents do not exist in the DOM until after the click
  renders. Click, return, then read in a second call.
- **Human-ish pacing is a dial, not a switch.** The first run averaged 9 pages/min; raising the
  long-pause rate dropped it to 5 and the ETA to 81 minutes. Halving the pause rate and trimming
  the scroll count restored ~2× with jitter intact. The protective property is that pauses and
  jitter *exist*, not their exact frequency.

## Red Flags — STOP if you catch yourself

| About to | Why wrong | Do instead |
|---|---|---|
| `fetch()` or `curl` the endpoint directly | That is an API call, not UI use — a different act under the ToS, and it usually needs the session cookie you should not be handling | Click the UI and keep what the page receives |
| Page the whole corpus to answer a counting question | The facets in page one already carry the counts | Read the facets first |
| Await a long paging loop inside `evaluate_script` | CDP kills the call at ~120 s and reports failure for work that succeeded | Detach, poll with `03-status.js` |
| Return captured rows as the tool result | 258 MB through the context for data the model never reads | `filePath` on `04-dump.js` |
| Trust `total_results` because the run "finished" | A stalled Next button also finishes | `assemble.py` — unique offsets, no gaps, unique ids, count matches |
| Report the capture complete without running `assemble.py` | An unverified completeness claim presented as fact is dishonest, and the next row silently inherits a truncated dataset | Run it; its exit code is the claim |
| Navigate or reload the tab mid-capture | In-memory pages not yet dumped are lost | Drain first with `04-dump.js` |
| Re-run the whole capture because page 1 is missing | Wasteful and re-exposes the account | Splice it with `--first-page` |

## Generalising to another site

Only four things are site-specific, all flagged inline in the scripts: the **URL test** for the
results endpoint, the **array field**, the **offset field**, and the **Next-button selector**.
Everything else — dedupe, detached loop, pacing, draining, integrity proof — transfers unchanged.

Sites differing structurally:

- **Cursor pagination instead of numeric offsets** (`next_token`): the dedupe key must be the
  cursor or a record-id hash, and `assemble.py`'s gap check does not apply — pass `--page-size 0`
  semantics by verifying ids only, and say in the report that offset-continuity was unavailable.
- **Infinite scroll instead of a Next button**: replace `nextBtn()` with a scroll-to-bottom and
  wait for the offset to advance.
- **GraphQL POST endpoints**: hook the same way, but key on the POST body's variables — the URL
  is constant across pages and a URL-based dedupe key will collapse every page into one.

## Related

- `browser-automation` — port/prefix selection and CDP mechanics. Load it first.
- The Delaware Chancery capture this generalises from: 16,670 cases, 667 pages, 0 duplicates,
  0 gaps, ids matching the vendor's own reported total exactly.
