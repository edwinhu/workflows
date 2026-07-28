#!/usr/bin/env python3
"""Drive LSEG/Refinitiv Workspace Web (https://workspace.refinitiv.com/web) over CDP.

Replaces the desktop Workspace app + `lseg.data` library, neither of which exists
on Linux. Three access paths, in order of preference:

  1. datagrid()      - lift the page's `edp-token` and call the public RDP REST API
                       from Python. This is the `ld.get_data()` equivalent.
  2. rdp_get/post()  - same token against any other api.refinitiv.com endpoint
                       (historical-pricing, symbology, search).
  3. in_page_fetch() - run fetch() inside a tab on the target ORIGIN, using the
                       browser's own cookies. The only way to reach Workspace-internal
                       endpoints (SDC datacloud deal universes, FSCREEN) that the
                       public token cannot touch.

Requires: Chromium running with --remote-debugging-port=9222 and a logged-in
Workspace Web tab. See SKILL.md "Session Setup".

CLI:
  python3 workspace_cdp.py token
  python3 workspace_cdp.py datagrid --universe AAPL.O,MSFT.O --fields TR.CommonName,TR.Revenue
  python3 workspace_cdp.py history AAPL.O --start 2025-01-01 --end 2025-02-01
  python3 workspace_cdp.py sdc-screen --formula TR.MnAAcquiror --screen 'U(IN(DEALS)) AND ...'
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.parse
import urllib.request

import websocket  # websocket-client

PORT = 9222
WORKSPACE = "workspace.refinitiv.com/web"
RDP = "https://api.refinitiv.com"
APPS_ORIGIN = "https://amers1-apps.platform.refinitiv.com"

_token_cache: dict = {}
_tab_cache: dict = {}


# ---------------------------------------------------------------- CDP plumbing

def _targets(port: int = PORT) -> list[dict]:
    try:
        return json.loads(urllib.request.urlopen(
            f"http://localhost:{port}/json", timeout=10).read())
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Cannot reach CDP on port {port} ({exc}). Start Chromium with "
            "--remote-debugging-port=9222.") from exc


def _find_page(match: str, port: int = PORT) -> dict:
    for t in _targets(port):
        if t.get("type") == "page" and match in t.get("url", ""):
            return t
    raise SystemExit(
        f"No open tab matching {match!r}. Open https://{WORKSPACE} in the "
        "CDP browser and sign in first.")


def _eval(ws_url: str, expression: str, timeout: int = 120):
    ws = websocket.create_connection(ws_url, timeout=timeout,
                                     max_size=256 * 1024 * 1024)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True,
            "returnByValue": True, "timeout": timeout * 1000}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                break
    finally:
        ws.close()
    res = msg.get("result", {})
    if "exceptionDetails" in res:
        raise RuntimeError(json.dumps(res["exceptionDetails"])[:2000])
    return res.get("result", {}).get("value")


def eval_in_workspace(expression: str, timeout: int = 120):
    """Evaluate JS in the logged-in Workspace Web tab."""
    return _eval(_find_page(WORKSPACE)["webSocketDebuggerUrl"], expression, timeout)


# ------------------------------------------------------------------- the token

def _jwt_exp(tok: str) -> int:
    payload = tok.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return int(json.loads(base64.urlsafe_b64decode(payload)).get("exp", 0))


def token(force: bool = False) -> str:
    """Read the RDP access token out of the Workspace tab's localStorage.

    The token lives ~10 minutes and Workspace refreshes it in place, so re-read
    it rather than holding one across a long job. Cached until 60s before expiry.
    """
    now = time.time()
    if not force and _token_cache.get("exp", 0) - 60 > now:
        return _token_cache["tok"]
    tok = eval_in_workspace('localStorage.getItem("edp-token")')
    if not tok:
        raise SystemExit(
            "No edp-token in the Workspace tab. The session is signed out — "
            "reload https://workspace.refinitiv.com/web and sign in.")
    _token_cache.update(tok=tok, exp=_jwt_exp(tok))
    if _token_cache["exp"] < now:
        raise SystemExit("edp-token is expired and Workspace has not refreshed "
                         "it. Click into the Workspace tab to wake the session.")
    return tok


# -------------------------------------------------------------- RDP REST calls

def _rdp(method: str, path: str, body: dict | None = None, timeout: int = 120):
    url = path if path.startswith("http") else RDP + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token()}",
        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1500]
        if exc.code == 401:
            raise SystemExit(f"401 from RDP — token rejected/expired: {detail}")
        if exc.code == 403:
            raise SystemExit(
                f"403 insufficient scope — this dataset is not in the Workspace "
                f"token's entitlements. Use in_page_fetch() instead.\n{detail}")
        if exc.code == 429:
            raise SystemExit(
                "429 gw.userLimit — too many requests. Batch fields into one "
                f"call instead of probing them individually.\n{detail}")
        raise SystemExit(f"HTTP {exc.code} {url}\n{detail}") from exc


def rdp_get(path: str, **params):
    if params:
        path += ("&" if "?" in path else "?") + urllib.parse.urlencode(params)
    return _rdp("GET", path)


def rdp_post(path: str, body: dict):
    return _rdp("POST", path, body)


def datagrid(universe, fields, parameters: dict | None = None):
    """`ld.get_data()` equivalent. Returns the raw RDP datagrid response."""
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(fields, str):
        fields = [fields]
    body = {"universe": list(universe), "fields": list(fields)}
    if parameters:
        body["parameters"] = parameters
    return rdp_post("/data/datagrid/beta1/", body)


def datagrid_df(universe, fields, parameters: dict | None = None):
    """datagrid() as a pandas DataFrame with the response's own column titles."""
    import pandas as pd
    resp = datagrid(universe, fields, parameters)
    if "error" in resp:
        raise SystemExit(f"datagrid error: {resp['error']}")
    cols = [h.get("title") or h.get("name") for h in resp.get("headers", [])]
    return pd.DataFrame(resp.get("data", []), columns=cols)


