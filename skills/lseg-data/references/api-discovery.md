# API Discovery

## STOP GUESSING FIELD NAMES — query the Data Item Browser

**`scripts/dib_query.py "<words>"` prints real `TR.*` codes.** Guessed field names are the single
biggest time sink against this API, and every "no-such-field" you collect is worth nothing: it says
your guess was wrong, never that the data is absent. DIB is LSEG's own field dictionary and it
settles the question.

```bash
python3 scripts/dib_query.py "segment revenue"
#   TR.SegmentRevenueActValue   Segment Revenue - Actual   35,686,000,000
```

Needs a signed-in Workspace tab on CDP 9222 with the DIB app open at
`https://workspace.refinitiv.com/web/Apps/DataItemBrowser/` — the **`/web/` path**, which runs
inside the Workspace shell. The bare `/Apps/DataItemBrowser/` URL loads but is inert.

**It renders no `<script src>` and issues NO network request when you search** — it filters a
catalog held client-side, so network capture returns nothing and there is no endpoint to replicate.
The script therefore reads the rendered DOM, walking up to 6 levels of same-origin iframes
(`web` → `rap/webcontainer` → `AppContainer` → `apps/DataItemBrowser` → the app) to find the
document holding the `Find Data Item` box. A hook installed only one frame deep captures nothing;
that failure cost several rounds.

`/Apps/UdipApi/` is DIB's backend (`Load`, `GetFields`, `GetRcsCodes` — the last POST-only, 405 on
GET). Every body shape tried returned `{"rc":{"codes":[]}}`, so read the DOM instead.

### DIB gives you the NAME. It does not give you the ENTITLEMENT.

Always confirm a discovered name with a real `get_data` call and read which error comes back —
`no-such-field` vs `access to field(s) denied` (see SKILL.md). Verified this way 2026-09-04:

| Field | Instrument | Result |
|---|---|---|
| `TR.SegmentRevenueActValue` | AAPL.O | 35,686,000,000 (10 segment rows) |
| `TR.SSSActValue` | WMT.N | 3.2 (same-store sales) |
| `TR.NAREITFFOActual` | SPG.N | 12.34 (FFO per share) |

And two negatives that are now evidence rather than failed guesses, because the dictionary itself
was searched: **major-customer / supply-chain relationships do not exist** ("supply chain" returns
only ESG policy flags such as `TR.SocialSupplyChainPolicy`), and **REIT property-level data does not
exist** ("REIT"/"property" return NAREIT FFO estimates and Japan-specific statements only).

## Network monitoring

When LSEG/Refinitiv data is available in Workspace but not documented in the Python API, you can reverse-engineer the API by monitoring the web client's network traffic.

## Overview

Workspace Web is a normal Chromium page, which means you can:
1. Run Chromium with remote debugging enabled
2. Connect via Chrome DevTools Protocol (CDP)
3. Monitor network requests to discover API endpoints
4. Replicate the API calls in Python

For calling the endpoints you discover, see `workspace-web-cdp.md` — `scripts/workspace_cdp.py` already wraps the token-lift and the same-origin fetch, so most discoveries need no new plumbing.

## Step-by-Step Process

### Step 1: Open Workspace Web in a CDP browser

The web client at `https://workspace.refinitiv.com/web` is the target on every platform, and the only one on Linux. Chromium should already be listening on port 9222 (see the `browser-automation` skill); sign in to Workspace once by hand.

```bash
curl -s http://localhost:9222/json/version | jq -r .Browser
```

**Legacy — desktop app (Windows/macOS only).** If you are on a machine with the Workspace desktop app, it is an Electron shell and can be launched with the same flag. This does not exist on Linux:

```bash
# macOS
/Applications/Refinitiv\ Workspace.app/Contents/MacOS/Refinitiv\ Workspace --remote-debugging-port=9222
# Windows
"C:\Program Files\Refinitiv\Refinitiv Workspace\Refinitiv Workspace.exe" --remote-debugging-port=9222
```

### Step 2: Find the WebSocket Debugger URL

```bash
curl -s http://localhost:9222/json | jq ‘.[0].webSocketDebuggerUrl’
```

Returns something like:
```
ws://localhost:9222/devtools/page/ABC123...
```

### Step 3: Connect and Monitor Network Traffic

