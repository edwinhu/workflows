#!/usr/bin/env python3
"""Assemble dumped capture batches into one JSONL and PROVE completeness.

Exits non-zero if the capture is not provably complete. That exit code is the gate:
a capture you cannot prove complete is not a dataset.

    python3 assemble.py --batches DIR --glob 'batch_*.json' --out cases.jsonl \
        --expect-total 16670 --page-size 25 [--id-field id] [--first-page FILE.json]
"""
import argparse, glob, json, os, sys, collections

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batches", required=True)
    ap.add_argument("--glob", default="batch_*.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect-total", type=int, required=True)
    ap.add_argument("--page-size", type=int, required=True)
    ap.add_argument("--id-field", default="id")
    ap.add_argument("--first-page", help="raw response JSON holding the page the hook missed")
    a = ap.parse_args()

    pages = []
    if a.first_page:
        j = json.load(open(a.first_page))
        # tolerate either a raw API response or an already-shaped page
        rows = j.get("rows") or j.get("result")
        start = j.get("start", 0)
        pages.append({"start": start, "rows": rows})
    for f in sorted(glob.glob(os.path.join(a.batches, a.glob))):
        pages += json.load(open(f))

    if not pages:
        print("FAIL: no pages found", file=sys.stderr); return 1

    starts = [p["start"] for p in pages]
    c = collections.Counter(starts)
    dups = {s: n for s, n in c.items() if n > 1}
    expected = set(range(0, max(starts) + 1, a.page_size))
    gaps = sorted(expected - set(starts))
    rows = [r for p in pages for r in p["rows"]]
    ids = collections.Counter(r.get(a.id_field) for r in rows)
    dup_ids = {k: v for k, v in ids.items() if v > 1}

    print(f"pages={len(pages)} unique_starts={len(c)} dup_starts={len(dups)}")
    print(f"gaps={len(gaps)} {gaps[:10]}")
    print(f"rows={len(rows):,} unique_{a.id_field}={len(ids):,} dup_ids={len(dup_ids)}")
    print(f"expected_total={a.expect_total:,}")

    bad = []
    if dups:        bad.append(f"{len(dups)} duplicate page offsets")
    if gaps:        bad.append(f"{len(gaps)} missing page offsets")
    if dup_ids:     bad.append(f"{len(dup_ids)} duplicate record ids")
    if len(rows) != a.expect_total:
        bad.append(f"row count {len(rows):,} != expected {a.expect_total:,}")
    if bad:
        print("FAIL: " + "; ".join(bad), file=sys.stderr); return 1

    with open(a.out, "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    print(f"OK: complete. [out] {a.out}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
