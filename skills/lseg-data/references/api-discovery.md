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
    “identifiers”: “SCREEN(U(IN(DEALS)) AND IN(TR.PPIssuerNation, "US"),CURN=USD)”,
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

## Tools Used

- **Chrome DevTools Protocol (CDP)**: Network monitoring via WebSocket
- **websockets**: Python library for WebSocket connections
- **jq**: JSON parsing for session files and API responses
- **Refinitiv Workspace**: Electron app with `--remote-debugging-port` flag