def history(ric: str, start: str, end: str, fields: str | None = None,
            interval: str = "P1D"):
    """Interday price history. `ld.get_history()` equivalent."""
    params = {"start": start, "end": end, "interval": interval}
    if fields:
        params["fields"] = fields
    return rdp_get(
        f"/data/historical-pricing/v1/views/interday-summaries/"
        f"{urllib.parse.quote(ric)}", **params)


def symbology(values, from_types=("RIC",), to_types=("ISIN", "CUSIP", "LEI")):
    """RIC/ISIN/CUSIP/LEI mapping. Note: CUSIP/ISIN often need a separate
    entitlement and come back as an `errors` entry rather than a hard failure."""
    if isinstance(values, str):
        values = [values]
    return rdp_post("/discovery/symbology/v1/lookup", {
        "from": [{"identifierTypes": list(from_types), "values": list(values)}],
        "to": [{"identifierTypes": list(to_types)}],
        "reference": ["name"], "type": "auto"})


def search(query: str, view: str = "SearchAll", top: int = 10, **kw):
    return rdp_post("/discovery/search/v1/",
                    {"View": view, "Query": query, "Top": top, **kw})


# --------------------------------------------------- in-page (cookie) fallback

def _origin_tab(origin: str) -> str:
    """Return a CDP ws URL for a tab on `origin`, creating one if needed."""
    host = urllib.parse.urlparse(origin).netloc
    for t in _targets():
        if t.get("type") == "page" and urllib.parse.urlparse(
                t.get("url", "")).netloc == host:
            return t["webSocketDebuggerUrl"]
    if _tab_cache.get(host):
        for t in _targets():
            if t.get("id") == _tab_cache[host]:
                return t["webSocketDebuggerUrl"]
    url = origin.rstrip("/") + "/favicon.ico"  # cheap same-origin document
    req = urllib.request.Request(
        f"http://localhost:{PORT}/json/new?" + urllib.parse.quote(url, safe=":/."),
        method="PUT")
    tab = json.loads(urllib.request.urlopen(req, timeout=15).read())
    _tab_cache[host] = tab["id"]
    time.sleep(2)
    return tab["webSocketDebuggerUrl"]


