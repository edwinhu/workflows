"""Read the live Lex Machina session cookie out of Chromium over CDP.

Session cookies are never written to disk here; callers hold them in memory only.
"""
import json, urllib.request, websocket


def get_cookie(url="https://law.lexmachina.com/", port=9222):
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
    # Pick a page ON the target host. Taking the first page target silently returns an empty
    # cookie string when that tab is a blob:/chrome:// page, which reads as "session expired".
    from urllib.parse import urlparse
    host = urlparse(url).netloc
    pages = [t for t in targets if t["type"] == "page" and t.get("webSocketDebuggerUrl")]
    same = [t for t in pages if host in t.get("url", "") and not t["url"].startswith("blob:")]
    if not same:
        same = [t for t in pages if not t.get("url", "").startswith(("blob:", "chrome:", "devtools:"))]
    if not same:
        raise RuntimeError(f"no usable page target for {host}")
    page = same[0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
    ws.send(json.dumps({"id": 1, "method": "Network.getCookies", "params": {"urls": [url]}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            break
    ws.close()
    return "; ".join(f"{c['name']}={c['value']}" for c in msg["result"]["cookies"])


if __name__ == "__main__":
    c = get_cookie()
    print(len(c), "chars;", [p.split("=")[0] for p in c.split("; ")])
