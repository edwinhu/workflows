# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg[binary]>=3.1", "polars>=1.0", "loguru>=0.7", "beautifulsoup4>=4.12"]
# ///
"""Resolve assembled Bloomberg Law EDGAR hits to accessions and exhibit text.

Join on WRDS (keys sent as parameter arrays, unnested server-side; only accession/cik/form/wrdsfname come back),
copy raw submissions with rclone from wrds:/wrds/sec/archives, parse SGML locally.

    uv run --script resolve_exhibits.py --hits hits.jsonl --out-dir out --cache-dir raw [--phrase "..." ...]
"""

import argparse
import collections
import concurrent.futures
import datetime
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import polars as pl
import psycopg
from bs4 import BeautifulSoup
from loguru import logger

ARCHIVES = "/wrds/sec/archives"
FORM_LABELS = {"Rule 425 Communications": "425"}  # Bloomberg label -> EDGAR form
EX_TOKEN = re.compile(r"\b(?:EX-|EXHIBIT(?:-|\s+)|EX\s+)([0-9]+(?:\.[0-9A-Za-z]+)?)")
EX_REG_A = re.compile(r"\bEX1[A-Z]-\d+\b")  # Reg A types: EX1A-6, EX1K-...
DOC = re.compile(r"<DOCUMENT>(.*?)</DOCUMENT>", re.DOTALL | re.IGNORECASE)
HEAD = re.compile(r"^<(TYPE|SEQUENCE|FILENAME|DESCRIPTION)>[ \t]*([^\r\n]*)", re.MULTILINE | re.IGNORECASE)
DOTSTUFF = re.compile(r"^\.\.", re.MULTILINE)  # the .txt doubles a leading "." on every line
TEXT = re.compile(r"<TEXT>(.*?)(?:</TEXT>|\Z)", re.DOTALL | re.IGNORECASE)

KEYS_CTE = """
WITH k AS (SELECT * FROM unnest(%(id)s::text[], %(file_no)s::text[], %(filed)s::date[], %(form)s::text[])
           AS k(blaw_id, file_no, filed_date, form))
"""  # pgdata is a hot standby: no TEMP tables, so keys travel as parameter arrays
CANDIDATE_SQL = (
    KEYS_CTE
    + """
SELECT DISTINCT k.blaw_id, r.accession, r.cik, f.form, w.wrdsfname
FROM k
JOIN wrds_sec_search.registrant r ON r.file_no = k.file_no
JOIN wrds_sec_search.filing_view f
  ON f.accession = r.accession AND f.filing_date = k.filed_date AND f.form LIKE k.form || '%%'
LEFT JOIN wrdssec_all.wrds_forms w ON w.accession = r.accession AND w.cik = r.cik
ORDER BY 1, 2, 3
"""
)  # never select f.filing: the SGML text comes from the archives over rclone


def plain(s: str) -> str:
    soup = BeautifulSoup(s, "html.parser")
    for x in soup(["script", "style"]):
        x.decompose()
    return " ".join(soup.get_text(" ").split())


def alnum(s: str) -> str:
    return re.sub(r"[^0-9a-z]", "", s.lower())


def iso(v):
    return datetime.datetime.strptime(v, "%b %d, %Y").date().isoformat() if v else None


def norm_type(t: str) -> str:
    return " ".join(t.upper().split())


def flatten_one(r: dict) -> dict:
    subs = {x.get("key"): x.get("value") for x in r["subtitles"]}
    meta = {x["key"]: x["value"] for x in r["metadata"]}
    segment = r["title"].split(";", 2)[-1].strip()  # "EX-99: EX-99.1", "EX-10.6 2", ...
    raw_type = norm_type(segment.split(":", 1)[0])
    if m := EX_REG_A.search(r["title"]):
        exhibit = m.group()
    else:
        ex = ["EX-" + x for x in EX_TOKEN.findall(r["title"])]
        if not ex:
            raise ValueError(f"no exhibit token in title {r['title']!r}")
        specific = [x for x in ex if "." in x]
        exhibit = specific[0] if specific else ex[0]
    label = subs["normalized_form_type"]
    return {
        "blaw_id": r["id"],
        "title": r["title"],
        "filer": "; ".join(meta["filer"]),
        "file_no": subs["edgar_file_number"],
        "filed_date": iso(subs["filed_date"]),
        "period_date": iso(subs.get("period_date")),
        "blaw_form": label,
        "form": FORM_LABELS.get(label, label.removeprefix("Form ")),
        "title_form": r["title"].split(";")[1].strip().removeprefix("Form ")
        if r["title"].count(";") >= 2
        else None,
        "exhibit": exhibit,
        "type_keys": sorted({exhibit, raw_type}),
        "exhibit_desc": norm_type(segment.split(":", 1)[-1]).removesuffix("...").strip(),
        "extracts": [plain(s) for s in r["extracts"]],
    }


