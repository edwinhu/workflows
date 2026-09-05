#!/usr/bin/env python3
"""Query the Data Item Browser like a field dictionary and print Name -> TR.Code pairs."""
import json
import sys
import time
import urllib.request

import websocket

QUERY = sys.argv[1]
targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10).read())
tab = next(t for t in targets if "DataItemBrowser" in t.get("url", ""))
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)
_id = [0]


def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == _id[0]:
            return m


def ev(js, ctx=None):
    p = {"expression": js, "returnByValue": True}
    if ctx:
        p["contextId"] = ctx
    r = send("Runtime.evaluate", p).get("result", {})
    if r.get("exceptionDetails"):
        return "EXC " + json.dumps(r["exceptionDetails"])[:200]
    return r.get("result", {}).get("value")


# Walk nested same-origin frames to reach the DIB document, set the search box, read the grid.
JS = r"""(() => {
  const findDoc = (doc, depth) => {
    if (depth > 6) return null;
    const inp = [...doc.querySelectorAll('input')]
        .find(e => (e.placeholder||'') === 'Find Data Item');
    if (inp) return doc;
    for (const f of doc.querySelectorAll('iframe')) {
      try { const r = findDoc(f.contentDocument, depth+1); if (r) return r; } catch(e) {}
    }
    return null;
  };
  const d = findDoc(document, 0);
  if (!d) return JSON.stringify({err: 'DIB document not found'});
  const w = d.defaultView;
  const inp = [...d.querySelectorAll('input')].find(e => e.placeholder === 'Find Data Item');
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  inp.focus();
  set.call(inp, %s);
  if (w.angular) { try { w.angular.element(inp).triggerHandler('input'); } catch(e) {} }
  inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  inp.dispatchEvent(new w.KeyboardEvent('keyup', {bubbles:true, key:'a', keyCode:65}));
  return JSON.stringify({ok: true, value: inp.value});
})()"""

READ = r"""(() => {
  const findDoc = (doc, depth) => {
    if (depth > 6) return null;
    if ([...doc.querySelectorAll('input')].some(e => (e.placeholder||'') === 'Find Data Item')) return doc;
    for (const f of doc.querySelectorAll('iframe')) {
      try { const r = findDoc(f.contentDocument, depth+1); if (r) return r; } catch(e) {}
    }
    return null;
  };
  const d = findDoc(document, 0);
  if (!d) return JSON.stringify({err:'no doc'});
  const txt = d.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < txt.length; i++) {
    if (/^TR\.[A-Za-z0-9_]+$/.test(txt[i])) {
      out.push({name: txt[i-1] || '', code: txt[i], val: txt[i+1] || ''});
    }
  }
  return JSON.stringify({count: out.length, items: out.slice(0, 60)});
})()"""

print(ev(JS % json.dumps(QUERY)))
time.sleep(3)
raw = ev(READ)
try:
    d = json.loads(raw)
except (TypeError, ValueError):
    print("read failed:", str(raw)[:300]); ws.close(); sys.exit(1)
if d.get("err"):
    print("ERR", d["err"])
else:
    print(f"\n{QUERY!r}: {d['count']} data items\n")
    seen = set()
    for it in d["items"]:
        if it["code"] in seen:
            continue
        seen.add(it["code"])
        print(f"  {it['code']:46s} {it['name'][:52]:52s} {it['val'][:18]}")
ws.close()
