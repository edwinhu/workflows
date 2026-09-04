"""Download the opinion PDFs identified in opinion_plan.parquet (Lex primary, DA fallback).

Reuses the proven complaint pipelines: Lex mints a 1-hour signed GCS URL per document; Docket
Alarm serves a durable path. Serial and paced -- these are subscription accounts.
"""
import random, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
import polars as pl, requests

sys.path.insert(0, "scripts")
from lm_cookie import get_cookie

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/151.0.0.0 Safari/537.36")
OUT = Path("data/raw/opinion_pdfs"); OUT.mkdir(parents=True, exist_ok=True)
ABORT = {402, 407, 429}


def sess(host):
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
    for part in get_cookie(f"https://{host}/").split("; "):
        k, _, v = part.partition("=")
        if k:
            s.cookies.set(k, v, domain=host)
    return s


def main():
    delay = float(sys.argv[1]) if len(sys.argv) > 1 else 2.5
    plan = pl.read_parquet("data/processed/opinion_plan.parquet").to_dicts()
    lex = sess("law.lexmachina.com")
    da = None
    rows = []
    for i, r in enumerate(plan, 1):
        ca, src = r["ca_number"], r["source"]
        dest = OUT / f"{ca}__{r['document_id']}.pdf"
        rec = dict(ca_number=ca, source=src, document_id=r["document_id"],
                   title=r.get("title"), ok=False, bytes=None, http=None, error=None,
                   local_path=None, retrieved_at=datetime.now(timezone.utc).isoformat())
        if dest.exists() and dest.stat().st_size > 2000:
            rec.update(ok=True, bytes=dest.stat().st_size, local_path=str(dest), error="cached")
            rows.append(rec); continue
        try:
            if src == "lex":
                resp = lex.get(f"https://law.lexmachina.com/state-court/documents/{r['document_id']}/pdf",
                               params={"document_file_id": r["file_id"]}, timeout=180)
            else:
                if da is None:
                    da = sess("www.docketalarm.com")
                resp = da.get(f"https://www.docketalarm.com{r['title']}" if str(r["title"]).startswith("/")
                              else f"https://www.docketalarm.com/cases/Delaware_State_Court_of_Chancery/"
                                   f"{ca.split('-')[0]}/docs/{r['document_id']}.pdf",
                              params={"download": "true"}, timeout=180)
            rec["http"] = resp.status_code
            if resp.status_code in ABORT:
                rec["error"] = f"ABORT {resp.status_code}"; rows.append(rec)
                print(f"  ABORT: HTTP {resp.status_code} on {ca}", flush=True); break
            if resp.status_code == 200 and resp.content[:5] == b"%PDF-":
                dest.write_bytes(resp.content)
                rec.update(ok=True, bytes=len(resp.content), local_path=str(dest))
            else:
                rec["error"] = f"non-pdf {resp.status_code}"
        except Exception as e:
            rec["error"] = type(e).__name__
        rows.append(rec)
        time.sleep(delay + random.uniform(0, delay))
        if i % 25 == 0:
            n = sum(x["ok"] for x in rows)
            print(f"  [{i}/{len(plan)}] ok={n} fail={len(rows)-n}", flush=True)
    pl.DataFrame(rows, infer_schema_length=None).write_parquet("data/raw/opinion_pdf_manifest.parquet")
    n = sum(x["ok"] for x in rows)
    print(f"\nwrote data/raw/opinion_pdf_manifest.parquet rows={len(rows)} ok={n} "
          f"cases={len({x['ca_number'] for x in rows if x['ok']})}")


if __name__ == "__main__":
    main()