```python
import asyncio
import websockets
import json

async def monitor_network():
    # Get debugger URL for the Workspace tab specifically — targets[0] is
    # whatever tab happens to be first, which is usually not Workspace.
    import urllib.request
    targets = json.loads(urllib.request.urlopen(‘http://localhost:9222/json’).read())
    ws_url = next(t[‘webSocketDebuggerUrl’] for t in targets
                  if t[‘type’] == ‘page’ and ‘workspace.refinitiv.com’ in t[‘url’])

    async with websockets.connect(ws_url) as ws:
        # Enable network monitoring
        await ws.send(json.dumps({
            ‘id’: 1,
            ‘method’: ‘Network.enable’
        }))

        # Listen for requests
        while True:
            msg = await ws.recv()
            data = json.loads(msg)

            if data.get(‘method’) == ‘Network.requestWillBeSent’:
                request = data[‘params’][‘request’]
                url = request[‘url’]

                # Filter for interesting APIs
                if ‘datacloud’ in url or ‘api’ in url:
                    print(f”URL: {url}”)
                    print(f”Method: {request[‘method’]}”)
                    if request.get(‘postData’):
                        print(f”Body: {request[‘postData’][:500]}”)
                    print(“-” * 50)

asyncio.run(monitor_network())
```

### Step 4: Trigger the Action in Workspace

While the script is running:
1. Open the relevant app in Workspace (e.g., SDC Platinum)
2. Run the query you want to replicate
3. Watch the console for captured API calls

### Step 5: Analyze Captured Requests

Example captured request for SDC Platinum Poison Pills:

```
URL: https://amers1-apps.platform.refinitiv.com/datacloud-nonviews/snapshot/rest/async?timeout=1
Method: POST
Body: [{“select”: {
    “cache”: “Off”,
    “formula”: “TR.PPIssuerName, TR.PPPillAdoptionDate”,
    “identifiers”: “SCREEN(U(IN(DEALS)) AND IN(TR.PPIssuerNation, “US”),CURN=USD)”,
    “lang”: “en-US”,
    “output”: “col, in, t, sorta, TR.PPIssuerName, sorta, TR.PPPillAdoptionDate”,
    “productId”: “SDC_PLATINUM:UNITY”,
    “titleLang”: “en-US”
}}]
```

## What We Learned from SDC Platinum

### Discovery Process

1. Monitored Workspace while running SDC Platinum queries
2. Found the `datacloud-nonviews` API endpoint
3. Discovered the request body format with SCREEN() syntax
4. Identified field naming patterns (TR.PP*, TR.SACT*)

### Key Finding

The internal API uses `SCREEN(U(IN(DEALS)))` syntax for broad universe queries, but this **does not work** via the public `ld.get_data()` API.

However, the **field names discovered** (TR.SACT*, TR.PP*) **do work** with `ld.get_data()` when you provide specific tickers:

```python
# This works!
df = ld.get_data(
    universe=[‘XOM’, ‘AAPL.O’],
    fields=[‘TR.SACTAnnouncementDate’, ‘TR.SACTLeadDissident’]
)
```

### Session File Analysis

SDC session files (`.sdcs`) are JSON and contain field ID mappings:

```bash
cat ~/Downloads/report.sdcs | jq ‘.searchItems[].parameter.reportItems[].dataItem.fieldId’
```

Example mappings discovered:
- `I_Deals_SACT_DealDetails_AnnouncementDate` → `TR.SACTAnnouncementDate`
- `I_Deals_SACT_Target_TarShortName` → `TR.SACTTargetName`
- `I_Deals_SACT_DissidentRelatedInformation_LeadDissident` → `TR.SACTLeadDissident`

## Limitations

### Authentication

Direct API calls require Workspace session authentication. The CDP approach lets you see the API format, but replicating calls outside Workspace requires:
- Valid session cookies
- OAuth tokens from Workspace

For most use cases, it’s easier to use the discovered field names with `ld.get_data()` rather than calling the internal API directly.

### Service Worker Caching

Some requests may be cached by Service Workers and won’t appear in network monitoring. If you don’t see expected traffic:
- Clear browser cache in Workspace
- Try different query parameters
- Check the Application tab for cached responses

## Practical Workflow

1. **Discover fields**: Use CDP monitoring to find field names (TR.XX*)
2. **Test in Python**: Try discovered fields with `ld.get_data()`
3. **Build universe**: Use SCREEN or index chains for company lists
4. **Query data**: Pass company RICs to corporate governance fields

