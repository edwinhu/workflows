#!/usr/bin/env -S uv run --with lxml --with google-genai --with google-cloud-storage python3
"""Bootstrap a `sources.bib` from a DOCX manuscript's footnotes.

For a paper with hand-typed Bluebook citations in footnotes but no
`references/sources.bib` yet, this tool walks `word/footnotes.xml`, splits
multi-cite footnotes on `;`, sends each citation to Gemini (Vertex AI Batch,
one independent request per citation) for structured field extraction, and
writes a BibTeX file.

Each emitted entry includes `note = {fnN}` linking back to the source
footnote in the docx, which is useful for the downstream `bib_integrate.py`
step that wraps body footnoteReferences in `_RefBib_<bibkey>` bookmarks.

Usage:
    make_bib_from_docx.py --docx draft.docx --out references/sources.bib

Conventions (matches writing-setup SKILL):
    • Output path: <project>/references/sources.bib
    • Bibkey: firstauthorlastYEAR (lowercase, no spaces) for academic works
    • Institutional bibkeys: gao<year>, crs<year>, secReg<year>, etc.
    • Entry types: @article, @book, @incollection, @misc (cases/statutes/
      regulations/news/letters/hearings), @unpublished (NBER/SSRN/ECGI)
    • Model default: gemini-3.1-flash-lite-preview (cheapest & fastest)
    • Location: us-central1 (Vertex Batch requirement)

Requires:
    • GCS bucket (default: nal-batch-extraction)
    • GCP project (default: activist-defense-nal)
    • ADC: `gcloud auth application-default login`
"""
from __future__ import annotations

import argparse
import io
import json
import re
import time
import zipfile
from pathlib import Path

from lxml import etree


W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


# ── Footnote walk + multi-cite splitting ───────────────────────────────

def load_footnotes(docx: str) -> list[dict]:
    """Return [{fn_id, text}] for every body footnote."""
    with zipfile.ZipFile(docx) as zf:
        fns = etree.parse(io.BytesIO(zf.read('word/footnotes.xml'))).getroot()
    out = []
    for fn in fns.findall(f'{{{W}}}footnote'):
        fid = fn.get(f'{{{W}}}id')
        if fid is None or int(fid) < 1:
            continue
        text = ''.join(t.text or '' for t in fn.iter(f'{{{W}}}t')).strip()
        if not text:
            continue
        out.append({'fn_id': int(fid), 'text': text})
    return out


def is_supra_only(text: str) -> bool:
    """Return True if the footnote is ENTIRELY one or more supra/infra refs
    with no first-cite content. Such footnotes should not contribute entries
    to the bib."""
    stripped = re.sub(r'\s+', ' ', text).strip()
    # Single supra: "Hawkins, supra note 5."
    if re.fullmatch(r"[A-Z][\w &,.''\-?!:\"“”]{0,120}?,?\s+(?:supra|infra)\s+notes?\s+\d+(?:\s*[-–]\s*\d+)?(?:,\s+at\s+[\w\-–.,;()'']+)?\.?\s*", stripped):
        return True
    # Compound supra ("X, supra note 5; Y, supra note 9.") — all parts are supras
    parts = re.split(r';\s*', stripped.rstrip('.'))
    if all(re.fullmatch(r"\s*(?:[A-Z][\w &,.''\-?!:\"“”]{0,120}?,?\s+)?(?:supra|infra)\s+notes?\s+\d+(?:\s*[-–]\s*\d+)?(?:,\s+at\s+[\w\-–.,;()'']+)?\s*", p) for p in parts if p):
        return True
    # "Id." or "Id. at <pin>." alone
    if re.fullmatch(r'(?:Id\.|Ibid\.)(?:\s+at\s+[\w\-–]+)?\.?', stripped):
        return True
    return False


def split_multi_cite(text: str) -> list[str]:
    """A Bluebook footnote can contain multiple citations separated by `;`.
    Split safely, ignoring `;` inside parens or quotes."""
    parts: list[str] = []
    depth = 0
    in_quote = False
    buf: list[str] = []
    for ch in text:
        if ch == '(' and not in_quote:
            depth += 1
        elif ch == ')' and not in_quote:
            depth = max(0, depth - 1)
        elif ch in ('"', '“', '”'):
            in_quote = not in_quote
        if ch == ';' and depth == 0 and not in_quote:
            piece = ''.join(buf).strip()
            if piece:
                parts.append(piece)
            buf = []
        else:
            buf.append(ch)
    tail = ''.join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def cite_is_first_cite(cite: str) -> bool:
    """A piece of a multi-cite footnote may itself be a supra/infra short
    form. Only first-cite pieces should go into the bib."""
    stripped = re.sub(r'\s+', ' ', cite).strip()
    if re.fullmatch(r"[A-Z][\w &,.''\-?!:\"“”]{0,120}?,?\s+(?:supra|infra)\s+notes?\s+\d+(?:\s*[-–]\s*\d+)?(?:,\s+at\s+[\w\-–.,;()'']+)?\.?\s*", stripped):
        return False
    if re.fullmatch(r'(?:Id\.|Ibid\.)(?:\s+at\s+[\w\-–]+)?\.?', stripped):
        return False
    return True


