# Driving Workspace Web over CDP

`https://workspace.refinitiv.com/web` in a CDP-controlled Chromium, for everything the
`lseg.data` Python library cannot reach. Verified on Linux 2026-07-27.

The desktop Workspace app is Windows/macOS only. On Linux the web client is the only
Workspace surface, so the *app*-based routes in older docs (launching the Electron binary
with `--remote-debugging-port`) do not apply. The web client is a normal Chromium page and
everything below works against it.

## Session Setup

The whole approach rests on one thing: **a logged-in Workspace Web tab in a browser with
CDP exposed.** Everything else borrows that tab's credentials.

```bash
# Chromium must already be running with remote debugging (the browser-automation
# skill's standard setup on Linux uses port 9222).
curl -s http://localhost:9222/json/version | jq -r .Browser
```

Then open `https://workspace.refinitiv.com/web` and sign in (SSO) **by hand, once**. The
session persists across restarts via cookies. Verify:

```bash
python3 scripts/workspace_cdp.py token   # prints token + seconds remaining
```

If that errors with "No open tab matching", open the tab. If it errors with "No edp-token",
the session is signed out — reload and sign in.

## Three Access Paths

Pick the lowest-numbered one that can serve the request.

| # | Path | Use for | Auth |
|---|------|---------|------|
| 1 | `lseg.data` Python lib | anything it covers; batch/production work | RDP machine credentials |
| 2 | Token-lift → RDP REST | same data, no machine credentials needed | Workspace tab's `edp-token` |
| 3 | In-page `fetch()` on the target origin | Workspace-internal endpoints only | browser cookies |

Path 1 is unchanged and still preferred when you have machine credentials and the data is
in the public API — see the other reference files. Paths 2 and 3 are what this file adds.

### Path 2 — Lift the token, call the public API

Workspace stores a short-lived RDP access token in `localStorage` under `edp-token`. It
authenticates `https://api.refinitiv.com` directly, so you get `ld.get_data()` behaviour
from plain Python with no machine credentials at all.

```python
import sys; sys.path.insert(0, "scripts")
import workspace_cdp as w

df = w.datagrid_df(["AAPL.O", "MSFT.O"], ["TR.CommonName", "TR.Revenue"])
```

**Token lifetime is ~10 minutes** and Workspace rotates it in place. Re-read it rather than
holding one across a long job — `workspace_cdp.token()` re-reads automatically once the
cached copy is within 60s of expiry. A long batch loop that calls `datagrid()` repeatedly
is therefore safe; a script that grabs the token once and runs for an hour is not.

### Path 3 — In-page fetch on the target origin

Some Workspace endpoints are not exposed on `api.refinitiv.com` at all. They authenticate
by cookie, so the call must originate from a page on **their own** origin.

**A cross-origin `fetch()` from the Workspace tab is CORS-blocked** — this fails:

```javascript
// in the workspace.refinitiv.com tab → "Failed to fetch"
fetch("https://amers1-apps.platform.refinitiv.com/datacloud-nonviews/...", {...})
```

`workspace_cdp.in_page_fetch()` handles this by opening a tab **on the target origin** and
running the fetch there, where it is same-origin and the cookies apply.

```python
r = w.in_page_fetch("https://amers1-apps.platform.refinitiv.com/datacloud-nonviews/"
                    "snapshot/rest/async?timeout=1", method="POST", body=[...])
```

## Endpoint Matrix

Probed with a lifted Workspace token on 2026-07-27. Entitlements are per-account: the
token's scopes are encrypted in the JWT, so there is **no way to enumerate them** — probe
and read the error.

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /data/datagrid/beta1/` | works | the `get_data()` equivalent; TR.* fields, SCREEN universes, `parameters` |
| `GET /data/historical-pricing/v1/views/interday-summaries/{ric}` | works | returns `qos.timeliness: "delayed"` |
| `GET /data/historical-pricing/v1/views/events/{ric}` | works | tick/event history |
| `POST /discovery/symbology/v1/lookup` | partial | LEI resolves; **CUSIP/ISIN return an `errors` entry**, not a hard failure — "User is not entitled" |
| `POST /discovery/search/v1/` | works | instrument/entity search |
| `GET /data/news/v1/headlines` | **403** | `insufficient_scope`, missing `trapi.data.news.read` — not in the Workspace token |
| `POST .../datacloud-nonviews/snapshot/rest/async` | works via Path 3 | SDC deal universes; CORS-blocked from the Workspace tab |
| `/data/datagrid/v1/` | 404 | only `beta1` exists |

### datagrid works with everything the SDC references document

Verified against a live token — SDC deal fields resolve per-instrument, and `parameters`
drives the fiscal-period logic:

```python
w.datagrid(["AAPL.O"], ["TR.MnAAcquiror", "TR.MnADealValue", "TR.MnAAnnDate"],
           {"SDate": "2020-01-01", "EDate": "2024-12-31"})     # 218 deal rows
w.datagrid(["AAPL.O"], ["TR.PPPillAdoptionDate", "TR.PPIssuerName"])   # poison pills
w.datagrid(["AAPL.O"], ["TR.Revenue", "TR.Revenue.fperiod"],
           {"SDate": "0", "EDate": "-4", "Frq": "FY"})          # FY2025..FY2021
