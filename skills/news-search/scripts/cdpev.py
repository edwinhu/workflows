"""Evaluate a JS expression in the Factiva tab: python3 scripts/cdpev.py '<expr>'"""
import json, sys, urllib.request, websocket
t = next(t for t in json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list')) if t['type'] == 'page' and 'factiva' in t['url'])
ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=60, suppress_origin=True)
ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': sys.argv[1], 'returnByValue': True, 'awaitPromise': True}}))
while True:
    m = json.loads(ws.recv())
    if m.get('id') == 1:
        print(json.dumps(m['result'].get('result', {}).get('value', m['result']))); break
