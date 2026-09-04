"""Harvest filed complaints for DE Chancery §220 cases from Lex Machina.

Chain (see docs/investigations/2026-08-30_docket-entry-endpoint.md):
  case_id -> /state-court/cases/{case_id}/docket-search  (paged)
          -> earliest entry tagged "Complaint" (tag id 257)
          -> document id + file id
          -> /state-court/documents/{doc}/pdf?document_file_id={file}  -> 302 -> signed GCS URL

Signed URLs expire in one hour and are never stored; only ids are.
Serial, with a delay between cases. Any 401/403/429 aborts the run.

  python3 scripts/harvest_complaints.py --limit 10 [--delay 4] [--out-suffix _test]
"""
import argparse, json, random, subprocess, sys, time
import re
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import requests

sys.path.insert(0, str(Path(__file__).parent))
from lm_cookie import get_cookie

BASE = "https://law.lexmachina.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/151.0.0.0 Safari/537.36")
PANEL = Path("data/raw/chancery_case_panel.parquet")
PDF_DIR = Path("data/raw/complaints")
CACHE_DIR = Path("data/raw/lex_docket_cache")
COMPLAINT_TAG_ID = 257
PAGE_N = 200
STOP_CODES = {401, 403, 407, 429, 503}


class Blocked(Exception):
    """Raised on any response that reads like a rate limit or an auth wall."""


def load_cookies(s):
    """Cookies go in the JAR, never a pinned Cookie: header — a pinned header goes stale
    mid-run when the server rotates the session and produces misleading 401s."""
    s.cookies.clear()
    for part in get_cookie().split("; "):
        k, _, v = part.partition("=")
        s.cookies.set(k, v, domain="law.lexmachina.com")


def make_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA,
                      "X-Requested-With": "XMLHttpRequest", "Accept": "application/json"})
    load_cookies(s)
    return s


def nap(delay):
    """Serial pacing with jitter so the request pattern is not robotic."""
    time.sleep(delay * random.uniform(1.0, 1.9))


def get(s, url, raise_on_stop=True, **kw):
    """One retry with a freshly-read browser cookie before calling a 401/403 a wall — a stale
    session is the far likelier cause (see the docket-entry investigation)."""
    r = s.get(url, timeout=300, **kw)
    if r.status_code in (401, 403):
        time.sleep(5)
        load_cookies(s)
        r = s.get(url, timeout=300, **kw)
    if raise_on_stop and r.status_code in STOP_CODES:
        raise Blocked(f"HTTP {r.status_code} on {url}\n{r.text[:400]}")
    return r


def docket_entries(s, case_id):
    """All docket entries for a case, sorted (filed_on, entry id). Cached on disk:
    re-paging a 200-entry docket on every restart is the main cost of this crawl."""
    cache = CACHE_DIR / f"{case_id}.json"
    if cache.exists():
        try:
            d = json.loads(cache.read_text())
            return d["entries"], d["total"]
        except Exception:
            pass
    entries, start = [], 0
    while True:
        r = get(s, f"{BASE}/state-court/cases/{case_id}/docket-search",
                params={"n": PAGE_N, "start": start})
        if r.status_code != 200:
            raise RuntimeError(f"docket-search HTTP {r.status_code}")
        d = r.json()
        entries.extend(d["result"])
        total = d["total_results_number"]
        if len(entries) >= total or not d["result"]:
            break
        start += len(d["result"])
    entries.sort(key=lambda e: (e["_source"]["filed_on"], int(e["id"])))
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"entries": entries, "total": total}))
    return entries, total


def norm(t):
    return " ".join((t or "").split()).casefold()


def pick_complaint(entries):
    """(entry, document, file, method) for the originally filed complaint, or (None,)*3 + reason."""
    tagged = [e for e in entries
              if any(t.get("id") == COMPLAINT_TAG_ID for t in e["_source"].get("tags", []))]
    if tagged:
        entry, entry_method = tagged[0], "tag257"
    elif entries:
        entry, entry_method = entries[0], "fallback_first_entry"
    else:
        return None, None, None, "no_entries"

    docs = entry.get("_augmented", {}).get("documents", [])
    docs = [d for d in docs if d.get("files") or d.get("file_for_display")]
    if not docs:
        return entry, None, None, f"{entry_method}+no_documents"

    text = norm(entry["_source"]["text"])
    doc, doc_method = None, None
    for d in docs:
        if norm(d.get("title")) == text:
            doc, doc_method = d, "title_eq_entry_text"
            break
    if doc is None:
        for d in docs:
            t = norm(d.get("title"))
            head = t.replace("verified ", "").replace("amended ", "").replace("first ", "")
            if head.startswith("complaint") or head.startswith("petition"):
                doc, doc_method = d, "title_prefix_complaint_or_petition"
                break
    if doc is None:
        # No document title matches the entry text. Verified on 8262-VCP and 8360-VCL:
        # these are sealed complaints whose public entry carries only a motion to seal.
        doc, doc_method = docs[0], "first_document"

    f = doc.get("file_for_display") or doc["files"][0]
    return entry, doc, f, f"{entry_method}+{doc_method}"