```python
import lseg.data as ld

ld.open_session()

# Get universe via SCREEN (this works)
universe = ld.get_data(
    universe=’SCREEN(U(IN(Equity(active,public,primary))),IN(TR.HQCountryCode,”US”),CURN=USD)’,
    fields=[‘TR.CommonName’]
)
rics = universe[‘Instrument’].tolist()

# Query discovered fields (TR.SACT* from CDP monitoring)
activism = ld.get_data(
    universe=rics[:100],
    fields=[‘TR.SACTAnnouncementDate’, ‘TR.SACTLeadDissident’]
)

ld.close_session()
```

## Programmatic Field Discovery

### What Works

The LSEG Data Library has a **Search API** that can list properties for finding instruments:

```python
from lseg.data import discovery

# Get search properties for a view
result = discovery.SearchPropertyExplorer.get_properties_for(
    view=discovery.Views.MUNICIPAL_INSTRUMENTS
)
print(f”Found {len(result.properties)} search properties”)
```

### What Doesn’t Work

**There is no API to discover `TR.*` data field names.** The TR.* fields used with `ld.get_data()` are not exposed in any programmatic catalog.

The Search API properties (AccrualDate, AssetCategory, etc.) are for **finding instruments**, not for **retrieving data** - they’re different APIs:

| API | Purpose | Field Style |
|-----|---------|-------------|
| `discovery.search` | Find instruments | AccrualDate, AssetCategory |
| `ld.get_data()` | Retrieve data | TR.MuniSaleDate, TR.Revenue |

### Field Discovery Options

Since there’s no programmatic API for TR.* fields, use these approaches:

1. **CDP Network Monitoring** (recommended)
   - Monitor SDC Platinum while running queries
   - Capture TR.* field names from request bodies
   - Most reliable for SDC-specific fields

2. **Data Item Browser (DIB)**
   - Built into Refinitiv Workspace
   - Search “DIB” in Workspace to open
   - Lists TR.* fields with descriptions

3. **Column Picker UI**
   - In SDC Platinum, customize columns to see all available fields
   - Monitor network traffic while opening the picker

4. **Pattern Enumeration**
   - Once you know a prefix (TR.Muni*), try variations
   - Common patterns: *Name, *Date, *Amount, *Status, *Code

5. **LSEG Documentation**
   - Check developer portal docs (often incomplete)
   - API Playground sometimes has field lists

### Capturing All Fields from Column Picker

To get a complete field list for an SDC dataset:

1. Start network monitoring
2. Open SDC Platinum to your dataset
3. Click “Customize Columns” or equivalent
4. The field picker loads all available fields
5. Capture the TR.* field names from network traffic

## IndexedDB Field Extraction (Recommended)

SDC Platinum caches complete field definitions in the browser’s IndexedDB. This is the **most reliable method** for extracting all available fields for a dataset.

### How It Works

1. SDC Platinum stores field metadata in IndexedDB database `SDCPlatinum`
2. The `APIResponse` object store contains cached field definitions
3. Each dataset (M&A, Equity, Loans, etc.) has a cached entry with all TR.* fields

### Extraction Process

#### Step 1: Open SDC Platinum in the CDP browser

Navigate to SDC Platinum:
- URL: `https://amers1-apps.platform.refinitiv.com/Apps/SDCPlatinum/`
- Log in with your Refinitiv credentials (or open the app from inside Workspace Web, which reuses the existing session)

#### Step 2: Open Each Dataset Type

The field definitions are cached when you first open each session type:
- Open “Mergers & Acquisitions” session to cache TR.MnA* fields
- Open “Poison Pills” session to cache TR.PP* and TR.SACT* fields
- Open “Loans” session to cache TR.LN* fields
- etc.

#### Step 3: Extract from IndexedDB via DevTools

Open Chrome DevTools (F12) and run in Console:

