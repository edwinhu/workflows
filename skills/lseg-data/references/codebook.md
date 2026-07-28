# Codebook (hosted JupyterHub) over CDP

LSEG Codebook is a JupyterHub at `https://workspace.refinitiv.com/codebook/`, authenticated
by the same Workspace Web cookies. Its kernels run a pre-authenticated `refinitiv.data`
session (`{name='codebook'}`) with the account's **full** entitlements — which makes it the
most capable surface in principle.

## Status: WORKING — execution included

**Corrected 2026-07-27 evening, same account/machine/browser.** Kernel execution
works. Code was executed three times over CDP on Chromium/Arch, opening a session
and returning live data.

**The kernel WebSocket host is NOT the page host.** Read `wsUrl` from the
`jupyter-config-data` element instead of assuming `location.host`:

```
page host   wss://workspace.refinitiv.com/codebook/...              -> never handshakes
cfg.wsUrl   wss://amers1-streaming-io.platform.refinitiv.com/...    -> opens in ~280ms
```

A/B on one kernel, at one moment, differing only in host:

| attempt | result |
|---|---|
| page host, no subprotocol | `ERROR`, no handshake (1820ms) |
| page host, **with** `v1.kernel.websocket.jupyter.org` | `ERROR`, no handshake (465ms) |
| `cfg.wsUrl` host, no subprotocol | **OPEN (280ms)** |
| `cfg.wsUrl` host, with subprotocol | **OPEN (282ms)** |

So the subprotocol is irrelevant and the host is decisive. The section below
records the original mis-diagnosis, kept because the failure signature is worth
recognising.

### What the original analysis got wrong, and the one thing still unexplained

The evidence gathered below was real, but every attempt used
`wss://workspace.refinitiv.com/...` — `amers1-streaming-io` was never tried. The
decisive-looking test (a bogus kernel ID failing *identically* to a valid one) does
not in fact discriminate: a host that does not route `/codebook` WebSockets at all
fails identically whatever the kernel ID. It reads as "an intermediary terminates
the connection before the backend" because that is exactly what it is — the
intermediary is just the wrong hostname.

**Still unexplained, and the reason this is not a clean "it was always the host":**
the original session reported that *Codebook's own JupyterLab UI* also hung at
`[*]` with `connections: 0`. The official UI uses the correct host, so that
observation points at a genuine outage at that time, since resolved. Both stories
fit the record and the logs cannot separate them:

- **(a) always the wrong host** — the UI check was flawed or misread.
- **(b) a real outage earlier that has since cleared** — possibly on LSEG's side,
  in which case the wrong host is a second, independent bug that would have masked
  the recovery.

If the answer matters, LSEG case 16243957 will settle it. What is *not* in doubt:
the standing advice below to "not spend time on it" is wrong, and anyone reading
this should try `cfg.wsUrl` before concluding Codebook is down.

| Capability | Endpoint | Status |
|-----------|----------|--------|
| Hub identity / spawn state | `/codebook/hub/api/user` | works |
| List / read / write / delete notebooks | `/user/{name}/api/contents/...` | works (200/201/204) |
| List kernelspecs | `/user/{name}/api/kernelspecs` | works — `python3`, `python3_legacy` |
| Create / delete kernels | `/user/{name}/api/kernels` | works |
| Sessions | `/user/{name}/api/sessions` | works |
| Terminals | `/user/{name}/api/terminals` | 404 (disabled) |
| **Execute code** | `wss://.../api/kernels/{id}/channels` | **works — use `cfg.wsUrl` host, NOT the page host** |

### The execution blocker — an infrastructure block, not an auth problem

Every route to running code fails with close 1006:

- direct `WebSocket` from a page, with and without the
  `v1.kernel.websocket.jupyter.org` subprotocol
- from Python with the browser's cookie jar (Tornado replied `400` once, then upgrades
  began hanging)
- **Codebook's own JupyterLab UI** — driving a real cell via CDP input events typed the
  code and submitted it, and the prompt sat at `[*]` indefinitely with no output, with
  `api/kernels` reporting `connections: 0`