def type_match(doc_type: str, keys: list[str]) -> bool:
    t = norm_type(doc_type)
    return any(t == k or t.startswith(k + " ") for k in keys)


def extract_probes(extracts: list[str]) -> list[str]:
    """Middle 40 alphanumerics of each extract: survives Bloomberg's glued words and entities."""
    out = []
    for e in extracts:
        a = alnum(e)
        if len(a) >= 40:
            mid = len(a) // 2
            out.append(a[mid - 20 : mid + 20])
    return out


def documents(path: str) -> list[dict]:
    raw = Path(path).read_bytes().decode("utf-8", errors="replace")
    docs = []
    for m in DOC.finditer(raw):
        block = m.group(1)
        t = TEXT.search(block)
        head = {k.upper(): v.strip() for k, v in HEAD.findall(block[: t.start() if t else len(block)])}
        docs.append(
            {
                "type": head.get("TYPE", ""),
                "sequence": head.get("SEQUENCE"),
                "filename": head.get("FILENAME"),
                "description": head.get("DESCRIPTION"),
                "body": DOTSTUFF.sub(".", t.group(1)) if t else "",
            }
        )
    if not docs:
        raise ValueError(f"no <DOCUMENT> blocks in {path}")
    return docs


def index_file(job: tuple) -> list[dict]:
    """Phase A: per (hit, accession) in this file, the type-matched documents and extract matches."""
    path, wants = job
    docs = documents(path)
    out = []
    for blaw_id, accession, keys, probes, multi in wants:
        matched = [d for d in docs if type_match(d["type"], keys)]
        rows = []
        for d in matched:
            hit = None
            if (multi or len(matched) > 1) and probes:
                txt = alnum(plain(d["body"]))
                hit = any(p in txt for p in probes)
            rows.append(
                {
                    "type": d["type"],
                    "sequence": d["sequence"],
                    "filename": d["filename"],
                    "description": d["description"],
                    "extract_match": hit,
                }
            )
        out.append({"blaw_id": blaw_id, "accession": accession, "n_docs": len(docs), "matched": rows})
    return out


def narrow(items: list, tests: list) -> tuple:
    """Apply tests in order; the first to leave exactly one item wins, a test leaving several narrows."""
    for name, test in tests:
        kept = [x for x in items if test(x)]
        if len(kept) == 1:
            return kept[0], name
        if kept:
            items = kept
    return None, None


def phrase_regex(phrase: str) -> re.Pattern:
    words = [r"\s*-\s*".join(map(re.escape, w.split("-"))) for w in phrase.split()]
    return re.compile(r"(?<!\w)" + r"\s+".join(words) + r"(?!\w)", re.IGNORECASE)


def slug(phrase: str) -> str:
    return re.sub(r"\W+", "_", phrase.lower()).strip("_")


def extract_file(job: tuple) -> list[dict]:
    """Phase B: write the selected exhibit's text, measure it, verify phrases."""
    path, wants, phrases, exhibits_dir = job
    by_name = {d["filename"]: d for d in documents(path)}
    out = []
    for blaw_id, accession, filename, probes in wants:
        text = plain(by_name[filename]["body"])
        dest = Path(exhibits_dir) / f"{accession}_{filename}.txt"
        if not dest.exists() or dest.read_text() != text:
            dest.write_text(text)
        a = alnum(text)
        pv = None
        if phrases:
            pv = {slug(p): bool(phrase_regex(p).search(text)) for p in phrases}
            pv["all_phrases"] = all(pv.values())
        out.append(
            {
                "blaw_id": blaw_id,
                "text_path": str(dest),
                "chars": len(text),
                "extract_found": any(p in a for p in probes) if probes else None,
                "phrase_verification": pv,
            }
        )
    return out