```javascript
// Open the SDCPlatinum IndexedDB
const request = indexedDB.open(‘SDCPlatinum’);

request.onsuccess = function(event) {
    const db = event.target.result;
    const tx = db.transaction(‘APIResponse’, ‘readonly’);
    const store = tx.objectStore(‘APIResponse’);

    // Get all cached entries
    const getAllRequest = store.getAll();

    getAllRequest.onsuccess = function() {
        const entries = getAllRequest.result;

        // Find entries with field definitions (large entries)
        entries.forEach((entry, idx) => {
            const size = JSON.stringify(entry).length;
            if (size > 100000) {  // Large entries contain field defs
                console.log(`Entry ${idx}: ${(size/1024/1024).toFixed(2)} MB`);

                // Extract field definitions
                if (entry.value && entry.value.universe) {
                    const fields = entry.value.universe.map(f => ({
                        TR_Path: f.TR_Path,
                        Name: f.Name,
                        DataType: f.DataType,
                        Description: f.Description
                    }));
                    console.log(`Fields: ${fields.length}`);
                    console.log(JSON.stringify(fields, null, 2));
                }
            }
        });
    };
};
```

### Dataset to IndexedDB Key Mapping

| Dataset | Universe Key | Field Count | TR Prefix |
|---------|--------------|-------------|-----------|
| M&A | DEALSMNA | 2,683 | TR.MnA* |
| Equity/IPO | DEALSEQ | 1,708 | TR.NI* |
| Loans | DEALSLN | 1,290 | TR.LN* |
| Project Finance | DEALSPF | 2,674 | TR.PJF* |
| Private Equity | DEALSPE | 557 | TR.PEInvest* |
| Poison Pills (PP) | DEALSPP | 418 | TR.PP* |
| Poison Pills (PF) | DEALSPOISONPILLSPF | 416 | TR.SACT* |
| Joint Ventures | DEALSJV | 301 | TR.JV* |
| Municipal Bonds | DEALSMUNI | 443 | TR.Muni* |
| Repurchases | DEALSREP | 728 | TR.REP* |

### Field Definition Structure

Each cached field has this structure:

```json
{
  “TR_Path”: “TR.MnAAcquirorName”,
  “Name”: “Acquiror Name”,
  “DataType”: “String”,
  “SDC_Codes”: “ANAMES”,
  “Description”: “Name of the acquiring company...”
}
```

### Advantages Over Network Monitoring

| Method | Pros | Cons |
|--------|------|------|
| IndexedDB | Complete field list, offline access, structured data | Must open each session type first |
| CDP Monitoring | Real-time, sees actual queries | Incomplete, only sees used fields |
| DIB/Column Picker | Visual interface | Manual, can’t export easily |

### Extracted Field Data Location

Complete field extractions live in the `lseg-exploration` project under
`data/sdc_fields/` (originally captured on the macOS machine at
`~/projects/lseg-exploration/`):

- `sdc_platinum_complete_fields.json` (5.0 MB) - All datasets
- `*_fields.csv` - Individual dataset CSV files

If that project is not present on the current machine, re-extract with the IndexedDB
method above — it takes a few minutes per dataset.

## FSCREEN (Fund Reporting) API

FSCREEN uses a different API pattern than SDC Platinum. It’s accessible at:

**Endpoint:** `https://workspace.refinitiv.com/Apps/FundReporting/{version}/l3`

### Request Structure

```json
{
  “request”: {
    “dataPoints”: [“TRANAGNT_NAME”, “EXPENSE_RATIO”],
    “universe”: {
      “symbols”: [40229535, 40229536, 40229537]
    }
  },
  “options”: {
    “viewId”: 7
  }
}
```

### Key Differences from SDC Platinum

| Aspect | SDC Platinum | FSCREEN |
|--------|--------------|---------|
| Endpoint | `/datacloud-nonviews/snapshot/rest/async` | `/Apps/FundReporting/{ver}/l3` |
| Identifiers | SCREEN() syntax with RICs | Numeric fund IDs |
| Field Naming | TR.* prefix | Internal codes (TRANAGNT_NAME) |
| Universe | `identifiers` string | `symbols` array |

### Field Code Mapping

FSCREEN uses internal field codes that differ from display names. Codes fall into two patterns:
1. **SNAKE_CASE** - Most company/contact fields (e.g., `ADMINISTRATOR_NAME`)
2. **Display-style** - Some calculated fields use spaces/symbols (e.g., `Total Exp (Calc) %`)

#### Identifiers

| Display Name | Internal Code |
|--------------|---------------|
| Lipper ID | `LIPPERID` |
| Asset Name | `NAME` |

#### Company Information (SNAKE_CASE pattern)