# ── Vertex Batch submission ────────────────────────────────────────────

PROMPT_TEMPLATE = (
    "You are converting one Bluebook citation string into a structured BibTeX record.\n"
    "\n"
    "Bibkey conventions:\n"
    "  • Academic works: firstauthorlast + 4-digit year, lowercase, no spaces or periods.\n"
    "    Example: kahanRock2008, choiFischKahan2013, hu2025, malenkoShen2016.\n"
    "  • Institutional reports/agencies: short slug + year (gao2017, crs2024, secReg2020).\n"
    "  • Cases: party1Party2Year (issSec2025) — short, alphanumeric.\n"
    "  • Statutes/executive orders: short slug (execOrder14366, doddFrank2010).\n"
    "  • If multiple works share the same firstauthor+year, distinguish via title token "
    "(choiFischKahan2010Power, choiFischKahan2013Calls).\n"
    "\n"
    "Entry types:\n"
    "  @article    — journal articles (Vol Journal Page format)\n"
    "  @book       — books with publisher or edition\n"
    "  @incollection — chapter in edited volume\n"
    "  @unpublished — working papers (NBER, SSRN, ECGI, working paper series)\n"
    "  @misc       — cases, statutes, regulations, exec orders, news, letters, hearings\n"
    "\n"
    "Fields:\n"
    "  • author  (BibTeX form: `First Last and First Last`). Empty for cases/statutes/regs.\n"
    "  • title   (article/book title; case name; statute name).\n"
    "  • journal (Bluebook journal abbreviation, e.g. `Harv. L. Rev.`).\n"
    "  • publisher (book publisher).\n"
    "  • volume, pages, year.\n"
    "  • url (perma.cc / ssrn / publisher URL if present).\n"
    "  • howpublished (for @misc only — preserve full Bluebook reporter/release info).\n"
    "  • note (for @unpublished only — working paper series + number).\n"
    "\n"
    "Strip leading Bluebook signals (See, See also, E.g., Cf., But see) before parsing.\n"
    "Source footnote: fn{fn_id}\n"
    "Citation text:\n"
    "{cite}\n"
)

SCHEMA = {
    'type': 'object',
    'properties': {
        'bibkey': {'type': 'string'},
        'entry_type': {'type': 'string', 'enum': ['article', 'book', 'incollection', 'misc', 'unpublished']},
        'author': {'type': 'string'},
        'title': {'type': 'string'},
        'journal': {'type': 'string'},
        'publisher': {'type': 'string'},
        'volume': {'type': 'string'},
        'pages': {'type': 'string'},
        'year': {'type': 'string'},
        'url': {'type': 'string'},
        'howpublished': {'type': 'string'},
        'note': {'type': 'string'},
    },
    'required': ['bibkey', 'entry_type', 'title', 'year'],
}


def submit_batch(cites: list[dict], project: str, bucket: str, location: str, model: str, out_dir: Path) -> list[dict]:
    """Build JSONL, upload to GCS, submit Vertex Batch, poll, download, parse."""
    from google import genai
    from google.cloud import storage

    client = genai.Client(vertexai=True, project=project, location=location)
    storage_client = storage.Client(project=project)
    bucket_obj = storage_client.bucket(bucket)

    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / 'bib_requests.jsonl'
    with jsonl_path.open('w') as f:
        for i, c in enumerate(cites):
            req_body = {
                'contents': [{'role': 'user', 'parts': [{'text': PROMPT_TEMPLATE.format(**c)}]}],
                'generationConfig': {
                    'responseMimeType': 'application/json',
                    'responseSchema': SCHEMA,
                },
            }
            if model.startswith('gemini-3'):
                req_body['generationConfig']['thinkingConfig'] = {'thinkingLevel': 'MINIMAL'}
            f.write(json.dumps({'key': f'cite-{i:04d}', 'request': req_body}) + '\n')
    print(f"Wrote {len(cites)} JSONL requests → {jsonl_path}")

    stamp = time.strftime('%Y%m%d_%H%M%S')
    input_blob = f'make-bib/{stamp}/input.jsonl'
    output_prefix = f'make-bib/{stamp}/outputs/'
    input_uri = f'gs://{bucket}/{input_blob}'
    output_uri = f'gs://{bucket}/{output_prefix}'

    bucket_obj.blob(input_blob).upload_from_filename(str(jsonl_path))
    print(f"Uploaded → {input_uri}")

    job = client.batches.create(
        model=model,
        src=input_uri,
        config={'display_name': f'make-bib-{stamp}', 'dest': output_uri},
    )
    print(f"Submitted batch: {job.name}")

    TERMINAL = {'JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'}
    start = time.time()
    while True:
        job = client.batches.get(name=job.name)
        elapsed = int(time.time() - start)
        print(f"  [{elapsed}s] state={job.state}")
        if str(job.state).split('.')[-1] in TERMINAL:
            break
        time.sleep(30)

    if 'SUCCEEDED' not in str(job.state):
        raise RuntimeError(f"Batch failed: {job.state}")

    pred_path = out_dir / 'bib_predictions.jsonl'
    with pred_path.open('wb') as f:
        for blob in storage_client.list_blobs(bucket, prefix=output_prefix):
            if blob.name.endswith('.jsonl') or 'predictions' in blob.name:
                f.write(blob.download_as_bytes())
    print(f"Downloaded → {pred_path}")

    records: list[dict] = []
    with pred_path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            key = row.get('key') or row.get('id')
            try:
                txt = row['response']['candidates'][0]['content']['parts'][0]['text']
                data = json.loads(txt)
            except Exception as e:
                print(f"  parse error for {key}: {e}")
                continue
            idx = int(key.split('-')[1])
            data['_fn'] = cites[idx]['fn_id']
            records.append(data)
    return records