def in_page_fetch(url: str, method: str = "GET", body=None,
                  headers: dict | None = None, timeout: int = 120):
    """fetch() from inside a tab on the URL's own origin, with browser cookies.

    Use for Workspace-internal endpoints the public RDP token cannot reach.
    Cross-origin fetch from the Workspace tab is CORS-blocked, which is why this
    opens a tab on the target origin instead.
    """
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(url))
    opts = {"method": method, "credentials": "include",
            "headers": headers or {"content-type": "application/json"}}
    if body is not None:
        opts["body"] = body if isinstance(body, str) else json.dumps(body)
    js = (
        "(async()=>{try{const r=await fetch(%s,%s);const t=await r.text();"
        "return JSON.stringify({status:r.status,body:t});}"
        "catch(e){return JSON.stringify({status:0,body:'FETCH ERROR: '+e.message});}})()"
        % (json.dumps(url), json.dumps(opts)))
    raw = _eval(_origin_tab(origin), js, timeout)
    out = json.loads(raw)
    if out["status"] == 0:
        raise SystemExit(out["body"])
    try:
        out["json"] = json.loads(out["body"])
    except ValueError:
        out["json"] = None
    return out


def close_origin_tabs():
    """Close the helper tabs opened by in_page_fetch(). Never touches other tabs."""
    closed = 0
    for tab_id in list(_tab_cache.values()):
        try:
            urllib.request.urlopen(
                f"http://localhost:{PORT}/json/close/{tab_id}", timeout=10).read()
            closed += 1
        except Exception:  # noqa: BLE001  - tab already gone
            pass
    _tab_cache.clear()
    return closed


def sdc_screen(formula: str, screen: str, output: str = "col,in,t",
               product_id: str = "SDC_PLATINUM:UNITY", timeout: int = 180):
    """Resolve a deal-level SDC SCREEN to a list of deal IDs.

    This is the ONLY route to `SCREEN(U(IN(DEALS)) ...)` deal universes — the
    public datagrid API rejects them ("formula must contain at least one field").

    Returns deal IDs, NOT field values. Naming the TR.* fields in `output` does
    not work — the endpoint faults with "Output parameter '<field>' is
    unrecognized" — so the response carries the instrument column only. Feed the
    IDs to `deal_data()` to get field values. Use `sdc_deal_ids()` for the
    parsed list.
    """
    fields = [f.strip() for f in formula.split(",") if f.strip()]
    body = [{"select": {
        "cache": "Off", "formula": ",".join(fields),
        "identifiers": f"SCREEN({screen})", "lang": "en-US", "output": output,
        "productId": product_id, "titleLang": "en-US"}}]
    return in_page_fetch(
        f"{APPS_ORIGIN}/datacloud-nonviews/snapshot/rest/async?timeout=1",
        method="POST", body=body, timeout=timeout)


def sdc_deal_ids(formula: str, screen: str, **kw) -> list[str]:
    """sdc_screen() reduced to a plain list of deal ID strings."""
    r = sdc_screen(formula, screen, **kw)
    resp = (r.get("json") or {}).get("asyncResp") or [{}]
    if "fault" in resp[0]:
        faults = resp[0]["fault"].get("faults", [{}])
        raise SystemExit("SDC fault: " + str(
            faults[0].get("Description", {}).get("Value", faults[0]))[:300])
    rows = resp[0].get("select", {}).get("rows", [])
    out = []
    for row in rows:
        if row and isinstance(row[0], str):      # skip the header descriptor dict
            out.append(row[0])
    return out


