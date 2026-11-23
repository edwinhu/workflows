"""Run Lexis+ news queries over CDP: python3 scripts/lexis_q.py <in.json [[key, query],...]> <out.json>. Paced 25 s."""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

import websocket

qs, outf = json.load(open(sys.argv[1])), sys.argv[2]
t = next(t for t in json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list')) if t['type'] == 'page' and 'lexis.com' in t['url'])
ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=60, suppress_origin=True)
n = [0]


def call(m, **p):
    n[0] += 1
    ws.send(json.dumps({'id': n[0], 'method': m, 'params': p}))
    while True:
        r = json.loads(ws.recv())
        if r.get('id') == n[0]:
            return r.get('result', {})


def ev(e):
    return call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True).get('result', {}).get('value')


def wait(c, s):
    t0 = time.time()
    while time.time() - t0 < s:
        try:
            if ev(c):
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


out = {}
for key, q in qs:
    call('Page.navigate', url='https://plus.lexis.com/search/?pdmfid=1530671&pdsearchterms=' + urllib.parse.quote_plus(q) + '&pdtypeofsearch=searchboxclick&pdsearchtype=SearchBox&pdqttype=and')
    time.sleep(3)
    rec = {'q': q, 'n': None, 'arts': []}
    if 'signin' in (ev('location.href') or ''):
        print('SIGNED OUT'); sys.exit(3)
    if wait("[...document.querySelectorAll('button.contentTypeRow')].some(e=>/^News\\s*[\\d,]+$/.test(e.textContent.replace(/\\s+/g,' ').trim()))", 60):
        rec['n'] = ev("(()=>{const b=[...document.querySelectorAll('button.contentTypeRow')].find(e=>e.querySelector('.contentTypeDisplay')?.textContent.trim()==='News'); const c=(b.textContent.match(/News\\s*([\\d,]+)/)||[])[1]; b.click(); return c?parseInt(c.replace(/,/g,'')):0;})()")
        if rec['n'] and wait("document.querySelectorAll('a.titleLink').length>0", 30):
            time.sleep(2)
            links = ev("[...document.querySelectorAll('a.titleLink')].slice(0,6).map(a=>({t:a.textContent.trim().slice(0,160),h:a.href}))") or []
            seen = set()
            for l in links:
                if len(rec['arts']) >= 3 or l['t'][:40] in seen:
                    continue
                seen.add(l['t'][:40])
                call('Page.navigate', url=l['h']); time.sleep(4); wait('document.body.innerText.length>2000', 20); time.sleep(2)
                body = (ev('document.body.innerText') or '').replace('\n', ' ')
                d = (re.search(r'(\w+ \d{1,2}, (?:19|20)\d\d|\d{1,2} \w+ (?:19|20)\d\d)', body) or [None])[0]
                s = [x.strip()[:300] for x in re.findall(r'[^.]{0,250}\.', body) if re.search(r'found|co-found|chief executive|CEO|president', x, re.I)]
                rec['arts'].append({'t': l['t'], 'date': d, 's': list(dict.fromkeys(s))[:8]})
    out[key] = rec
    json.dump(out, open(outf, 'w'), indent=1)
    print(key, rec['n'], len(rec['arts']), flush=True)
    time.sleep(25)
