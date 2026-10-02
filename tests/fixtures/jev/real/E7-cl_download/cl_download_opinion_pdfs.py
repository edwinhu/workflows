# --- excerpt: source lines 1-88 ---
"""Download candidate opinion PDFs from storage.courtlistener.com and extract text.

storage.courtlistener.com serves the PDF named by `opinions[].local_path` with no token. It is
the only unauthenticated route to full opinion text: /api/rest/v4/opinions/ returns 401 and the
www HTML page returns a 202 WAF challenge.

Resumable: a PDF already on disk is not re-fetched; text already extracted is not re-extracted.
"""

import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "data/raw/courtlistener_delch_opinion_pdfmeta.jsonl"
PDFDIR = ROOT / "data/raw/cl_opinion_pdfs"
OUT = ROOT / "data/raw/courtlistener_delch_opinion_pdftext.jsonl"
BASE = "https://storage.courtlistener.com/"
UA = "board-structuring-research/1.0 (academic; contact redacted)"
WORKERS = 4
DELAY = 0.75  # per-worker courtesy sleep -> ~5 req/s ceiling across the pool

STATS = {"fetched": 0, "cached": 0, "fail": 0, "throttled": 0}


def fetch(args):
    opid, path = args
    dest = PDFDIR / f"{opid}.pdf"
    if dest.exists() and dest.stat().st_size > 1000:
        STATS["cached"] += 1
        return opid, "cached", dest.stat().st_size
    delay = 5.0
    for _ in range(5):
        try:
            r = requests.get(BASE + path, headers={"User-Agent": UA}, timeout=120)
        except requests.RequestException as e:
            print(f"  {opid}: {e}", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            dest.write_bytes(r.content)
            STATS["fetched"] += 1
            time.sleep(DELAY)
            return opid, "ok", len(r.content)
        if r.status_code == 429 or r.status_code >= 500:
            STATS["throttled"] += 1
            print(f"  {opid}: HTTP {r.status_code} -> backoff {delay:.0f}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        STATS["fail"] += 1
        return opid, f"http{r.status_code}", 0
    STATS["fail"] += 1
    return opid, "giveup", 0


def main():
    meta = [json.loads(l) for l in META.open() if l.strip()]
    PDFDIR.mkdir(parents=True, exist_ok=True)

    jobs, cl_of = [], {}
    for r in meta:
        if r.get("missing"):
            continue
        for o in r["opinions"]:
            if o.get("local_path"):
                jobs.append((o["id"], o["local_path"]))
                cl_of.setdefault(r["cluster_id"], []).append(o["id"])
    jobs = sorted(set(jobs))
    print(f"opinion pdfs to ensure: {len(jobs)} across {len(cl_of)} clusters", flush=True)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for n, (opid, st, _) in enumerate(ex.map(fetch, jobs), 1):
            if st not in ("ok", "cached"):
                print(f"  FAIL {opid} {st}", flush=True)
            if n % 50 == 0:
                print(f"  {n}/{len(jobs)} {STATS}", flush=True)
    print(f"download {STATS} elapsed={time.time() - t0:.0f}s", flush=True)

    # Extract text; one row per cluster, opinions concatenated in stable id order.
    n_ok = n_empty = 0