**Superseded — see the corrected status above.** (Original wording: "do not spend time on
headers, cookies, or subprotocols". Correct in spirit — none of those were the cause —
but it stopped the search one step short of the hostname, which was.)
Traced with the CDP Network domain (`Network.webSocket*` events) on the real Codebook tab:

1. `webSocketCreated` fires.
2. `webSocketWillSendHandshakeRequest` fires with a **fully correct** request — `Upgrade:
   websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version: 13`,
   the subprotocol, `permessage-deflate`, and the complete cookie jar.
3. `webSocketHandshakeResponseReceived` **never fires** — no HTTP response comes back at
   all, not even an error status.
4. ~0.5–1.5s later, `webSocketFrameError` (empty message) then `webSocketClosed`.

The decisive test: a **nonexistent kernel ID** (`00000000-...`) fails *identically* to a
freshly created, valid one. A request that actually reached JupyterHub would distinguish
them with a 404. Identical failure proves an intermediary terminates the connection
**before it reaches the notebook backend**.

Suspect is the F5 BIG-IP in the path (persistence cookie `BIGipServerHDCP-DATACLOUD-VIP-1080`)
or an nginx/CDN hop not passing the Upgrade through. One early raw-socket attempt did get
Tornado's literal `Can "Upgrade" only to "WebSocket".` body back, which shows the backend
is reachable and behaves correctly when a request does get proxied — so the layer may be
flaky rather than a hard deny. In practice it is indistinguishable from always-blocked:
**0 successful handshakes in ~6 attempts across two sessions.**

Ruled out: the CloudFront signed cookies are a red herring — `CloudFront-Policy` scopes its
`Resource` to `https://workspace.refinitiv.com/assets/*`, nothing to do with `/codebook/`.

It is **not** a general WebSocket problem with the browser — from the same tab,
`wss://echo.websocket.org` opens fine while the Codebook kernel channel returns 1006.

Because the official UI is equally broken, scripted access did not cause this.

### Try these two before concluding it is unfixable

The "terminated by an intermediary" evidence is solid, but it does **not** establish that
the cause is purely server-side. Two things were observed later and are untried:

