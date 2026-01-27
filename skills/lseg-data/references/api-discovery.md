# API Discovery via Network Monitoring

When LSEG/Refinitiv data is available in Workspace but not documented in the Python API, you can reverse-engineer the API by monitoring network traffic from the Electron app.

## Overview

Refinitiv Workspace is an Electron app (Chromium-based), which means you can:
1. Launch it with remote debugging enabled
2. Connect via Chrome DevTools Protocol (CDP)
3. Monitor network requests to discover API endpoints
4. Replicate the API calls in Python

## Step-by-Step Process

### Step 1: Launch Workspace with Remote Debugging

```bash
# macOS
/Applications/Refinitiv\ Workspace.app/Contents/MacOS/Refinitiv\ Workspace --remote-debugging-port=9222

# Windows
“C:\Program Files\Refinitiv\Refinitiv Workspace\Refinitiv Workspace.exe” --remote-debugging-port=9222
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
    # Get debugger URL
    import urllib.request
    targets = json.loads(urllib.request.urlopen(‘http://localhost:9222/json’).read())
    ws_url = targets[0][‘webSocketDebuggerUrl’]

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

#### Step 1: Open SDC Platinum in Chrome

Navigate to SDC Platinum in a browser (not the Electron app):
- URL: `https://amers1-apps.platform.refinitiv.com/Apps/SDCPlatinum/`
- Log in with your Refinitiv credentials

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

Complete field extractions are stored at:
`/Users/vwh7mb/projects/lseg-exploration/data/sdc_fields/`

Files include:
- `sdc_platinum_complete_fields.json` (5.0 MB) - All datasets
- `*_fields.csv` - Individual dataset CSV files

## Tools Used

- **Chrome DevTools Protocol (CDP)**: Network monitoring via WebSocket
- **IndexedDB**: Browser storage containing cached field definitions
- **websockets**: Python library for WebSocket connections
- **jq**: JSON parsing for session files and API responses
- **Refinitiv Workspace**: Electron app with `--remote-debugging-port` flag
