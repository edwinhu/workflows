"""Watch the Factiva tab over CDP: snapshot __f3 results to disk, exit when the named tags finish or the helpers vanish.
usage: python3 scripts/fwatch.py <outdir> <tag> [<tag> ...]"""
import json, sys, time, urllib.request
import websocket

out, tags = sys.argv[1], sys.argv[2:]


def page():
    ts = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list'))
    return next(t for t in ts if t['type'] == 'page' and 'factiva' in t['url'])


def ev(expr):
    ws = websocket.create_connection(page()['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
    ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == 1:
            ws.close()
            return m['result']['result'].get('value')


misses = 0
while True:
    try:
        st = ev("JSON.stringify({ok: typeof window.__get3, done: window.__f3done || {}, n: Object.fromEntries(%s.map(t => [t, (window.__get3 ? window.__get3(t).length : -1)]))})" % json.dumps(tags))
        st = json.loads(st)
        if st['ok'] != 'function':
            # helpers gone (reload or sign-out); localStorage still holds results
            raw = ev("JSON.stringify(Object.fromEntries(%s.map(t => [t, JSON.parse(localStorage.getItem('__f3_'+t)||'[]')])))" % json.dumps(tags))
            for t, v in json.loads(raw).items():
                json.dump(v, open(f'{out}/f3_{t}.json', 'w'))
            print('HELPERS GONE', {t: len(v) for t, v in json.loads(raw).items()}, flush=True)
            sys.exit(3)
        for t in tags:
            v = ev(f"JSON.stringify(window.__get3('{t}'))")
            json.dump(json.loads(v), open(f'{out}/f3_{t}.json', 'w'))
        print(time.strftime('%H:%M'), st['n'], st['done'], flush=True)
        if all(st['done'].get(t) is True for t in tags):
            print('ALL DONE', flush=True)
            sys.exit(0)
        misses = 0
    except Exception as e:
        misses += 1
        print('err', repr(e)[:150], flush=True)
        if misses >= 10:
            sys.exit(4)
    time.sleep(120)