| Entity | Name | Email | Phone | Website |
|--------|------|-------|-------|---------|
| Administrator | `ADMINISTRATOR_NAME` | `ADMINISTRATOR_EMAIL` | `ADMINISTRATOR_PHONENUMBER` | `ADMINISTRATOR_WEBSITE` |
| Custodian | `CUSTODIAN_NAME` | `CUSTODIAN_EMAIL` | `CUSTODIAN_PHONENUMBER` | `CUSTODIAN_WEBSITE` |
| Fund Mgmt Company | `FUNDMGMTCMPY_NAME` | `FUNDMGMTCMPY_EMAIL` | `FUNDMGMTCMPY_PHONENUMBER` | `FUNDMGMTCMPY_WEBSITE` |
| Investment Advisor | `INVSTADV_NAME` | `INVSTADV_EMAIL` | `INVSTADV_PHONENUMBER` | `INVSTADV_WEBSITE` |
| Promoter | `PROMOTER_NAME` | `PROMOTER_EMAIL` | `PROMOTER_PHONENUMBER` | `PROMOTER_WEBSITE` |
| Sub-Administrator | `SUBADMIN_NAME` | `SUBADMIN_EMAIL` | `SUBADMIN_PHONENUMBER` | `SUBADMIN_WEBSITE` |
| Transfer Agent | `TRANAGNT_NAME` | - | - | - |

#### Expenses

| Display Name | Internal Code |
|--------------|---------------|
| Total Expense (Calculated %) | `Total Exp (Calc) %` |
| Sub-Advisor Expenses (%) | `EXP_ADV_SUB` |

**Note:** Expense field codes use inconsistent naming - some use SNAKE_CASE (`EXP_ADV_SUB`), others use display-style strings (`Total Exp (Calc) %`). Always verify via network monitoring.

#### Returns (Parameterized)

Return fields use a parameterized format with `[universe=ID]`:

| Display Name | Internal Code |
|--------------|---------------|
| Total Return 3 years | `LL3YTR[universe=35381]` |

**Pattern:** Return fields likely follow `LL{N}YTR[universe=35381]` where N = years. The `universe=35381` appears to be a fixed parameter.

#### Holdings

| Display Name | Internal Code |
|--------------|---------------|
| Top Holdings | `CTOPHOLDCAL` |

#### Fund Information (Parameterized)

Some fields use parameterized format with `[currency=XXX]`:

| Display Name | Internal Code |
|--------------|---------------|
| Fund TNA (Mil) | `FUNDTNA[currency=USD]` |

### Discovering Field Codes

To discover internal field codes:

1. Open Chrome DevTools Network tab
2. Navigate to FSCREEN: `https://workspace.refinitiv.com/web/Apps/FundReporting/`
3. Use “Add Column” search to trigger API calls
4. Look for `/l3` POST requests
5. Inspect the `dataPoints` array in the request body

### Converting Numeric IDs to Lipper RICs

The numeric symbols in FSCREEN are simply Lipper RICs without the “LP” prefix:

| FSCREEN ID | Lipper RIC |
|------------|------------|
| `40229535` | `LP40229535` |
| `68714767` | `LP68714767` |

**Conversion:** Just prepend “LP” to the numeric ID.

### Example: Fetch Fund Data

```javascript
fetch(“https://workspace.refinitiv.com/Apps/FundReporting/1.2.188/l3”, {
  method: “POST”,
  headers: {
    “content-type”: “application/json; charset=UTF-8”
  },
  body: JSON.stringify({
    “request”: {
      “dataPoints”: [
        “LIPPERID”,
        “NAME”,
        “Total Exp (Calc) %”,
        “LL3YTR[universe=35381]”,
        “FUNDTNA[currency=USD]”,
        “CTOPHOLDCAL”
      ],
      “universe”: {
        “symbols”: [40229535, 40229536, 40229537]
      }
    },
    “options”: {“viewId”: 7}
  }),
  credentials: “include”
});
```

**Note:** Authentication is handled via Workspace session cookies. You must be logged into Refinitiv Workspace for API calls to work.

## Tools Used

- **Chrome DevTools Protocol (CDP)**: Network monitoring via WebSocket
- **IndexedDB**: Browser storage containing cached field definitions
- **websocket-client**: Python WebSocket library (installed; `websockets` is not)
- **jq**: JSON parsing for session files and API responses
- **Workspace Web**: `https://workspace.refinitiv.com/web` in Chromium on `--remote-debugging-port=9222`
- **`scripts/workspace_cdp.py`**: replays discovered endpoints without hand-rolling auth