# ── BibTeX rendering ────────────────────────────────────────────────────

def _sanitize_bibkey(k: str) -> str:
    out = re.sub(r'[^A-Za-z0-9_-]', '', k or 'entry')
    return out or 'entry'


def render_bib(records: list[dict]) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for r in records:
        key = _sanitize_bibkey(r.get('bibkey', ''))
        base, i = key, 0
        while key in seen:
            i += 1
            key = f"{base}-{chr(ord('a') + i - 1)}"
        seen.add(key)
        et = r.get('entry_type', 'misc')
        lines = [f"@{et}{{{key},"]

        def add(name: str, value: str) -> None:
            if value:
                v = value.replace('\\', '\\\\')
                lines.append(f"  {name} = {{{v}}},")

        add('author', r.get('author', ''))
        add('title', '{' + r['title'] + '}' if r.get('title') else '')
        add('journal', r.get('journal', ''))
        add('publisher', r.get('publisher', ''))
        add('volume', r.get('volume', ''))
        add('pages', r.get('pages', ''))
        add('year', r.get('year', ''))
        add('url', r.get('url', ''))
        if et == 'misc':
            add('howpublished', r.get('howpublished', ''))
        existing_note = r.get('note', '')
        fn_note = f"fn{r['_fn']}"
        combined = (existing_note + '; ' + fn_note).strip('; ') if existing_note else fn_note
        add('note', combined)
        if lines[-1].endswith(','):
            lines[-1] = lines[-1][:-1]
        lines.append('}')
        out.append('\n'.join(lines))

    header = (
        "% Auto-extracted from docx footnotes via Gemini Vertex Batch.\n"
        "% Each entry's `note = {fnN}` field points back to the source footnote.\n"
        "% This file is the canonical bibliography — edit in place; do not regenerate.\n\n"
    )
    return header + '\n\n'.join(out) + '\n'


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--docx', required=True)
    ap.add_argument('--out', required=True, help="Output .bib path (typically references/sources.bib)")
    ap.add_argument('--project', default='activist-defense-nal')
    ap.add_argument('--bucket', default='nal-batch-extraction')
    ap.add_argument('--location', default='us-central1')
    ap.add_argument('--model', default='gemini-3.1-flash-lite-preview',
                    help="Default: latest flash-lite preview (cheapest, fast).")
    ap.add_argument('--scratch-dir', default=None,
                    help="Where to write JSONL + predictions (default: <docx-dir>/scratch).")
    ap.add_argument('--bio-count', type=int, default=3,
                    help="Skip the first N footnotes (author bio fns with affiliations, not citations). Default: 3.")
    ap.add_argument('--dry-run', action='store_true',
                    help="Walk footnotes + extract candidate cites; don't submit batch or write bib.")
    args = ap.parse_args()

    fns = load_footnotes(args.docx)
    print(f"Loaded {len(fns)} footnotes")

    # Build the list of first-cite candidates
    cites: list[dict] = []
    skipped_supra_only = 0
    skipped_bio = 0
    for fn in fns:
        if fn['fn_id'] <= args.bio_count:
            skipped_bio += 1
            continue
        if is_supra_only(fn['text']):
            skipped_supra_only += 1
            continue
        for piece in split_multi_cite(fn['text']):
            if cite_is_first_cite(piece):
                cites.append({'fn_id': fn['fn_id'], 'cite': piece.strip()})

    print(f"  skipped (bio fns 1..{args.bio_count}): {skipped_bio}")
    print(f"  skipped (supra-only): {skipped_supra_only}")
    print(f"  first-cite candidates: {len(cites)}")

    if args.dry_run:
        print("\n--- sample candidates ---")
        for c in cites[:5]:
            print(f"  fn{c['fn_id']}: {c['cite'][:120]}")
        return

    scratch = Path(args.scratch_dir) if args.scratch_dir else (Path(args.docx).parent / 'scratch')
    records = submit_batch(cites, args.project, args.bucket, args.location, args.model, scratch)
    print(f"\nExtracted {len(records)} bib records from {len(cites)} candidates")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(render_bib(records))
    print(f"Wrote {args.out}")


if __name__ == '__main__':
    main()