def pdf_metrics(path):
    """(n_pages, extractable text chars) — 2012-era scans have no text layer and will need OCR."""
    try:
        info = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"^Pages:\s+(\d+)", info, re.M)
        pages = int(m.group(1)) if m else None
    except Exception:
        pages = None
    try:
        txt = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, timeout=180).stdout
        chars = len(txt.strip())
    except Exception:
        chars = None
    return pages, chars


def fetch_pdf(s, document_id, file_id, dest):
    r = get(s, f"{BASE}/state-court/documents/{document_id}/pdf",
            raise_on_stop=False, params={"document_file_id": file_id})
    if r.status_code in (429, 407, 503):
        raise Blocked(f"HTTP {r.status_code} minting doc {document_id} file {file_id}\n{r.text[:400]}")
    ctype = r.headers.get("Content-Type", "")
    ok = r.status_code == 200 and r.content[:5] == b"%PDF-"
    if ok:
        dest.write_bytes(r.content)
    return r.status_code, ctype, len(r.content), ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--out-suffix", default="")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--only-ca", default=None,
                    help="Path to a text file of ca_numbers (one per line) to restrict to. "
                         "Used to fill Docket Alarm's gaps from Lex Machina.")
    args = ap.parse_args()

    PDF_DIR.mkdir(parents=True, exist_ok=True)
    cases = (pl.read_parquet(PANEL).filter(pl.col("pop_220"))
             .select("case_id", "case_number", "ca_number", "title",
                     "filed_on", "docket_count", "case_subtype")
             .sort("filed_on").to_dicts())
    if args.only_ca:
        want = {l.strip() for l in open(args.only_ca) if l.strip()}
        cases = [c for c in cases if c["ca_number"] in want]
        missing = want - {c["ca_number"] for c in cases}
        print(f"--only-ca: {len(cases)} of {len(want)} requested found in the panel"
              + (f"; not in panel: {sorted(missing)}" if missing else ""))
    if args.limit:
        cases = cases[:args.limit]

    s = make_session()
    rows, blocked, consec_auth_fail = [], None, 0
    for i, c in enumerate(cases, 1):
        dest = PDF_DIR / f"{c['ca_number']}.pdf"
        row = dict(case_id=c["case_id"], case_number=c["case_number"], ca_number=c["ca_number"],
                   filed_on=c["filed_on"], docket_count=c["docket_count"],
                   case_subtype=c["case_subtype"],
                   n_entries=None, entry_id=None, entry_filed_on=None, entry_text=None,
                   document_id=None, file_id=None, selection_method=None,
                   local_path=None, http_status=None, content_type=None, bytes=None,
                   n_pages=None, text_chars=None, ok=False, is_substitute=False, error=None,
                   retrieved_at=datetime.now(timezone.utc).isoformat())
        try:
            entries, total = docket_entries(s, c["case_id"])
            row["n_entries"] = total
            entry, doc, f, method = pick_complaint(entries)
            row["selection_method"] = method
            if entry is not None:
                row.update(entry_id=entry["id"], entry_filed_on=entry["_source"]["filed_on"],
                           entry_text=entry["_source"]["text"])
            if doc is None:
                row["error"] = method
            else:
                row.update(document_id=doc["id"], file_id=f["id"])
                nap(args.delay)
                st, ct, nb, ok = fetch_pdf(s, doc["id"], f["id"], dest)
                row.update(http_status=st, content_type=ct, bytes=nb, ok=ok)
                if ok:
                    row["local_path"] = str(dest)
                    row["n_pages"], row["text_chars"] = pdf_metrics(dest)
                    if method.endswith("first_document"):
                        # retrieved something, but it is not the complaint
                        row["ok"] = False
                        row["is_substitute"] = True
                        row["error"] = ("complaint_not_public: no document title matched the "
                                        "entry text; saved the first document instead")
                else:
                    row["error"] = f"non-pdf response {st} {ct}"
                # One bad document is a per-document condition; a run of them is a wall.
                if st in (401, 403):
                    consec_auth_fail += 1
                    if consec_auth_fail >= 5:
                        raise Blocked(f"{consec_auth_fail} consecutive HTTP {st} on document mints "
                                      f"(last: doc {doc['id']} file {f['id']}, {ct})")
                else:
                    consec_auth_fail = 0
        except Blocked as e:
            blocked = str(e)
            row["error"] = f"BLOCKED: {e}"
            rows.append(row)
            print(f"\n!!! ABORTING — looks like a rate limit or auth wall:\n{e}", file=sys.stderr)
            break
        except Exception as e:  # network hiccup on one case must not kill the run
            row["error"] = f"{type(e).__name__}: {e}"
        rows.append(row)
        flag = "ok " if row["ok"] else "FAIL"
        print(f"[{i}/{len(cases)}] {flag} {c['ca_number']:10s} "
              f"entries={row['n_entries']} doc={row['document_id']} file={row['file_id']} "
              f"{row['bytes'] or 0}b  {row['selection_method']}  :: {(row['entry_text'] or '')[:60]}")
        sys.stdout.flush()
        nap(args.delay)

    man = Path(f"data/raw/complaints_manifest{args.out_suffix}.parquet")
    pl.DataFrame(rows, infer_schema_length=None).write_parquet(man)
    n_ok = sum(r["ok"] for r in rows)
    print(f"\nwrote {man}  rows={len(rows)} ok={n_ok} fail={len(rows) - n_ok}")
    if blocked:
        sys.exit(2)


if __name__ == "__main__":
    main()
