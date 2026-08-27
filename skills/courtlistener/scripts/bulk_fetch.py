#!/usr/bin/env python3
"""Stream a CourtListener bulk opinions file and keep only selected clusters.

Never materialises the 54 GB opinions CSV. Filter opinion-clusters first (22x smaller,
carries court + date_filed + docket_number), then stream opinions and match on cluster id.

    # 1. what snapshots exist
    python3 bulk_fetch.py list

    # 2. cluster ids for one court and window (downloads ~2.5 GB, streams it)
    python3 bulk_fetch.py clusters --date 2026-06-30 --court delch \
        --after 2012-01-01 --out clusters_delch.csv

    # 3. opinion text for those clusters (streams ~55 GB, writes only matches)
    python3 bulk_fetch.py opinions --date 2026-06-30 --clusters clusters_delch.csv \
        --out opinions_delch.csv
"""
import argparse, bz2, csv, io, re, sys, urllib.request

BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com"
UA = "empirical legal research (contact: see project README)"

def _open(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req)

def cmd_list(a):
    with _open(f"{BASE}/?list-type=2&prefix=bulk-data/&max-keys=1000") as r:
        x = r.read().decode()
    rows = list(zip(re.findall(r"<Key>(.*?)</Key>", x), re.findall(r"<Size>(\d+)</Size>", x)))
    seen = {}
    for k, s in rows:
        m = re.match(r"bulk-data/(.+?)-(\d{4}-\d{2}-\d{2})\.csv\.bz2$", k)
        if m and m.group(2) >= seen.get(m.group(1), ("", ))[0]:
            seen[m.group(1)] = (m.group(2), int(s))
    for name, (date, size) in sorted(seen.items()):
        print(f"  {size/1e9:8.2f} GB  {name:24s} latest {date}")
    return 0

def _stream_csv(url):
    """Yield dict rows from a remote .csv.bz2 without landing it on disk."""
    with _open(url) as resp:
        dec = bz2.BZ2Decompressor()
        buf, head, rdr = "", None, None
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            buf += dec.decompress(chunk).decode("utf-8", "replace")
            *lines, buf = buf.split("\n")
            if head is None and lines:
                head = next(csv.reader([lines[0]])); lines = lines[1:]
            if head:
                for row in csv.reader(lines):
                    if row: yield dict(zip(head, row))
        if buf.strip() and head:
            for row in csv.reader([buf]):
                if row: yield dict(zip(head, row))

def cmd_clusters(a):
    url = f"{BASE}/bulk-data/opinion-clusters-{a.date}.csv.bz2"
    n = kept = 0
    with open(a.out, "w", newline="") as fh:
        w = None
        for row in _stream_csv(url):
            n += 1
            if a.court and row.get("court_id") != a.court: continue
            d = row.get("date_filed") or ""
            if a.after and d < a.after: continue
            if a.before and d > a.before: continue
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(row)); w.writeheader()
            w.writerow(row); kept += 1
            if n % 500000 == 0: print(f"  scanned {n:,} kept {kept:,}", file=sys.stderr)
    print(f"scanned {n:,} clusters, kept {kept:,} -> {a.out}")
    return 0 if kept else 1

def cmd_opinions(a):
    ids = {r["id"] for r in csv.DictReader(open(a.clusters))}
    print(f"matching {len(ids):,} cluster ids", file=sys.stderr)
    url = f"{BASE}/bulk-data/opinions-{a.date}.csv.bz2"
    n = kept = 0
    with open(a.out, "w", newline="") as fh:
        w = None
        for row in _stream_csv(url):
            n += 1
            if row.get("cluster_id") not in ids: continue
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(row)); w.writeheader()
            w.writerow(row); kept += 1
            if n % 500000 == 0: print(f"  scanned {n:,} kept {kept:,}", file=sys.stderr)
    print(f"scanned {n:,} opinions, kept {kept:,} -> {a.out}")
    return 0 if kept else 1

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    c = sub.add_parser("clusters")
    c.add_argument("--date", required=True); c.add_argument("--court")
    c.add_argument("--after"); c.add_argument("--before"); c.add_argument("--out", required=True)
    o = sub.add_parser("opinions")
    o.add_argument("--date", required=True); o.add_argument("--clusters", required=True)
    o.add_argument("--out", required=True)
    a = ap.parse_args()
    return {"list": cmd_list, "clusters": cmd_clusters, "opinions": cmd_opinions}[a.cmd](a)

if __name__ == "__main__":
    sys.exit(main())