w.datagrid(['SCREEN(U(IN(Equity(active,public,primary))),IN(TR.HQCountryCode,"US"),CURN=USD)'],
           ["TR.CommonName"])                                   # 12,710 US equities
```

### Deal-level SCREEN needs Path 3, in two steps

`SCREEN(U(IN(DEALS)) ...)` — a universe of *deals* rather than companies — is rejected by
the public datagrid with `error 218: "The formula must contain at least one field or
function."` It works against Workspace's internal datacloud endpoint, but that endpoint
returns **deal IDs only**, so getting field values takes two steps.

Naming the TR.* fields in `output` does *not* work — the endpoint faults with
`Output parameter 'TR.MnAAcquiror' is unrecognized`, both with and without `sorta,`
prefixes. `output` stays `col,in,t`; the formula still drives which deals match.

```python
# 1. SCREEN -> deal IDs
ids = w.sdc_deal_ids(
    formula="TR.MnAAcquiror",
    screen='U(IN(DEALS)) AND IN(TR.MnAAcquirorNation,"US") '
           'AND BETWEEN(TR.MnAAnnDate,20240101,20240107),CURN=USD')
# -> 286 deal IDs

# 2. deal IDs -> field values, back through the public datagrid as <id>@DEALID
d = w.deal_data(ids, ["TR.MnAAcquiror", "TR.MnATarget",
                      "TR.MnADealValue", "TR.MnAStatus"])
# headers: ['Instrument','Acquiror Full Name','Target Full Name','Deal Value','Deal Status']
# ['154088327276', 'MIWD Holding Co LLC', 'PGT Innovations Inc', 2450384000, 'Completed']
```

The raw `sdc_screen()` response is Workspace's internal shape, not the datagrid shape:
`{"status":"Ok","asyncResp":[{"select":{"rows":N,"cols":M,"rows":[[...]]}}]}`, where the
first row is a header descriptor and the rest are values. `screenCount` reports the
universe size at each filter stage. A bad request comes back as `asyncResp[0].fault` with
HTTP **200** — `sdc_deal_ids()` raises on that rather than returning an empty list.

### Verify field names — the failure is silent

A TR.* field that does not exist is **dropped from the response entirely**: the column
simply is not in `headers`, and `data` rows come back shorter than the field list you
asked for. Nothing errors. Queried *alone*, an invalid field returns `error 218`, which is
the cheapest way to check one.

Verified on a DEALID universe 2026-07-27 — several field names in `mna.md` are wrong:

| Documented | Reality |
|-----------|---------|
| `TR.MnAAcquirorName` | **invalid** → use `TR.MnAAcquiror` ("Acquiror Full Name") |
| `TR.MnATargetName` | **invalid** → use `TR.MnATarget` ("Target Full Name") |
| `TR.MnAAcquirorTicker`, `TR.MnAAcquirorCusip`, `TR.MnATargetTicker` | invalid, correct names not established |
| `TR.MnAEnterpriseValue`, `TR.MnAPricePerShare`, `TR.MnAPremium1Day/1Week/4Weeks`, `TR.MnAAcquirorMarketCap` | invalid, correct names not established |
| `TR.MnAAcquirorNation`, `TR.MnAAcquirorSIC`, `TR.MnAAcquirorPublicStatus`, `TR.MnATargetNation`, `TR.MnATargetPublicStatus`, `TR.MnAStatus`, `TR.MnADealValue`, `TR.MnAAnnDate` | valid |

For an authoritative list, dump the field definitions from IndexedDB rather than guessing
— see `api-discovery.md`.

### Rate limits

Probing fields one at a time hits `429 gw.userLimit` ("too many requests for
/data/datagrid/beta1/") after a few dozen rapid calls. Batch fields into one request, and
when you must isolate a field, pace the calls.

## Field Discovery

Unchanged in substance from `api-discovery.md`, but run it against the **web client** now,
not the Electron app. Open the SDC Platinum app inside Workspace Web, then either:

- read the cached field definitions out of IndexedDB (`SDCPlatinum` → `APIResponse`), or
- watch network traffic while the column picker loads.

Both are browser-side operations, so they work identically in the web client. See
`api-discovery.md` for the extraction JavaScript and the dataset→prefix table.

## Codebook

LSEG Codebook is a hosted JupyterHub at `https://workspace.refinitiv.com/codebook/`,
authenticated by the same Workspace cookies. See `codebook.md` — its REST surface is
reachable but kernel execution has a hard constraint worth knowing before you plan around
it.

## Gotchas

- **Token expiry mid-batch.** ~10 minute lifetime. Re-read per request batch; never cache
  across a long run.
- **The token is account-scoped, not universal.** News is 403 and CUSIP/ISIN are not
  entitled on this account. Other accounts will differ — probe, don't assume.
- **`errors` in a 200 response.** Symbology returns HTTP 200 with a per-identifier
  `errors` array when unentitled. A 200 is not evidence the mapping succeeded.
- **datagrid nulls are silent.** `TR.SACT*` on an unaffected company returns
  `"code": -2, "description": "empty"` with `null` data — indistinguishable from a typo'd
  field name unless you read `messages.codes`.
- **CORS.** Never hand-roll a cross-origin fetch from the Workspace tab; use
  `in_page_fetch()`.
- **Don't hijack the user's Workspace tab.** Navigating it away loses their layout.
  `in_page_fetch()` opens its own tabs; leave the main tab alone.
