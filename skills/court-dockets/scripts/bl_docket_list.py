#!/usr/bin/env python3
"""Collect a complete Bloomberg Law docket LIST (metadata only) for any facet + term search.

Purpose: turn "every Court Docket matching these facets/term" into items.jsonl + dockets.csv with
one row per docket id, provably complete against the API's own remote_count. No PDF or docket
entry is fetched. Generalised from the Delaware Chancery pull (25,874 dockets, year-sliced) and
the Nevada Clark/Washoe pull (4 term searches, 3,923 dockets).

Auth: none handled here. Every request is a same-origin fetch() run by CDP Runtime.evaluate inside
the user's already-signed-in Bloomberg Law tab (any tab whose URL starts with
https://www.bloomberglaw.com/). The script never navigates, never opens a tab or a login page,
never reads credentials. The HttpOnly accessToken lives ~8 min and only that tab refreshes it.

Usage (each prints the final remote_count line; exit 0 only if distinct ids == remote_count):
    # 1. find the facet codes (prints every facet field, value code, label and count)
    bl_docket_list.py --discover --facet state_court_county_id=84,85
    # 2. size it without collecting
    bl_docket_list.py --count-only --facet state_court_county_id=84,85 --term '"NRS Chapters 78-89"'
    # Delaware Chancery, whole court (25,874 dockets; year-sliced automatically)
    bl_docket_list.py --facet court_id=41 --out chancery --csv
    #   (the Chancery pull used the legacy criteria "sources":["105.100933"]; pass --source 105.100933)
    # Nevada Clark + Washoe business-court searches (Nevada=29, Clark=84, Washoe=85)
    bl_docket_list.py --facet state_court_county_id=84,85 --term '"NRS Chapters 78-89"' --out nv_A --csv
    bl_docket_list.py --facet state_court_county_id=84,85 --term '"Business Court"' --out nv_D --csv

TERM QUOTING CHANGES RESULTS. --term is sent verbatim. Measured 2026-10-09 (Clark+Washoe):
"Business Court" -> 3,690 but Business Court -> 17,180; "Securities (NRS 90)" -> 58 but unquoted 65;
"derivatively" -> 51 but derivatively -> 281; NRS Chapters 78-89 is 481 either way. Quote in the
shell ('"..."') when you mean the exact phrase, and record the term string with the result.

THE TWO SILENT CAPS (neither raises an error):
  1. Paging: a window whose last index page*page_size exceeds 10,000 returns HTTP 201 with the
     `documents` component simply absent. This script slices by filing date whenever
     remote_count > 9,000 (halving a slice that is still too big, down to single days).
  2. CSV export (/results/csv/view/{criteria_id}): truncates at 1,000 data rows. --csv exports
     only leaves whose remote_count is under 950 and asserts CSV id set == paged id set.

Checkpoint: <out>/_checkpoint.jsonl (append-only, fsynced; a truncated last line is dropped). A
rerun with the same criteria resumes; changed criteria abort rather than mix two searches.
Pacing is serial with jitter (2.5-4.5 s, 10-18 s every 12 requests). Aborts on HTTP 429/402,
repeated 401/403, or HTML where JSON was expected (a login page).
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import pathlib
import random
import re
import sys
import time
import urllib.request

BL_PREFIX = "https://www.bloomberglaw.com/"
SEARCH_URL = "/product/blaw/api/v1/search/criteria"
CSV_URL = "/results/csv/view/{}"
PAGE_SIZE = 100
MAX_WINDOW = 10000        # measured wall: page*page_size must not exceed this
SLICE_MAX = 9000          # slice by date above this remote_count, to stay clear of the wall
CSV_CAP_SAFE = 950        # the silent CSV cap is 1,000; export only below this
TOP_LEVEL_KEYS = {"docket_entry_filing_type", "viewable_attachments"}  # criteria keys, not facets
CSV_PREAMBLE_LINES = 2    # the export has a 2-line preamble; the header is line 3


class Abort(Exception):
    pass


# --------------------------------------------------------------------------- pure logic (tested)

def window_ok(page, page_size):
    return page * page_size <= MAX_WINDOW


def needs_slicing(remote_count, cap=SLICE_MAX):
    return remote_count > cap


def midpoint(lo, hi):
    return dt.date.fromordinal((lo.toordinal() + hi.toordinal()) // 2)


def split_slice(lo, hi):
    """Halve an inclusive date range; None when it is a single day and cannot be split."""
    if lo >= hi:
        return None
    mid = midpoint(lo, hi)
    return (lo, mid), (mid + dt.timedelta(days=1), hi)


def plan_leaves(probe, cap, year_lo, year_hi):
    """Date slices to collect, each with remote_count <= cap, from probe(lo, hi) -> remote_count.

    probe(None, None) is the unsliced search: if it is already <= cap the plan is [None].
    Single days still over the cap are kept (and reported by the caller), never dropped.
    """
    total = probe(None, None)
    if not needs_slicing(total, cap):
        return [None]
    leaves = []
    stack = [(dt.date(y, 1, 1), dt.date(y, 12, 31)) for y in range(year_lo, year_hi + 1)]
    while stack:
        lo, hi = stack.pop(0)
        rc = probe(lo, hi)
        if rc == 0:
            continue
        halves = split_slice(lo, hi) if needs_slicing(rc, cap) else None
        if halves:
            stack = list(halves) + stack
        else:
            leaves.append((lo, hi))
    return leaves


def slice_key(leaf):
    return "all" if leaf is None else f"{leaf[0].isoformat()}..{leaf[1].isoformat()}"


def parse_csv_export(text):
    """Rows of a BL docket CSV export: 2 preamble lines, header on line 3."""
    parts = text.lstrip("﻿").split("\n", CSV_PREAMBLE_LINES)
    if len(parts) <= CSV_PREAMBLE_LINES:
        return [], []
    reader = csv.reader(io.StringIO(parts[CSV_PREAMBLE_LINES]))
    header = next(reader, None)
    if not header:
        return [], []
    rows = [dict(zip(header, r)) for r in reader if any(c.strip() for c in r)]
    return header, rows


def docket_id_from_url(url):
    return url.rstrip("/").rsplit("/", 1)[-1]


def check_id_sets(paged_ids, csv_ids):
    """Raise unless the CSV and paged id sets are identical."""
    paged, csv_ = set(paged_ids), set(csv_ids)
    if paged != csv_:
        raise AssertionError(
            f"CSV id set != paged id set (csv-only {len(csv_ - paged)}, paged-only "
            f"{len(paged - csv_)}); csv-only sample {sorted(csv_ - paged)[:5]}, "
            f"paged-only sample {sorted(paged - csv_)[:5]}")


TITLE_RE = re.compile(r"Docket No\.\s*(?P<dn>.+?)\s*\((?P<court>.+?)\s+(?P<date>[A-Z][a-z]{2} \d{1,2}, \d{4})\),\s*Court Docket\s*$")


def flatten_item(item):
    md = {d["key"]: d["value"] for d in item.get("metadata") or []}
    m = TITLE_RE.search(item.get("title") or "")
    return {
        "bl_docket_id": item.get("id"),
        "entity_id": item.get("entity_id"),
        "title": item.get("title"),
        "docket_number": m.group("dn") if m else None,
        "court": m.group("court") if m else None,
        "date_filed_iso": (item.get("date") or "")[:10] or None,
        "case_type": (md.get("case_type") or [None])[0],
        "judge": "; ".join(md.get("judge") or []) or None,
        "parties": "; ".join(md.get("party") or []) or None,
        "last_updated": (md.get("docket_last_received_from_source") or [None])[0],
    }


def parse_facet_args(specs):
    """['state_court_county_id=84,85', ...] -> {'state_court_county_id': ['84','85']}; content_kind=2 default."""
    facets = {}
    for s in specs or []:
        field, sep, vals = s.partition("=")
        if not sep or not field or not vals:
            raise SystemExit(f"--facet needs FIELD=V1,V2 (got {s!r})")
        facets.setdefault(field.strip(), []).extend(v.strip() for v in vals.split(",") if v.strip())
    facets.setdefault("content_kind", ["2"])
    return facets


def build_criteria(facets, term, sources, page, page_size, lo=None, hi=None):
    top = {k: v for k, v in facets.items() if k in TOP_LEVEL_KEYS}
    c = {"facets": {k: v for k, v in facets.items() if k not in TOP_LEVEL_KEYS},
         "term": term, "sources": list(sources), "content_type": "Court Dockets",
         "model": "features_docket_search_v3", "page": page, "page_size": page_size,
         "inferred_filters": {}, "bucket": False, **top}
    if lo is not None:
        c.update({"date_type": "date_range", "start_date": _ms(lo), "end_date": _ms(hi)})
    return {"criteria": c, "user_activity": "select_filters"}


def _ms(d):
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000)


def render_facets(facet_component):
    """Lines describing every facet field with its value codes, labels and counts."""
    lines = []
    for f in facet_component.get("items", []):
        flag = " [hidden]" if f.get("hidden") else ""
        lines.append(f"{f.get('field')}  ({(f.get('title') or '').strip()}){flag}")
        for v in f.get("items", []):
            sel = " *selected*" if v.get("selected") else ""
            lines.append(f"    {v.get('value')!s:<8} {v.get('label') or '(blank)'}  "
                         f"count={v.get('count')}{sel}")
    return lines


# --------------------------------------------------------------------------- CDP transport

FETCH_JS = r"""
(async () => {
  const csrf = decodeURIComponent(
    (document.cookie.match(/(?:^|;\s*)CSRF-TOKEN=([^;]*)/) || [])[1] || '');
  const opts = %(opts)s;
  const headers = {'Accept': 'application/json, text/plain, */*',
                   'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf};
  if (opts.body !== undefined && opts.body !== null) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(%(url)s, {method: opts.method || 'GET', headers: headers,
      credentials: 'same-origin', redirect: 'follow',
      body: (opts.body === undefined || opts.body === null) ? undefined : JSON.stringify(opts.body)});
  } catch (e) { return {net_error: String(e)}; }
  const t = await r.text();
  return {status: r.status, ctype: r.headers.get('content-type') || '', text: t};
})()
"""


class Tab:
    def __init__(self, port):
        import websocket  # deferred: the pure logic above must import without it
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
        hits = [t for t in targets if t["type"] == "page" and t["url"].startswith(BL_PREFIX)
                and t.get("webSocketDebuggerUrl")]
        if not hits:
            raise Abort(f"no open tab at {BL_PREFIX}* on CDP port {port}; refusing to open one")
        self.url = hits[0]["url"]
        self._ws_url = hits[0]["webSocketDebuggerUrl"]
        self._websocket = websocket
        self.ws = websocket.create_connection(self._ws_url, timeout=180, max_size=None)
        self._id = 0

    def reconnect(self):
        self.close()
        self.ws = self._websocket.create_connection(self._ws_url, timeout=180, max_size=None)

    def evaluate(self, expr, timeout=180):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": "Runtime.evaluate",
                                 "params": {"expression": expr, "awaitPromise": True,
                                            "returnByValue": True, "userGesture": True}}))
        self.ws.settimeout(timeout)
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                break
        if "error" in msg:
            raise RuntimeError(msg["error"])
        res = msg["result"]
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"])[:2000])
        return res["result"].get("value")

    def close(self):
        try:
            self.ws.close()
        except OSError as ex:
            print(f"   (ws close failed: {ex})", flush=True)


class Client:
    """Serial, paced, guarded requests through the signed-in tab."""

    def __init__(self, port):
        self.tab = Tab(port)
        self.n = 0
        self.denied = 0

    def close(self):
        self.tab.close()

    def _fetch(self, url, method="GET", body=None, tries=3):
        opts = {"method": method, "body": body}
        expr = FETCH_JS % {"url": json.dumps(url), "opts": json.dumps(opts)}
        for attempt in range(1, tries + 1):
            try:
                return self.tab.evaluate(expr)
            except Exception as ex:  # websocket timeout carries no HTTP status: transport, not a block
                print(f"   CDP transport error ({type(ex).__name__}: {str(ex)[:120]}) "
                      f"attempt {attempt}/{tries}", flush=True)
                if attempt == tries:
                    raise
                time.sleep(random.uniform(20, 40))
                self.tab.reconnect()
        raise Abort(f"no response from the tab after {tries} attempts")

    def request(self, url, what, method="GET", body=None, expect_json=True):
        time.sleep(random.uniform(2.5, 4.5))
        r = self._fetch(url, method, body)
        st, ct = r.get("status"), (r.get("ctype") or "")
        if r.get("net_error"):
            raise Abort(f"net_error on {what}: {r['net_error']}")
        if st in (429, 402):
            raise Abort(f"HTTP {st} on {what}: {(r.get('text') or '')[:300]}")
        if st in (401, 403):
            self.denied += 1
            if self.denied >= 2:
                raise Abort(f"repeated HTTP {st} on {what}")
            print(f"   HTTP {st} on {what}; pausing and retrying once", flush=True)
            time.sleep(random.uniform(20, 35))
            return self.request(url, what, method, body, expect_json)
        self.denied = 0
        if expect_json and "text/html" in ct:
            raise Abort(f"HTML instead of JSON on {what} (HTTP {st}): session looks signed out")
        if st not in (200, 201):
            raise Abort(f"HTTP {st} on {what}: {(r.get('text') or '')[:200]}")
        self.n += 1
        if self.n % 12 == 0:
            time.sleep(random.uniform(10, 18))
        return r

    def search(self, criteria, what):
        r = self.request(SEARCH_URL, what, "POST", criteria)
        d = json.loads(r["text"])
        comps = d.get("results_page", {}).get("components", {})
        docs = comps.get("documents")
        return {"criteria_id": d.get("id"), "docs": docs, "facets": comps.get("facets"),
                "components": list(comps)}

    def csv(self, criteria_id, what):
        r = self.request(CSV_URL.format(criteria_id), what, expect_json=False)
        if "text/html" in (r.get("ctype") or ""):
            raise Abort(f"HTML instead of CSV on {what}: session looks signed out")
        return r["text"]


# --------------------------------------------------------------------------- collection

def read_jsonl(path):
    out = []
    if path.exists():
        for line in path.read_text(errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"   checkpoint: dropping a malformed (truncated) line in {path.name}",
                      flush=True)
    return out


def append_jsonl(path, rec):
    with path.open("a") as fh:
        fh.write(json.dumps(rec) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


class Collector:
    def __init__(self, client, args, facets, outdir):
        self.c, self.args, self.facets, self.out = client, args, facets, outdir
        self.ckpt = outdir / "_checkpoint.jsonl"
        self.csv_dir = outdir / "csv"
        sig = {"facets": facets, "term": args.term, "sources": args.source}
        recs = read_jsonl(self.ckpt)
        cfg = [r for r in recs if r["kind"] == "config"]
        if cfg and cfg[0]["sig"] != sig:
            raise Abort(f"{self.ckpt} belongs to a different search {cfg[0]['sig']}; "
                        f"use a new --out or delete it")
        if not cfg:
            append_jsonl(self.ckpt, {"kind": "config", "sig": sig})
        self.probes = {r["slice"]: r for r in recs if r["kind"] == "probe"}
        self.pages = {(r["slice"], r["page"]) for r in recs if r["kind"] == "page"}
        self.exports = {r["slice"]: r for r in recs if r["kind"] == "export"}

    def criteria(self, page, page_size, leaf):
        lo, hi = (None, None) if leaf is None else leaf
        return build_criteria(self.facets, self.args.term, self.args.source, page, page_size, lo, hi)

    def probe(self, leaf):
        """Page-1 search of a slice, cached. Saves page 1 so paging never repeats it."""
        key = slice_key(leaf)
        if key in self.probes:
            return self.probes[key]
        res = self.c.search(self.criteria(1, PAGE_SIZE, leaf), f"probe {key}")
        docs = res["docs"]
        # page 1 cannot hit the 10,000 wall, so an absent component means zero hits
        rc = 0 if docs is None else docs.get("remote_count") or 0
        rec = {"kind": "probe", "slice": key, "criteria_id": res["criteria_id"], "remote_count": rc}
        append_jsonl(self.ckpt, rec)
        if docs is not None:
            items = docs.get("items") or []
            append_jsonl(self.ckpt, {"kind": "page", "slice": key, "page": 1, "n": len(items),
                                     "items": items})
            self.pages.add((key, 1))
        self.probes[key] = rec
        print(f"   {key}: remote_count={rc}", flush=True)
        return rec

    def rc(self, lo=None, hi=None):
        return self.probe(None if lo is None else (lo, hi))["remote_count"]

    def collect_pages(self, leaves):
        for leaf in leaves:
            key = slice_key(leaf)
            rc = self.probe(leaf)["remote_count"]
            npages = -(-rc // PAGE_SIZE)
            if not window_ok(npages, PAGE_SIZE):
                raise Abort(f"slice {key}: {rc} results need {npages} pages, past the "
                            f"{MAX_WINDOW} wall (a single day this large cannot be split)")
            for page in range(1, npages + 1):
                if (key, page) in self.pages:
                    continue
                res = self.c.search(self.criteria(page, PAGE_SIZE, leaf),
                                    f"{key} page {page}/{npages}")
                if res["docs"] is None:
                    raise Abort(f"{key} page {page}: documents component absent "
                                f"(window {page * PAGE_SIZE}); refusing to write a short list")
                items = res["docs"].get("items") or []
                append_jsonl(self.ckpt, {"kind": "page", "slice": key, "page": page,
                                         "n": len(items), "items": items})
                self.pages.add((key, page))
                print(f"   {key} page {page}/{npages}: {len(items)} items", flush=True)

    def collect_csv(self):
        self.csv_dir.mkdir(parents=True, exist_ok=True)
        leaves = plan_leaves(self.rc, CSV_CAP_SAFE,
                             self.args.year_lo, self.args.year_hi)
        for leaf in leaves:
            key = slice_key(leaf)
            fn = self.csv_dir / (re.sub(r"[^0-9A-Za-z.]+", "_", key) + ".csv")
            if key in self.exports and fn.exists():
                continue
            probe = self.probe(leaf)
            if probe["remote_count"] == 0:
                continue
            txt = self.c.csv(probe["criteria_id"], f"CSV {key} rc={probe['remote_count']}")
            fn.write_text(txt)
            append_jsonl(self.ckpt, {"kind": "export", "slice": key, "file": fn.name,
                                     "remote_count": probe["remote_count"]})
            self.exports[key] = {"file": fn.name}
            print(f"   CSV {key}: {len(txt)} chars", flush=True)
        return leaves

    def paged_items(self):
        items = {}
        for r in read_jsonl(self.ckpt):
            if r["kind"] == "page":
                for it in r["items"]:
                    items.setdefault(it["id"], it)
        return items

    def csv_rows(self, leaves):
        rows = {}
        for leaf in leaves:
            key = slice_key(leaf)
            if self.probes[key]["remote_count"] == 0:
                continue
            _, parsed = parse_csv_export((self.csv_dir / self.exports[key]["file"]).read_text())
            for row in parsed:
                rows.setdefault(docket_id_from_url(row.get("Document URL", "")), row)
        return rows


def run_collect(args, facets):
    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    client = Client(args.port)
    try:
        col = Collector(client, args, facets, outdir)
        total = col.rc()
        print(f"remote_count {total} (unsliced)", flush=True)
        leaves = plan_leaves(col.rc, SLICE_MAX,
                             args.year_lo, args.year_hi)
        print(f"{len(leaves)} slice(s) to page", flush=True)
        col.collect_pages(leaves)
        csv_leaves = col.collect_csv() if args.csv else None
    finally:
        client.close()

    items = col.paged_items()
    ids = sorted(items)
    with (outdir / "items.jsonl").open("w") as fh:
        for i in ids:
            fh.write(json.dumps(items[i]) + "\n")
    rows = {i: flatten_item(items[i]) for i in ids}
    csv_extra = {}
    if csv_leaves is not None:
        csv_rows = col.csv_rows(csv_leaves)
        check_id_sets(ids, csv_rows)
        csv_extra = csv_rows
    cols = list(next(iter(rows.values())).keys()) if rows else []
    csv_cols = list(next(iter(csv_extra.values())).keys()) if csv_extra else []
    with (outdir / "dockets.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols + [f"csv_{c}" for c in csv_cols])
        for i in ids:
            w.writerow([rows[i][c] for c in cols] + [csv_extra.get(i, {}).get(c, "") for c in csv_cols])
    print(f"remote_count {total} distinct_ids {len(ids)}"
          + (f" csv_ids {len(csv_extra)} (== paged ids)" if csv_leaves is not None else ""))
    print(f"wrote {outdir / 'items.jsonl'} and {outdir / 'dockets.csv'}")
    if len(ids) != total:
        print(f"MISMATCH: distinct ids {len(ids)} != remote_count {total}", file=sys.stderr)
        return 1
    return 0


def run_single(args, facets, discover):
    client = Client(args.port)
    try:
        body = build_criteria(facets, args.term, args.source, 1, 1)
        res = client.search(body, "discover" if discover else "count")
    finally:
        client.close()
    docs = res["docs"]
    rc = 0 if docs is None else docs.get("remote_count") or 0
    if discover:
        print("# Counts inside a facet's own field are not narrowed by that facet (selected values read 0).")
        for line in render_facets(res["facets"] or {}):
            print(line)
    print(f"remote_count {rc}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Bloomberg Law docket-list collector (metadata only)")
    p.add_argument("--facet", action="append", metavar="FIELD=V1,V2",
                   help="repeatable; content_kind=2 is added unless given")
    p.add_argument("--term", default="", help="search text, sent verbatim (quoting changes results)")
    p.add_argument("--source", action="append", default=[], help="criteria `sources` id (repeatable)")
    p.add_argument("--out", help="output directory (items.jsonl, dockets.csv, _checkpoint.jsonl)")
    p.add_argument("--csv", action="store_true", help="also take the 41-column CSV export")
    p.add_argument("--discover", action="store_true", help="print every facet field/code/label/count")
    p.add_argument("--count-only", action="store_true", help="print remote_count and stop")
    p.add_argument("--port", type=int, default=9222)
    p.add_argument("--year-lo", type=int, default=1990)
    p.add_argument("--year-hi", type=int, default=dt.datetime.now(tz=dt.timezone.utc).year)
    args = p.parse_args(argv)
    facets = parse_facet_args(args.facet)
    try:
        if args.discover or args.count_only:
            return run_single(args, facets, args.discover)
        if not args.out:
            p.error("--out is required unless --discover or --count-only")
        return run_collect(args, facets)
    except Abort as ex:
        print(f"ABORT: {ex}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