def deal_data(deal_ids, fields, parameters: dict | None = None, chunk: int = 200):
    """Fetch SDC field values for deal IDs from sdc_deal_ids(), via datagrid.

    Deal IDs are passed as `<id>@DEALID`. Chunked to stay under the datagrid
    per-request data-point cap.
    """
    if isinstance(deal_ids, str):
        deal_ids = [deal_ids]
    ids = [d if d.endswith("@DEALID") else f"{d}@DEALID" for d in deal_ids]
    rows, headers = [], None
    for i in range(0, len(ids), chunk):
        r = datagrid(ids[i:i + chunk], fields, parameters)
        if "error" in r:
            raise SystemExit(f"datagrid error: {r['error']}")
        headers = headers or [h.get("title") or h.get("name") for h in r.get("headers", [])]
        rows.extend(r.get("data", []))
    return {"headers": headers, "data": rows}


# --------------------------------------------------------------------- CLI

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("token", help="print the current RDP token and its expiry")

    p = sub.add_parser("datagrid", help="ld.get_data() equivalent")
    p.add_argument("--universe", required=True, help="comma-separated RICs")
    p.add_argument("--fields", required=True, help="comma-separated TR.* fields")
    p.add_argument("--parameters", help="JSON dict, e.g. '{\"SDate\":\"0\"}'")

    p = sub.add_parser("history", help="interday price history")
    p.add_argument("ric")
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p.add_argument("--fields")

    p = sub.add_parser("symbology", help="identifier mapping")
    p.add_argument("values", help="comma-separated identifiers")
    p.add_argument("--from-types", default="RIC")
    p.add_argument("--to-types", default="ISIN,CUSIP,LEI")

    p = sub.add_parser("search", help="discovery search")
    p.add_argument("query")
    p.add_argument("--view", default="SearchAll")
    p.add_argument("--top", type=int, default=10)

    p = sub.add_parser("sdc-screen", help="deal-level SDC SCREEN -> deal IDs")
    p.add_argument("--formula", required=True)
    p.add_argument("--screen", required=True)
    p.add_argument("--ids-only", action="store_true", help="print just the deal IDs")

    p = sub.add_parser("deal-data", help="SDC field values for deal IDs")
    p.add_argument("ids", help="comma-separated deal IDs (with or without @DEALID)")
    p.add_argument("--fields", required=True)

    p = sub.add_parser("fetch", help="in-page fetch on the URL's own origin")
    p.add_argument("url")
    p.add_argument("--method", default="GET")
    p.add_argument("--body")

    a = ap.parse_args()
    if a.cmd == "token":
        tok = token()
        print(f"expires {time.strftime('%H:%M:%S', time.localtime(_jwt_exp(tok)))} "
              f"({int(_jwt_exp(tok) - time.time())}s left)", file=sys.stderr)
        print(tok)
    elif a.cmd == "datagrid":
        out = datagrid(a.universe.split(","), a.fields.split(","),
                       json.loads(a.parameters) if a.parameters else None)
        print(json.dumps(out, indent=2)[:200000])
    elif a.cmd == "history":
        print(json.dumps(history(a.ric, a.start, a.end, a.fields), indent=2)[:200000])
    elif a.cmd == "symbology":
        print(json.dumps(symbology(a.values.split(","), a.from_types.split(","),
                                   a.to_types.split(",")), indent=2))
    elif a.cmd == "search":
        print(json.dumps(search(a.query, a.view, a.top), indent=2)[:200000])
    elif a.cmd == "sdc-screen":
        if a.ids_only:
            ids = sdc_deal_ids(a.formula, a.screen)
            print(f"{len(ids)} deal IDs", file=sys.stderr)
            print("\n".join(ids))
        else:
            print(json.dumps(sdc_screen(a.formula, a.screen), indent=2)[:200000])
    elif a.cmd == "deal-data":
        print(json.dumps(deal_data(a.ids.split(","), a.fields.split(",")), indent=2)[:200000])
    elif a.cmd == "fetch":
        print(json.dumps(in_page_fetch(a.url, a.method, a.body), indent=2)[:200000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
