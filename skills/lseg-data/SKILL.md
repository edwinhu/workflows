---
name: lseg-data
version: 2.0
description: 'Use when "query LSEG/Refinitiv", "fundamentals or market data from LSEG", "ESG scores", "management guidance / guidance reports / GR", "RIC/ISIN symbology", "corporate governance or activism (poison pills, campaigns)", "M&A or IPO deals", "syndicated loans or project finance", "PE/VC investments", "joint ventures", "municipal bonds", "Lipper fund details", "stock screening (fscreen)", "Refinitiv news", "Workspace web client", "Codebook", or any use of the `lseg.data` Python API. (academic loan/PE data: prefer the wrds skill.)'
user-invocable: false
---

**What this skill carries.** The names and headings are the index; for a subject none of
them carries, `grep -il <term> ${CLAUDE_SKILL_DIR}/references/*.md`.

!`skill-toc ${CLAUDE_SKILL_DIR}`

## Contents

- [Access Paths](#access-paths)
- [MCP Connector](#mcp-connector--installed-entitled-to-nothing)
- [Query Enforcement](#query-enforcement)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Core APIs](#core-apis)
- [Key Field Prefixes](#key-field-prefixes)
- [RIC Symbology](#ric-symbology)
- [Rate Limits](#rate-limits)
- [Additional Resources](#additional-resources)

# LSEG Data Library

Access financial data from LSEG (London Stock Exchange Group), formerly Refinitiv, via the `lseg.data` Python library **or** by driving the Workspace web client over CDP.

## Access Paths

Pick the lowest-numbered path that can serve the request.

| # | Path | Use for | Auth | Reference |
|---|------|---------|------|-----------|
| 1 | `lseg.data` Python library | anything it covers; batch and production work | RDP machine credentials | this file + `references/*` |
| 2 | Token-lift → RDP REST from Python | the same data with **no machine credentials** — borrows the browser session | Workspace tab's `edp-token` | `references/workspace-web-cdp.md` |
| 3 | In-page `fetch()` on the target origin | Workspace-internal endpoints only (SDC deal universes, FSCREEN) | browser cookies | `references/workspace-web-cdp.md` |
| 4 | LSEG MCP connector (`mcp__claude_ai_LSEG__*`) | **nothing on this account** — every scope family is denied | LSEG-side SSO | this file, MCP Connector below |

Path 1 remains preferred where it works — `pip install lseg-data` is available on every platform. Paths 2 and 3 exist because **some data is only reachable through the web client**, and because the token-lift avoids needing machine credentials at all.

**The desktop Workspace app is Windows/macOS only.** On Linux there is no desktop session and no Electron binary to launch with `--remote-debugging-port`; the web client at `https://workspace.refinitiv.com/web` is the only Workspace surface. Never emit a `session.desktop.workspace` config or an app path on Linux.

The helper for paths 2 and 3 is `scripts/workspace_cdp.py`:

```bash
python3 scripts/workspace_cdp.py token       # verify the browser session
python3 scripts/workspace_cdp.py datagrid --universe AAPL.O,MSFT.O \
        --fields TR.CommonName,TR.Revenue
```

```python
import sys; sys.path.insert(0, "scripts")
import workspace_cdp as w
df = w.datagrid_df(["AAPL.O"], ["TR.Revenue", "TR.Revenue.fperiod"],
                   {"SDate": "0", "EDate": "-4", "Frq": "FY"})
```

Requires Chromium on CDP port 9222 with a signed-in Workspace Web tab — see the `browser-automation` skill for the browser, and `references/workspace-web-cdp.md` for session setup.

## MCP Connector — installed, entitled to nothing

The LSEG connector for Claude registers ~50 `mcp__claude_ai_LSEG__*` tools. **On this account
every one of them is refused.** Measured 2026-09-09, seven tools across seven distinct scope
families, each a first call with valid arguments:

| Tool | Denied scope |
|---|---|
| `entity_search` (`action='schema'`) | `search (API_ACCESS_CONTROL/MCP_DATA_ON)` |
| `historical_pricing_summaries` | `ttsc_historical_pricing_summaries (API_ACCESS_CONTROL/MCP_DATA_ON)` |
| `qa_company_fundamentals` | `qa (API_ACCESS_CONTROL/MCP_DATA_QA_ON)` |
| `news_nl_search` | `news_ai (API_ACCESS_CONTROL/MCP_DATA_MRN_ON)` |
| `transcripts` | `transcripts (API_ACCESS_CONTROL/MCP_DATA_TRANSCRIPTS_ON)` |
| `fx_spot_price` | `fx_spot (LFA_API/EP_FXSPOTS)` |
| `ixm_list_indexes` | `ixm (FTSER_MCP/FTSER_MCP)` |

- **The connector's presence in the toolset is not access.** Denial arrives as a formatted
  `🔒 Entitlement Error`, not an exception — cheap to probe, and it names the exact flag. Unlike
  the datagrid failures above, this one is loud and honest.
- **Do not route an LSEG request here.** Paths 1-3 are the working surfaces; a connector call
  spends a round trip to learn nothing. Re-probe only after the user says entitlements changed.
- **The denials are per-family toggles, and the flag names are the ask.** `MCP_DATA_ON`,
  `MCP_DATA_QA_ON`, `MCP_DATA_MRN_ON`, `MCP_DATA_TRANSCRIPTS_ON` are separate switches on the
  LSEG account. Enabling them is an account-side request to the LSEG rep, quoting the flag —
  nothing in this repo can unblock it.
- **`MCP_DATA_MRN_ON` is the one worth asking for.** News is `403 insufficient_scope` on the
  platform session and unentitled on the lifted `edp-token` too, so it is the one content set
  with no working path at all; the connector would be a new capability rather than a duplicate.
  Everything else it offers — fundamentals, IBES, pricing, symbology — path 1 already serves.

## Query Enforcement

### IRON LAW: NO DATA CLAIM WITHOUT SAMPLE INSPECTION

Before claiming ANY LSEG query succeeded, follow these steps:
1. **VALIDATE** field names exist (check prefixes: TR., CF_)
2. **VALIDATE** RIC symbology is correct (.O, .N, .L, .T)
3. **EXECUTE** the query
4. **INSPECT** sample rows with `.head()` or `.sample()`
5. **VERIFY** critical columns are not NULL
6. **VERIFY** date range matches expectations
7. **CLAIM** success only after all checks pass

This is not negotiable. Skipping result inspection is NOT HELPFUL — the user builds analysis on data with undetected quality problems.

### LSEG API Facts

- The API does not raise errors for invalid field names or wrong RICs — it returns empty results or NULL columns. Treating returned rows as correct data is an unverified claim presented as fact: inspect for NULLs, wrong dates, and invalid values before returning anything.
- Field-name typos are common and fail silently (TR.EPS vs TR.Eps). Validate field names against the documentation before executing.
- User-supplied RICs often carry the wrong exchange suffix. Verify against the RIC Symbology section (`.O`, `.N`, `.L`, `.T`) before querying.
- Market data has T-1 availability — today's data arrives tomorrow. Querying through today produces silent gaps; see the Date Awareness section.
- **ONE invalid field name in a list silently truncates the WHOLE result.** `TR.HoldingsValueHeld` does not exist: alone it raises `Unable to resolve all requested fields`. Mixed with four valid fields it raises nothing — it is dropped from the columns AND the result collapses from **8,298 holder rows to 1** (AAPL.O; 16 -> 1 on SWDR.PK). The dataframe has exactly the columns you asked for, no warning, and a fraction of a percent of the rows. Validate each field name alone before batching, and assert an expected row count. Measured 2026-09-05.
- **The default `http.request-timeout` is 20 seconds**, and on text-heavy content it — not a row cap or an entitlement — is what raises `ReadTimeout`. Five instruments of guidance failed at the default and returned 66,447 rows at `ld.get_config().set_param("http.request-timeout", 180)`, which must be called BEFORE the session opens. Reaching for a smaller batch first wastes the run.
- **A 403 enumerates the platform token's entitlements.** `Insufficient scope` names the required scope, the **full `Available scopes` set**, and the missing one — so probing one unentitled endpoint (e.g. `/data/news/v1/headlines`) reveals what the account actually holds. The browser-token caveat below, that entitlements cannot be enumerated, applies to the lifted `edp-token`, not to this path.
- Rate limits bind per session (500 requests/minute) and per request (`get_data()` 10,000 data points, `get_history()` 3,000 rows) — many small queries still hit the session cap. Batch instead of looping.

### Workspace Web / CDP Facts

- The lifted `edp-token` lives **~10 minutes**. A script that reads it once and runs for an hour dies mid-batch with a 401. `workspace_cdp.token()` re-reads within 60s of expiry — use it per request rather than caching the string.
- **Entitlements are per-account and cannot be enumerated** — the token's scopes are encrypted inside the JWT. On the verified account, news is `403 insufficient_scope` and CUSIP/ISIN symbology is unentitled. Probe the endpoint and read the error; never assume a dataset is available because it exists in the docs.
- **A 200 is not proof of success.** Symbology returns HTTP 200 with a per-identifier `errors` array when unentitled, and datagrid returns `null` data with `messages.codes` of `-2 ("empty")` for fields that do not apply. Read `errors` and `messages.codes`, not just the status line.
- Cross-origin `fetch()` from the Workspace tab is **CORS-blocked** and fails as a bare "Failed to fetch" that looks like a network outage. Workspace-internal endpoints must be called from a tab on their own origin — that is what `in_page_fetch()` does.
- Deal-level `SCREEN(U(IN(DEALS)) ...)` universes are **rejected by the public datagrid** (`error 218`) and only work through the internal datacloud endpoint via path 3.
- **Codebook could not execute code** on the one account/machine tested — the kernel WebSocket is killed before it reaches JupyterHub (no handshake response; a bogus kernel ID fails identically to a valid one), including through Codebook's own JupyterLab UI. Do not debug headers or subprotocols; the two things actually worth trying are a full session reset (clear site data + re-login) and a supported browser. Its contents/kernels REST API does work. See `references/codebook.md`.

### Red Flags — STOP If About To:

- Execute a query without validating field names and RIC suffixes first → STOP. The API will not error for you.
- Return a dataframe without `.head()` or `.sample()` inspection → STOP. Handing over uninspected data gives the user undetected quality problems — unhelpful on its own terms.
- Write a `session.desktop.workspace` config, or reference `/Applications/Refinitiv Workspace.app`, on Linux → STOP. There is no desktop session on this platform; the config will fail at connect time.
- Reach for an `mcp__claude_ai_LSEG__*` tool → STOP. Every scope family is denied on this account; use path 1, 2 or 3.
- Navigate or reload the user's signed-in Workspace tab → STOP. It destroys their layout and can drop the session that every CDP path depends on. Open your own tab instead.

### Data Validation Checklist

Before EVERY data retrieval claim, verify the following:

**For `ld.get_data()` (fundamentals/ESG):**
- [ ] Field names use correct prefix (TR. for Refinitiv)
- [ ] RIC symbology verified (correct exchange suffix)
- [ ] Result inspection: `.head()` or `.sample()` executed
- [ ] NULL check on critical fields (e.g., revenue, EPS)
- [ ] Row count verification (is result size reasonable?)
- [ ] Date context verified (fiscal periods, as-of dates)

**For `ld.get_history()` (time series):**
- [ ] Field names are valid (OPEN, HIGH, LOW, CLOSE, VOLUME, or CF_ prefixes)
- [ ] Start/end dates specified explicitly
- [ ] Date range adjusted for T-1 availability (market data lag)
- [ ] Result inspection: check first and last rows
- [ ] NULL check on OHLCV fields
- [ ] Date continuity check (gaps in trading days expected, but not in date sequence)

**For `symbol_conversion.Definition()` (mapping):**
- [ ] Input identifier type specified correctly
- [ ] Result inspection: verify mapped values exist
- [ ] NULL check (some securities may not have all identifiers)

**For ALL queries:**
- [ ] Rate limits considered (batch if >10k data points)
- [ ] Session management: `open_session()` at start, `close_session()` at end
- [ ] Error handling: try/except for network failures
- [ ] Sample inspection BEFORE claiming data is ready

## Quick Start

To get started with LSEG Data Library, initialize a session and execute queries:

```python
import lseg.data as ld

# Initialize session
ld.open_session()

# Get fundamentals
df = ld.get_data(
    universe=[‘AAPL.O’, ‘MSFT.O’],
    fields=[‘TR.CompanyName’, ‘TR.Revenue’, ‘TR.EPS’]
)
print(df.head())  # Inspect sample data

# Get historical prices
prices = ld.get_history(
    universe=’AAPL.O’,
    fields=[‘OPEN’, ‘HIGH’, ‘LOW’, ‘CLOSE’, ‘VOLUME’],
    start=‘2023-01-01’,
    end=‘2023-12-31’
)
print(prices.head())  # Inspect sample data

# Close session
ld.close_session()
```

## Authentication

Four options. The first two are for the `lseg.data` library; the last two need no credentials of your own.

**Platform session (works on every OS)** — config file or environment variables, below. This is the only `lseg.data` session type available on Linux.

**Desktop session** — requires the Refinitiv Workspace desktop app running locally. Windows/macOS only; not an option on Linux.

**Borrowed browser session** — no credentials at all: `scripts/workspace_cdp.py` lifts the access token out of a signed-in Workspace Web tab. Use this when machine credentials are unavailable or expired. See `references/workspace-web-cdp.md`.

**Codebook (hosted)** — LSEG's own JupyterHub inside Workspace Web. Its kernels
open a pre-authenticated `DesktopSession` named `codebook` on LSEG's servers, so
it needs no local credentials and no local Workspace app, and it does not consume
the one-session platform quota below. Same entitlements as the platform session,
not broader. See `references/codebook.md`.

The rest of this section is about getting a **platform session** working, which is
where all the sharp edges are.

### On this setup: use the agenix secret

Credentials live in agenix as `lseg-credentials`, decrypted to
`$LSEG_CREDENTIALS_FILE` (mode 400). It is a shell-sourceable file, so **source
it, do not `cat` it into a variable**:

```bash
set -a; . "$LSEG_CREDENTIALS_FILE"; set +a   # exports LSEG_APP_KEY / LSEG_USERNAME / LSEG_PASSWORD
```

**THE VARIABLE NAMES DO NOT MATCH THE LIBRARY'S.** The secret exports `LSEG_*`;
everything below documents `RDP_*`. You must map them at the call site. Reading
this section and exporting `RDP_APP_KEY` from a file that defines `LSEG_APP_KEY`
gets you an empty environment and a session that fails on first query.

Before 2026-07-27 these existed only as plaintext in `mbp:~/projects/svb/.envrc`,
so anything running on another machine had no credentials at all. If a lookup
comes back empty, check that host's rebuild is current before concluding the
account is unentitled.

### `platform.Password` DOES NOT EXIST

The config-file example below hides the programmatic form, and the obvious guess
is wrong. In `lseg-data` 2.1.1 the class is **`GrantPassword`**:

```python
import lseg.data as ld
from lseg.data.session import platform

s = platform.Definition(
        app_key=os.environ["LSEG_APP_KEY"],
        grant=platform.GrantPassword(username=os.environ["LSEG_USERNAME"],
                                     password=os.environ["LSEG_PASSWORD"]),
    ).get_session()
s.open()
ld.session.set_default(s)
```

`platform` exports exactly three names — `ClientCredentials`, `Definition`,
`GrantPassword`. Check `dir()` before trusting a class name from the docs.

### ONE concurrent platform session — pass `signon_control=True`

The machine ID allows a single concurrent platform session, and the library
default is `signon_control=False`, which does not queue — it fails:

```
LDError: You authorised with signon_control=False. Session quota is reached.
If you want to open session close the previous opened.
```

Any earlier session that was not closed cleanly (a crashed script, another shell,
a background job) holds the quota until it times out. Pass `signon_control=True`
to take the signon over instead:

```python
s = platform.Definition(
        app_key=os.environ["LSEG_APP_KEY"],
        grant=platform.GrantPassword(username=os.environ["LSEG_USERNAME"],
                                     password=os.environ["LSEG_PASSWORD"]),
        signon_control=True,          # <- take over rather than fail
    ).get_session()
s.open()
if str(s.open_state) != "OpenState.Opened":     # open() does not raise; see above
    raise RuntimeError(f"session failed: {s.open_state}")
ld.session.set_default(s)
```

Corollary: **two local scripts cannot query at once.** If you need a second
concurrent path — an interactive query while a long batch runs — use Codebook,
which authenticates as a separate `DesktopSession` and does not draw on this
quota (see Refinitiv Codebook below).

### `open_session()` DOES NOT RAISE ON FAILURE

With no config and no credentials it falls back to a **desktop** session, tries
`http://localhost:9000/api/handshake` (LSEG Workspace running locally), logs the
connection failure, and **returns normally**. The error only surfaces on the
first query as `ValueError: Session is not opened`.

So `open_session()` returning is NOT evidence of a session. This is the same
silent-failure shape as the Iron Law above, one layer earlier: verify by issuing
a cheap query (`TR.PriceClose` on a liquid RIC) and inspecting the value.

### Config file / environment variables (upstream documentation)

Configure LSEG authentication using either a config file or environment variables.

### Config File Method

Create `lseg-data.config.json`:
```json
{
  “sessions”: {
    “default”: “platform.ldp”,
    “platform”: {
      “ldp”: {
        “app-key”: “YOUR_APP_KEY”,
        “username”: “YOUR_MACHINE_ID”,
        “password”: “YOUR_PASSWORD”
      }
    }
  }
}
```

### Environment Variables Method

Set the following environment variables for LSEG authentication:

```bash
# Configure LSEG credentials via environment variables
export RDP_USERNAME=”YOUR_MACHINE_ID”
export RDP_PASSWORD=”YOUR_PASSWORD”
export RDP_APP_KEY=”YOUR_APP_KEY”
```

## Core APIs

| API | Use Case | Example |
|-----|----------|---------|
| `ld.get_data()` | Point-in-time data | Fundamentals, ESG scores |
| `ld.get_history()` | Time series | Historical prices, OHLCV |
| `ld.news.get_headlines()` | News headlines | Company news, topic filtering |
| `symbol_conversion.Definition()` | ID mapping | RIC ↔ ISIN ↔ CUSIP |

## Key Field Prefixes

| Prefix | Type | Example |
|--------|------|---------|
| `TR.` | Refinitiv fields | `TR.Revenue`, `TR.EPS` |
| `TR.MnA` | Mergers & Acquisitions | `TR.MnAAcquiror`, `TR.MnADealValue` |
| `TR.NI` | Equity/New Issues (IPOs) | `TR.NIIssuer`, `TR.NIOfferPrice` |
| `TR.JV` | Joint Ventures/Alliances | `TR.JVDealName`, `TR.JVStatus` |
| `TR.SACT` | Shareholder Activism | `TR.SACTLeadDissident` |
| `TR.PP` | Poison Pills | `TR.PPPillAdoptionDate` |
| `TR.LN` | Syndicated Loans | `TR.LNTotalFacilityAmount` |
| `TR.PJF` | Infrastructure/Project Finance | `TR.PJFProjectName` |
| `TR.PEInvest` | Private Equity/Venture Capital | `TR.PEInvestRoundDate` |
| `TR.Muni` | Municipal Bonds | `TR.MuniIssuerName` |
| `CF_` | Composite (real-time) | `CF_LAST`, `CF_BID` |

## RIC Symbology

| Suffix | Exchange | Example |
|--------|----------|---------|
| `.O` | NASDAQ | `AAPL.O` |
| `.N` | NYSE | `IBM.N` |
| `.L` | London | `VOD.L` |
| `.T` | Tokyo | `7203.T` |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `get_data()` | 10,000 data points/request |
| `get_history()` | 3,000 rows/request |
| Session | 500 requests/minute |

## Additional Resources

### Reference Files

- **`references/fundamentals.md`** - Financial statement fields, ratios, estimates
- **`references/esg.md`** - ESG scores, pillars, controversies
- **`references/symbology.md`** - RIC/ISIN/CUSIP conversion
- **`references/short-interest.md`** - `TR.ShortInterest`: the only working field, the delisted-instrument coverage cliff, and the gap vs Compustat
- **`references/guidance.md`** - Management guidance (`TR.Guidance*`), the content set behind LSEG Guidance Reports (GR): the ten fields that exist, `SDate`/`EDate` filtering the guided period rather than the announcement date, and datagrid row padding that inflates instance counts ~55%
- **`references/pricing.md`** - Historical prices, real-time data
- **`references/screening.md`** - Stock screening with Screener object
- **`references/fscreen.md`** - Fund screening (ETFs, mutual funds) with FSCREEN app
- **`references/fund-details.md`** - Fund details and characteristics
- **`references/news.md`** - News headlines, pagination, query syntax
- **`references/mna.md`** - Mergers & acquisitions deals (SDC Platinum, 2,683 fields)
- **`references/equity-new-issues.md`** - IPOs, follow-ons, equity offerings (SDC Platinum, 1,708 fields)
- **`references/joint-ventures.md`** - Joint ventures, strategic alliances (SDC Platinum, 301 fields)
- **`references/corporate-governance.md`** - Shareholder activism, poison pills (SDC Platinum)
- **`references/syndicated-loans.md`** - Syndicated loan deals (SDC Platinum)
- **`references/infrastructure.md`** - Infrastructure/project finance deals (SDC Platinum)
- **`references/private-equity.md`** - Private equity/venture capital investments (SDC Platinum)
- **`references/people-and-boards.md`** - Officers/directors: the four `TR.Officer*` fields, no person id and no employment history, private companies reachable by PI, and why board data belongs in CIQ/BoardEx instead
- **`references/municipal-bonds.md`** - Municipal bond issuances (SDC Platinum)
- **`references/workspace-web-cdp.md`** - Driving the Workspace web client over CDP: session setup, token lifting, endpoint matrix, entitlement gotchas
- **`references/codebook.md`** - Codebook (hosted JupyterHub): REST surface, and the kernel-execution blocker
- **`references/api-discovery.md`** - Reverse-engineering APIs via CDP network monitoring
- **`references/troubleshooting.md`** - Common issues and solutions
- **`references/wrds-comparison.md`** - LSEG vs WRDS data mapping
- **`${CLAUDE_SKILL_DIR}/../crsp-lseg-splice/SKILL.md`** - using LSEG to extend a stale CRSP panel to T-1: CUSIP9→RIC linking, measured coverage, and the foreign-venue RIC trap (~4% of US CUSIPs resolve to a EUR-quoted cross-listing with no error)

### Example Files

- **`examples/historical_pricing.ipynb`** - Historical price retrieval
- **`examples/fundamentals_query.py`** - Fundamental data patterns
- **`examples/stock_screener.ipynb`** - Dynamic stock screening

### Scripts

- **`scripts/test_connection.py`** - Validate connectivity. No args tests the `lseg.data` platform session; `--browser` tests the CDP/Workspace-Web path.
- **`scripts/dib_query.py`** - Query the Data Item Browser as a field dictionary: `dib_query.py "segment revenue"` prints real `TR.*` codes. Use it INSTEAD OF guessing field names; needs a signed-in Workspace tab with DIB open at the `/web/` path. See `references/api-discovery.md`
- **`scripts/guidance_pull.py`** - Pull `TR.Guidance*` instances with the timeout, padding drop and batching already handled: `guidance_pull.py AAPL.O --start 2015-01-01 --end 2016-12-31 -o gr.csv`
- **`scripts/workspace_cdp.py`** - Drive Workspace Web over CDP: `token`, `datagrid`, `history`, `symbology`, `search`, `sdc-screen`, `deal-data`, `fetch`. Importable as a module or usable as a CLI.

Deal-level SDC work is two steps — `sdc_deal_ids()` resolves a `SCREEN(U(IN(DEALS)) ...)` universe to deal IDs, then `deal_data()` fetches field values for them as `<id>@DEALID`. See `references/workspace-web-cdp.md`.

### Local Sample Repositories

LSEG API samples at `~/resources/lseg-samples/`:
- `Example.RDPLibrary.Python/` - Core API examples
- `Examples.DataLibrary.Python.AdvancedUsecases/` - Advanced patterns
- `Article.DataLibrary.Python.Screener/` - Stock screening

### Refinitiv Codebook

Hosted JupyterLab with a pre-authenticated, fully entitled `refinitiv.data` session:

- **URL**: `https://workspace.refinitiv.com/codebook/`
- **Environment**: JupyterHub 1.5.0dev, kernels `python3` and `python3_legacy`
- **Session**: auto-authenticated via Workspace cookies (`{name='codebook'}`)

```python
# Inside a Codebook notebook, the session opens with Workspace auth
import refinitiv.data as rd
rd.open_session()                                   # name='codebook'
df = rd.news.get_headlines('R:AAPL.O AND SUGGAC', count=10)
```

**Codebook cannot be driven for computation.** Its contents/kernels/sessions REST API works with the browser's cookies, but the kernel WebSocket is refused server-side (close 1006) — including through Codebook's own JupyterLab UI, where a submitted cell sits at `[*]` forever. Use it as a file exchange (push a notebook, the user runs it, pull back the outputs) and read the user's existing notebooks as worked examples. Full detail and the re-test diagnostic: `references/codebook.md`.

**Note**: Codebook uses `refinitiv.data` (older name) rather than `lseg.data`. Both APIs are equivalent.

**Confirmed working 2026-07-27.** `rd.open_session()` there returns a
**`DesktopSession` named `codebook`** — a different session class from the
`PlatformSession` a local `lseg-data` script opens against the RDP machine ID.
Two practical consequences:

- **It does not consume the one-session platform quota** (see Authentication
  above), so Codebook can be queried while a local batch is running.
- **It is not better entitled.** Same user, different auth path, but identical
  content: spot-checked on short interest, where Codebook returned IBM
  33,088,057 and TXN 2025-03-31 16,647,062 — the same values to the digit as the
  platform session — and returned empty for the same delisted RICs. Do not reach
  for Codebook expecting data the API refuses; see `references/short-interest.md`.

### Driving Codebook programmatically (CDP)

Codebook is a JupyterLab in the browser, so it can be driven over CDP without
clicking, via the Jupyter REST + WebSocket API. One trap makes this fail
silently on the first try:

**The kernel WebSocket host is NOT the page host.** Read `wsUrl` from the
`jupyter-config-data` element rather than assuming `location.host` — it points at
`wss://amers1-streaming-io.platform.refinitiv.com/...`, and connecting to
`workspace.refinitiv.com` just errors with no message. The same element carries
the `token` the socket needs as a `?token=` query param.

```js
const cfg = JSON.parse(document.getElementById('jupyter-config-data').textContent);
// POST {name:'python3'} to cfg.baseUrl + 'api/kernels' with X-XSRFToken from the _xsrf cookie,
// then open:  `${cfg.wsUrl}api/kernels/${kernelId}/channels?token=${cfg.token}`
// send an execute_request on channel 'shell'; collect 'stream' msgs until status.execution_state === 'idle'
```

First load spawns the server ("Preparing your CodeBook environment", a minute or
two) and the URL sits at `/hub/spawn-pending/<user>` until ready. Shut the kernel
down (`DELETE api/kernels/<id>`) when finished; the server itself idle-culls.

`amers1` is the Americas region — read it from `cfg.wsUrl`, never hardcode it.

The full copy-pasteable recipe lives in **`references/codebook.md`** (added by
PR #95), together with the spawn/XSRF gotchas and why this failure mode is so
easy to misread: the wrong host returns *no* handshake response at all, which is
indistinguishable from a proxy blocking the upgrade.

## Date Awareness

When querying market data, account for current date context and market data lag.

### Market Data Lag

Market data typically has T-1 availability, meaning today’s data becomes available tomorrow. Adjust date ranges accordingly.

### Date Range Example

Use current date context when querying historical prices:

```python
from datetime import datetime, timedelta

# Get recent market data
end_date = datetime.now()
start_date = end_date - timedelta(days=365)

# Adjust to exclude recent data (T-1 for market data availability)
end_date = end_date - timedelta(days=1)

df = ld.get_history(
    universe=”AAPL.O”,
    fields=[‘CLOSE’],
    start=start_date.strftime(‘%Y-%m-%d’),
    end=end_date.strftime(‘%Y-%m-%d’)
)
```

Remember: Always account for the T-1 lag in market data availability.
