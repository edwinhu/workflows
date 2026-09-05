#!/usr/bin/env python3
"""Fetch a Workspace URL from INSIDE an already-open Workspace tab.

Never creates a tab: Refinitiv treats a second tab as a duplicate login and
force-logs-out both. Refuses to run if no Workspace tab is already open.
"""
import json
import sys
import urllib.request

import websocket

URL = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else None

targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10).read())
tabs = [t for t in targets
        if t.get("type") == "page" and "workspace.refinitiv.com" in t.get("url", "")]
if not tabs:
    sys.exit("No Workspace tab open. Open one by hand — do NOT let tooling create it.")
tab = tabs[0]
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=90)

JS = ("(async()=>{try{const r=await fetch(" + json.dumps(URL) + ",{credentials:'include'});"
      "const t=await r.text();return JSON.stringify({status:r.status,body:t});}"
      "catch(e){return JSON.stringify({status:0,body:'ERR '+e.message});}})()")
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                    "params": {"expression": JS, "awaitPromise": True, "returnByValue": True}}))
while True:
    m = json.loads(ws.recv())
    if m.get("id") == 1:
        break
ws.close()

res = m.get("result", {})
if res.get("exceptionDetails"):
    sys.exit("EXC " + json.dumps(res["exceptionDetails"])[:300])
payload = json.loads(res["result"]["value"])
print("status:", payload["status"], "| bytes:", len(payload["body"]))
if OUT:
    with open(OUT, "w") as fh:
        fh.write(payload["body"])
    print("wrote", OUT)
else:
    print(payload["body"][:1500])