def wrds_candidates(hits: list[dict]) -> tuple[list[dict], float]:
    t0 = time.monotonic()
    with psycopg.connect(
        host="wrds-pgdata.wharton.upenn.edu",
        port=9737,
        dbname="wrds",
        user="eddyhu",
        sslmode="require",
        connect_timeout=30,
    ) as conn:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 600000")
        params = {
            "id": [h["blaw_id"] for h in hits],
            "file_no": [h["file_no"] for h in hits],
            "filed": [h["filed_date"] for h in hits],
            "form": [h["form"] for h in hits],
        }
        cur.execute(KEYS_CTE + "SELECT count(DISTINCT blaw_id) FROM k", params)
        n_keys = cur.fetchone()[0]
        cur.execute(CANDIDATE_SQL, params)
        cols = [c.name for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    secs = time.monotonic() - t0
    if n_keys != len(hits):
        raise RuntimeError(f"server-side key set holds {n_keys} keys, expected {len(hits)}")
    hit_ids = {r["blaw_id"] for r in rows}
    logger.info(
        f"WRDS join: keys in {n_keys}; candidate rows out {len(rows)}; hits with >=1 candidate "
        f"{len(hit_ids)}/{n_keys} = {len(hit_ids) / n_keys:.4f}; distinct accessions "
        f"{len({r['accession'] for r in rows})}; wrdsfname null {sum(r['wrdsfname'] is None for r in rows)}"
        f"/{len(rows)}; query+upload {secs:.1f}s"
    )
    for r in rows:
        if r["wrdsfname"] is None:  # wrds_forms lags new filings; the layout is deterministic
            c = str(int(r["cik"]))
            r["wrdsfname"] = f"{c.zfill(10)[:6]}/{c}/{r['accession']}.txt"
            logger.warning(f"wrdsfname missing for {r['accession']}; derived {r['wrdsfname']}")
    return rows, secs


def run(cmd: list[str], **kw):
    logger.info("$ " + " ".join(cmd))
    subprocess.run(cmd, check=True, **kw)


def fetch(paths: list[str], cache: Path, out: Path, tar_threshold: int, scratch: str) -> dict:
    need = sorted(p for p in set(paths) if not ((cache / p).is_file() and (cache / p).stat().st_size))
    stats = {
        "listed": len(set(paths)),
        "cached": len(set(paths)) - len(need),
        "fetched": len(need),
        "bytes": 0,
        "seconds": 0.0,
        "route": "none",
    }
    if not need:
        logger.info(f"rclone: all {stats['listed']} submissions already cached")
        return stats
    lst = out / "rclone_files.txt"
    lst.write_text("".join(p + "\n" for p in need))
    t0 = time.monotonic()
    if len(need) <= tar_threshold:
        stats["route"] = "rclone --files-from"
        # --ignore-checksum: rclone's post-copy md5 runs `md5sum` over a fresh ssh session per file
        # on the WRDS login node; at 16 transfers that exhausted its sessions/forks. Size is still checked.
        run(
            [
                "rclone",
                "copy",
                f"wrds:{ARCHIVES}",
                str(cache),
                "--files-from",
                str(lst),
                "--transfers",
                "8",
                "--ignore-checksum",
                "--no-traverse",
                "--stats",
                "30s",
                "--stats-one-line",
            ]
        )
    else:  # edgar.md: scp list -> tar server-side on /scratch -> rclone one archive
        stats["route"] = "scp + ssh tar czf + rclone"
        stamp = f"blaw_{os.getpid()}_{int(time.time())}"
        rlist, rtar = f"/tmp/{stamp}.txt", f"{scratch}/{stamp}.tar.gz"
        run(["scp", "-q", str(lst), f"wrds:{rlist}"])
        run(["ssh", "wrds", f"mkdir -p {scratch} && cd {ARCHIVES} && tar czf {rtar} -T {rlist}"])
        run(["rclone", "copy", f"wrds:{rtar}", str(cache), "--stats", "30s", "--stats-one-line"])
        run(["tar", "xzf", str(cache / f"{stamp}.tar.gz"), "-C", str(cache)])
        (cache / f"{stamp}.tar.gz").unlink()
        run(["ssh", "wrds", f"rm -f {rtar} {rlist}"])
    stats["seconds"] = time.monotonic() - t0
    missing = [p for p in need if not (cache / p).is_file()]
    if missing:
        raise RuntimeError(f"{len(missing)} submissions not fetched, e.g. {missing[:5]}")
    stats["bytes"] = sum((cache / p).stat().st_size for p in need)
    logger.info(
        f"fetch [{stats['route']}]: {stats['fetched']} files, {stats['bytes']:,} bytes, "
        f"{stats['seconds']:.1f}s ({stats['cached']} already cached)"
    )
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hits", type=Path, required=True, help="assemble.py JSONL")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--cache-dir", type=Path, required=True, help="raw SGML submissions, wrdsfname layout")
    ap.add_argument(
        "--phrases",
        "--phrase",
        action="append",
        default=[],
        dest="phrases",
        help="literal phrase to verify in the exhibit text (repeatable)",
    )
    ap.add_argument(
        "--tar-threshold",
        type=int,
        default=10_000,
        help="above this many files, tar server-side instead of rclone --files-from",
    )
    ap.add_argument("--wrds-scratch", default="/scratch/nyu/eddyhu")
    ap.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    a = ap.parse_args()
    a.out_dir.mkdir(parents=True, exist_ok=True)
    a.cache_dir.mkdir(parents=True, exist_ok=True)
    (a.out_dir / "exhibits").mkdir(exist_ok=True)
    logger.add(a.out_dir / "resolve_exhibits.log", mode="w")

    raw = [json.loads(s) for s in a.hits.read_text().splitlines() if s.strip()]
    if len({r["id"] for r in raw}) != len(raw):
        raise ValueError("duplicate Bloomberg ids in --hits")
    with concurrent.futures.ProcessPoolExecutor(a.workers) as pool:
        hits = sorted(pool.map(flatten_one, raw, chunksize=64), key=lambda h: h["blaw_id"])
    missing = [h["blaw_id"] for h in hits if not (h["file_no"] and h["filed_date"] and h["form"])]
    if missing:
        raise ValueError(f"hits lacking file_no/filed_date/form: {missing[:10]}")
    logger.info(
        f"flatten: {len(raw)} hits -> {len(hits)} rows; forms "
        f"{dict(collections.Counter(h['form'] for h in hits).most_common())}"
    )

    cands, wrds_secs = wrds_candidates(hits)
    by_hit = collections.defaultdict(list)
    for c in cands:
        by_hit[c["blaw_id"]].append(c)
    fstats = fetch([c["wrdsfname"] for c in cands], a.cache_dir, a.out_dir, a.tar_threshold, a.wrds_scratch)

    probes = {h["blaw_id"]: extract_probes(h["extracts"]) for h in hits}
    keys = {h["blaw_id"]: h["type_keys"] for h in hits}
    jobs = collections.defaultdict(list)
    for c in cands:
        jobs[str(a.cache_dir / c["wrdsfname"])].append(
            (
                c["blaw_id"],
                c["accession"],
                keys[c["blaw_id"]],
                probes[c["blaw_id"]],
                len({x["accession"] for x in by_hit[c["blaw_id"]]}) > 1,
            )
        )
    t0 = time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(a.workers) as pool:
        idx = [r for part in pool.map(index_file, sorted(jobs.items()), chunksize=4) for r in part]
    docidx = {(r["blaw_id"], r["accession"]): r["matched"] for r in idx}
    logger.info(f"parse: {len(jobs)} submissions indexed in {time.monotonic() - t0:.1f}s")

    out, extract_jobs = [], collections.defaultdict(list)
    for h in hits:
        cs = by_hit[h["blaw_id"]]
        accs = sorted({c["accession"] for c in cs})

        def desc_ok(d, want=h["exhibit_desc"]):
            return norm_type(d["description"] or "").startswith(want)

        def docs_of(acc):
            return docidx[(h["blaw_id"], acc)]

        acc, resolved_by = (accs[0], None) if len(accs) == 1 else (None, None)
        if len(accs) > 1:
            forms = {c["accession"]: c["form"] for c in cs}
            acc, resolved_by = narrow(
                accs,
                [
                    ("type", lambda x: bool(docs_of(x))),
                    ("title_form", lambda x: forms[x] == h["title_form"]),
                    ("description", lambda x: any(desc_ok(d) for d in docs_of(x))),
                    ("extract", lambda x: any(d["extract_match"] for d in docs_of(x))),
                ],
            )
        status = (
            "unmatched"
            if not accs
            else "unique"
            if len(accs) == 1
            else "resolved_by_exhibit"
            if acc
            else "ambiguous"
        )
        sel = min((c for c in cs if c["accession"] == acc), key=lambda c: c["cik"]) if acc else None
        docs = docs_of(acc) if acc else []
        doc, doc_match = None, "none"
        if len(docs) == 1:
            doc, doc_match = docs[0], "type"
        elif len(docs) > 1:  # Bloomberg titles end in the SGML DESCRIPTION ("EX-10: EX-10.23", "EX-10.6 2")
            doc, how = narrow(docs, [("description", desc_ok), ("extract", lambda d: d["extract_match"])])
            doc_match = f"type+{how}" if doc else "multiple"
        row = {
            **h,
            "match_status": status,
            "resolved_by": resolved_by if status == "resolved_by_exhibit" else None,
            "n_candidates": len(accs),
            "candidate_accessions": accs,
            "accession": sel["accession"] if sel else None,
            "cik": sel["cik"] if sel else None,
            "matched_form": sel["form"] if sel else None,
            "wrdsfname": sel["wrdsfname"] if sel else None,
            "doc_match": doc_match,
            "n_type_docs": len(docs),
            "type_doc_filenames": sorted(d["filename"] or "" for d in docs),
            "filename": doc["filename"] if doc else None,
            "doc_type": doc["type"] if doc else None,
            "doc_sequence": doc["sequence"] if doc else None,
            "doc_description": doc["description"] if doc else None,
            "sec_url": None,
            "text_path": None,
            "chars": None,
            "extract_found": None,
            "phrase_verification": None,
        }
        if doc:
            if not doc["filename"] or Path(doc["filename"]).name != doc["filename"]:
                raise ValueError(f"bad FILENAME {doc['filename']!r} in {sel['accession']}")
            row["sec_url"] = (
                f"https://www.sec.gov/Archives/edgar/data/{int(sel['cik'])}/"
                f"{sel['accession'].replace('-', '')}/{doc['filename']}"
            )
            extract_jobs[str(a.cache_dir / sel["wrdsfname"])].append(
                (h["blaw_id"], sel["accession"], doc["filename"], probes[h["blaw_id"]])
            )
        out.append(row)

    t0 = time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(a.workers) as pool:
        ext = {
            r["blaw_id"]: r
            for part in pool.map(
                extract_file,
                [(p, w, a.phrases, str(a.out_dir / "exhibits")) for p, w in sorted(extract_jobs.items())],
                chunksize=4,
            )
            for r in part
        }
    logger.info(f"extract: {len(ext)} exhibits written in {time.monotonic() - t0:.1f}s")
    for r in out:
        r.update({k: v for k, v in ext.get(r["blaw_id"], {}).items() if k != "blaw_id"})

    if len(out) != len(hits) or len({r["blaw_id"] for r in out}) != len(out):
        raise RuntimeError("output is not one row per hit")
    dest = a.out_dir / "hits_resolved.jsonl"
    dest.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in out))
    pl.DataFrame(out, infer_schema_length=None).write_parquet(a.out_dir / "hits_resolved.parquet")

    n = len(out)
    st = collections.Counter(r["match_status"] for r in out)
    dm = collections.Counter(r["doc_match"] for r in out)
    with_text = [r for r in out if r["text_path"]]
    summary = {
        "hits": n,
        "match_status": dict(st),
        "accession_resolved": f"{st['unique'] + st['resolved_by_exhibit']}/{n}",
        "doc_match": dict(dm),
        "exhibit_text": f"{len(with_text)}/{n}",
        "extract_found": f"{sum(bool(r['extract_found']) for r in with_text)}/{len(with_text)}",
        "chars": sum(r["chars"] for r in with_text),
        "wrds_seconds": round(wrds_secs, 1),
        "fetch": fstats,
    }
    if a.phrases:
        summary["phrases"] = {
            k: f"{sum(r['phrase_verification'][k] for r in with_text)}/{len(with_text)}"
            for k in [slug(p) for p in a.phrases] + ["all_phrases"]
        }
    logger.info(f"wrote {dest} ({n} rows) and .parquet")
    print(json.dumps(summary, indent=1, default=str))


if __name__ == "__main__":
    sys.exit(main())
