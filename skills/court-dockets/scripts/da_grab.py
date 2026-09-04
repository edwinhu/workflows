"""Dead-simple serial Docket Alarm complaint downloader.

Deliberately boring: one thread, one request at a time, prints every row, short timeouts,
no pool and no ordered result map. The threaded version stalled reproducibly and debugging it
was costing more than rewriting it.

  python3 scripts/da_grab.py [--delay 1.5] [--limit N]
"""
import argparse, os, random, sys, time
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import requests

sys.path.insert(0, str(Path(__file__).parent))
from lm_cookie import get_cookie

HOST = "https://www.docketalarm.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/151.0.0.0 Safari/537.36")
OUT = Path("data/raw/complaints_da")
ABORT = {402, 407, 429}

ap = argparse.ArgumentParser()
ap.add_argument("--delay", type=float, default=1.5)
ap.add_argument("--limit", type=int, default=None)
a = ap.parse_args()

OUT.mkdir(parents=True, exist_ok=True)
rows = pl.read_parquet("data/raw/da_docket_metadata.parquet").to_dicts()
if a.limit:
    rows = rows[:a.limit]

s = requests.Session()
s.headers.update({"User-Agent": UA})
for part in get_cookie(f"{HOST}/").split("; "):
    k, _, v = part.partition("=")
    s.cookies.set(k, v, domain="www.docketalarm.com")

res, t0 = [], time.time()
for i, r in enumerate(rows, 1):
    ca = r["ca_number"]
    dest = OUT / f"{ca}.pdf"
    rec = dict(ca_number=ca, doc_id=r.get("complaint_doc_id"), http_status=None,
               bytes=None, ok=False, error=None,
               retrieved_at=datetime.now(timezone.utc).isoformat())
    if dest.exists():
        rec.update(ok=True, error="already_present", bytes=dest.stat().st_size)
    elif not r.get("resolved_url") or not r.get("complaint_doc_id"):
        rec["error"] = "no doc id"
    else:
        url = r["resolved_url"].rstrip("/") + f"/docs/{r['complaint_doc_id']}.pdf"
        try:
            resp = s.get(url, params={"download": "true"}, timeout=45)
            rec.update(http_status=resp.status_code, bytes=len(resp.content))
            if resp.status_code in ABORT:
                print(f"ABORT: HTTP {resp.status_code} on {ca}", flush=True)
                break
            if resp.status_code == 200 and resp.content[:5] == b"%PDF-":
                dest.write_bytes(resp.content)
                rec["ok"] = True
            else:
                rec["error"] = f"http {resp.status_code}"
        except Exception as e:
            rec["error"] = f"{type(e).__name__}"
        time.sleep(a.delay + random.uniform(0, a.delay))
    res.append(rec)
    if i % 20 == 0 or not rec["ok"]:
        nok = sum(x["ok"] for x in res)
        print(f"[{i}/{len(rows)}] ok={nok} fail={len(res)-nok} "
              f"{ca} {rec['error'] or 'ok'} ({time.time()-t0:.0f}s)", flush=True)

pl.DataFrame(res, infer_schema_length=None).write_parquet("data/raw/da_pdf_manifest.parquet")
nok = sum(x["ok"] for x in res)
print(f"\nwrote data/raw/da_pdf_manifest.parquet rows={len(res)} ok={nok} fail={len(res)-nok}")