1. ~~**Stale session / oversized cookie jar.**~~ **TESTED 2026-07-27 — did not fix it.**
   The community report of this symptom was resolved by clearing cache, history *and*
   active logins ([thread 133850](https://community.developers.lseg.com/discussion/133850/error-on-kernel-connecting-in-codebook)),
   and the ~6.9 KB `Cookie` header made a proxy header-size limit plausible. So all 100
   Refinitiv/LSEG cookies were deleted along with localStorage/IndexedDB/service-workers
   /cache for those origins, and the session re-established via SSO. The jar shrank to
   5.7 KB and JupyterHub reported the server up (`pending: null`) — **and the kernel
   WebSocket still closed 1006.** Cookie size and session staleness are ruled out on this
   machine. Do not retry this.
2. **Unsupported browser / different machine — the only avenue left.** Workspace Web
   renders a banner: *"BROWSER NOT SUPPORTED
   — Some Workspace Web access features may not work correctly. Please use one of our
   supported browsers."* Chromium on Linux is not on LSEG's supported list. This is weak
   evidence on its own (the non-browser Python attempts failed too, and Chromium's UA
   reports as Chrome), but with the session hypothesis dead it is the last cheap test:
   open Codebook on a supported browser/OS (e.g. Chrome on macOS) and run `print(1)`.
   If it sticks at `[*]` there too, it is server-side and the ticket is justified.

Also note the embedded CodeBook's kernel status reads **"Restarting" / "Waiting…"**, and
the community report mentions *"Kernel seems to have died. It will be restarted
automatically."* A dying kernel is a different failure from a blocked socket, and both may
be in play — do not assume one explains the other.

### Support case raised

**LSEG Support case 16243957** (raised 2026-07-27, product "Workspace", Technical issue →
Connectivity). It reports the user-visible symptom only — cells stuck at `[*]`, kernel
stuck "Restarting", everything else in CodeBook working — and the troubleshooting already
done. Check `support.lseg.com/s/support-cases` for the reply before re-investigating.

If a further ticket is ever needed, the underlying technical detail is: *"WebSocket upgrade to
`/codebook/user/<id>/api/kernels/*/channels` never completes — no handshake response, 0%
success rate, JupyterLab UI cells stuck at `[*]`."* Note the official answer in the
community thread to this exact symptom was also "submit a ticket to the Helpdesk".

No alternative execution route exists in the exposed API surface: only `contents`,
`kernels`, `sessions` and `kernelspecs` are live — no `terminals`, no run/execute REST
route, no nbconvert or jupyter-server-proxy execution path. None of those run code without
the kernel channel.

**Diagnostic — re-run before assuming Codebook is still blocked:**

```javascript
// in the Codebook tab's console
new WebSocket(location.href.split('/lab')[0] + '/api/kernels/x/channels')
  .onclose = e => console.log('close', e.code);   // 1006 == still blocked
```

If that ever opens, Codebook becomes the best path available — a fully entitled
`refinitiv.data` session that covers what the lifted token cannot, notably **news**
(`/data/news/v1/headlines` is 403 with the Workspace token). Wire it up then.

## What Codebook is still good for

The contents API is fully functional, so Codebook works as a **file exchange with a
human-run kernel**:

1. `PUT api/contents/<path>` a notebook built locally
2. the user opens it in Codebook and runs it (execution works for them interactively —
   subject to the same block, so confirm before relying on it)
3. `GET api/contents/<path>` to pull back the executed notebook **with its outputs**, and
   parse them with the `notebook-debug` skill's approach

You can also read notebooks the user already has. This account's Codebook home holds
`Event Study/`, `Filings/`, `Insurance/`, `SDC/`, `News.ipynb`, `PermID.ipynb`,
`RD_Funds.ipynb`, `SearchBrowserLib.ipynb` and the `__Examples__` / `__Guidelines__`
folders — useful as worked references for LSEG API patterns.

## Access recipe

```python
import json, urllib.request, websocket   # websocket-client

# 1. cookies from the CDP browser
bws = json.loads(urllib.request.urlopen("http://localhost:9222/json/version").read())["webSocketDebuggerUrl"]
ws = websocket.create_connection(bws, timeout=30)
ws.send(json.dumps({"id": 1, "method": "Storage.getCookies"}))
while True:
    m = json.loads(ws.recv())
    if m.get("id") == 1: break
ws.close()
jar = "; ".join(f"{c['name']}={c['value']}" for c in m["result"]["cookies"]
                if c["domain"].endswith("workspace.refinitiv.com"))

# 2. the hub tells you your user name; the server must be spawned first
hub = "https://workspace.refinitiv.com/codebook/"
user = json.loads(urllib.request.urlopen(
    urllib.request.Request(hub + "hub/api/user", headers={"Cookie": jar})).read())["name"]
base = f"{hub}user/{user}/"

# 3. contents API (writes need the _xsrf cookie echoed as a header)
xsrf = [c.split("=", 1)[1] for c in jar.split("; ") if c.startswith("_xsrf=")][0]
req = urllib.request.Request(base + "api/contents", headers={"Cookie": jar})
print(json.loads(urllib.request.urlopen(req).read())["content"][:5])
```

### Executing code — the WebSocket path

**Do not build the kernel URL from `location.host`.** Read `wsUrl` and `token` out
of the `jupyter-config-data` element on the Lab page; `wsUrl` points at a
different host and already carries the right base path:

```
correct:   ${cfg.wsUrl}api/kernels/${kernelId}/channels?token=${cfg.token}
           -> wss://amers1-streaming-io.platform.refinitiv.com/codebook/user/<user>/api/kernels/<id>/channels?token=...

wrong:     wss://${location.host}${cfg.baseUrl}api/kernels/${kernelId}/channels
           -> wss://workspace.refinitiv.com/codebook/... — never handshakes, no response at all
```

`amers1` is the Americas region — **read it from `cfg.wsUrl`, do not hardcode it**,
or this breaks for any other region.

Verified working from the Lab page's own JS context (`evaluate_script` over CDP),
which is the simplest route because the browser supplies the cookies:

```js
const cfg  = JSON.parse(document.getElementById('jupyter-config-data').textContent);
const xsrf = document.cookie.split('; ').find(c => c.startsWith('_xsrf='))?.split('=')[1];

// create your own kernel — do not hijack the user's
const k = await (await fetch(cfg.baseUrl + 'api/kernels', {
  method: 'POST', credentials: 'include',
  headers: {'Content-Type': 'application/json', 'X-XSRFToken': xsrf},
  body: JSON.stringify({name: 'python3'})})).json();

const exec = (code, timeoutMs = 120000) => new Promise(resolve => {
  const ws  = new WebSocket(`${cfg.wsUrl}api/kernels/${k.id}/channels?token=${cfg.token}`);
  const out = [], id = 'm' + Math.random().toString(36).slice(2);
  let done = false;
  const fin = () => { if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(out.join('')); } };
  const timer = setTimeout(fin, timeoutMs);
  ws.onopen = () => ws.send(JSON.stringify({
    header: {msg_id: id, username: 'u', session: 's', msg_type: 'execute_request', version: '5.3'},
    parent_header: {}, metadata: {},
    content: {code, silent: false, store_history: true, user_expressions: {},
              allow_stdin: false, stop_on_error: false},
    channel: 'shell'}));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.parent_header?.msg_id !== id) return;          // ignore other clients' traffic
    const t = m.header.msg_type, c = m.content;
    if (t === 'stream') out.push(c.text);
    else if (t === 'execute_result' || t === 'display_data') out.push((c.data || {})['text/plain'] + '\n');
    else if (t === 'error') out.push(c.ename + ': ' + c.evalue + '\n');
    else if (t === 'status' && c.execution_state === 'idle') { clearTimeout(timer); fin(); }
  };
  ws.onerror = () => { clearTimeout(timer); fin(); };
});

await exec('import refinitiv.data as rd; rd.open_session(); print(rd.session.get_default().open_state)');
// -> "OpenState.Opened"

// clean up
await fetch(cfg.baseUrl + 'api/kernels/' + k.id,
            {method: 'DELETE', credentials: 'include', headers: {'X-XSRFToken': xsrf}});
```

Filtering on `parent_header.msg_id` matters — the channel carries traffic from
every client attached to that kernel, so without it you collect the Lab UI's
messages too.

The same URL should work from `websocket-client` with the cookie jar from step 1,
but only the in-page route above was actually tested.

## Gotchas

- **The server must be spawned.** A cold `GET /codebook/` redirects to
  `hub/spawn-pending/<user>` and the `/user/.../api/*` routes return **503** until it comes
  up. Opening `https://workspace.refinitiv.com/codebook/` in a real tab spawns it; bare
  `fetch()` calls do not reliably drive the spawn to completion. Allow ~45s.
- **Lab can get stuck on "Loading…"** with a *"clear the workspace or keep waiting"* prompt.
  Clicking **CLEAR WORKSPACE** fixes it — it resets the lab *layout*, not your files.
- **A first-run tour modal** ("Welcome to CodeBook!") overlays the UI; dismiss with **SKIP**
  before driving anything.
- **Writes need `X-XSRFToken`** set to the `_xsrf` cookie value, or you get a 403.
- **The kernel WebSocket is on a different host from the page.** Use `cfg.wsUrl`
  from `jupyter-config-data`, never `location.host`. Getting this wrong produces a
  silent failure with *no* handshake response — no status code, no error body,
  just `onerror` then close — which reads exactly like a proxy blocking the
  upgrade. It is what made this look like an infrastructure outage for a day.
- **Don't hijack the user's kernels.** Create your own via `POST api/kernels` and
  `DELETE` them when finished; killing a kernel they are using loses their in-memory state.
