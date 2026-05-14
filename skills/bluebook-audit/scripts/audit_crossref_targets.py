#!/usr/bin/env python3
"""Audit supra/infra cross-reference targets in a DOCX produced by create_crossrefs.py.

A common failure mode after running create_crossrefs.py: the script faithfully
converts every literal "supra note N" to a NOTEREF bookmark targeting display
position N, but if the manuscript's hand-typed "N" values are stale (footnotes
added since the supras were written), every bookmark targets the wrong
footnote — even though the displayed number reads "correct" relative to itself.

This audit walks each NOTEREF cross-reference, extracts the author/title
tokens preceding "supra"/"infra", resolves the bookmark's xml fn_id, and pulls
the leading text of that target footnote. A mechanical-match pass flags refs
whose surname tokens do NOT appear in the target footnote's content.

For mismatches, the optional --gemini pass asks Gemini to identify which
footnote the author *actually* meant by matching the citation tokens against
all footnotes in the document, producing a proposed remapping. The optional
--apply pass re-points the bookmark in document.xml to the corrected target.

Standalone usage:
    uv run --with lxml --with google-genai python3 \\
      audit_crossref_targets.py --docx FILE.docx [--gemini] [--apply] [--out scratch/]

Outputs:
    <out>/crossref_audit.json       — all references and match status
    <out>/crossref_remap.json       — proposed bookmark → new fn_id (if --gemini)
    <out>/CROSSREF_AUDIT.md         — human-readable report
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from collections import Counter
from io import BytesIO
from pathlib import Path

from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

BM_PREFIX = r"_Ref_(?:corrfn|fn)\d+"

# Capture the short-form reference identifier preceding "supra/infra note <N>".
# The identifier can be:
#   - author surnames                ("Hu, Malenko & Zytnick")
#   - hereinafter short forms        ("GAO Report", "Rosenberg")
#   - institutional document names   ("Best Practice Principles", "Policies and Procedures")
#   - case names                     ("ISS v. SEC")
#   - title fragments after authors  ("Choi, Fisch & Kahan, Power of Proxy Advisors")
#
# Stop the capture at sentence boundaries — `.` or `;` — to avoid greedy matches
# that pull in trailing context from the previous sentence (e.g.,
# "...of the mutual fund assets analyzed. See Shu" should match "See Shu",
# not the whole fragment).
SUPRA_PAT = re.compile(
    r"(?:^|[.;]\s+|\s)"                                                # boundary
    r"([A-Z][A-Za-z0-9.’'\-\xa0 &,?!:\"“”]{0,180}?)"               # ref identifier — allow ? ! : ' in titles
    r",?\s*(supra|infra)\s+notes?\s*\{\{REF:(" + BM_PREFIX + r")\}\}"
)

SIGNAL_PREFIX = re.compile(
    r"^(See(?:,?\s+e\.g\.,?)?\s+|E\.g\.,?\s+|Cf\.\s+|See\s+also\s+|But\s+see\s+|Accord\s+)",
    re.IGNORECASE,
)

STOP_TOKENS = {
    'See', 'Also', 'But', 'Cf', 'Compare', 'With', 'Generally', 'Eg',
    'I', 'A', 'An', 'The', 'Id', 'Accord', 'Contra', 'E', 'G',
}


# ── DOCX I/O ────────────────────────────────────────────────────────────

def load_docx_xml(docx_path: str) -> tuple[etree._Element, etree._Element]:
    with zipfile.ZipFile(docx_path) as zf:
        doc = etree.parse(BytesIO(zf.read('word/document.xml'))).getroot()
        fns = etree.parse(BytesIO(zf.read('word/footnotes.xml'))).getroot()
    return doc, fns


def write_docx_xml(docx_path: str, doc: etree._Element, fns: etree._Element | None = None) -> None:
    """Rewrite document.xml (and optionally footnotes.xml) in place."""
    tmp = docx_path + '.tmp'
    with zipfile.ZipFile(docx_path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == 'word/document.xml':
                data = etree.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif fns is not None and item.filename == 'word/footnotes.xml':
                data = etree.tostring(fns, xml_declaration=True, encoding='UTF-8', standalone=True)
            dst.writestr(item, data)
    os.replace(tmp, docx_path)


# ── Bookmark + footnote indexing ────────────────────────────────────────

def build_bookmark_to_fnid(doc: etree._Element) -> dict[str, int]:
    """Resolve _Ref_fn* / _Ref_corrfn* bookmarks to the xml fn_id they wrap."""
    out: dict[str, int] = {}
    for bs in doc.iter(f'{{{W}}}bookmarkStart'):
        name = bs.get(f'{{{W}}}name', '')
        if not (name.startswith('_Ref_fn') or name.startswith('_Ref_corrfn')):
            continue
        parent = bs.getparent()
        idx = list(parent).index(bs)
        for sib in parent[idx+1:]:
            if sib.tag == f'{{{W}}}bookmarkEnd':
                break
            ref = sib if sib.tag == f'{{{W}}}footnoteReference' else sib.find(f'.//{{{W}}}footnoteReference')
            if ref is not None:
                out[name] = int(ref.get(f'{{{W}}}id'))
                break
    return out


def get_fn_text(fn: etree._Element) -> str:
    return ''.join(t.text or '' for t in fn.iter(f'{{{W}}}t'))


def fn_by_id(fns_root: etree._Element) -> dict[int, etree._Element]:
    out: dict[int, etree._Element] = {}
    for fn in fns_root.findall(f'{{{W}}}footnote'):
        fid = fn.get(f'{{{W}}}id')
        if fid is not None:
            out[int(fid)] = fn
    return out


# ── Paragraph rendering with NOTEREF placeholders ──────────────────────

def paragraph_text_with_refs(p: etree._Element) -> str:
    """Linearize a paragraph, replacing NOTEREF fields with {{REF:_Ref_fnN}}."""
    out: list[str] = []
    in_field = False
    instr_buf: list[str] = []
    for el in p.iter():
        tag = etree.QName(el).localname
        if tag == 'fldChar':
            ftype = el.get(f'{{{W}}}fldCharType')
            if ftype == 'begin':
                in_field = True
                instr_buf = []
            elif ftype == 'end':
                if instr_buf:
                    m = re.search(r'NOTEREF\s+(' + BM_PREFIX + r')', ''.join(instr_buf))
                    if m:
                        out.append('{{REF:' + m.group(1) + '}}')
                in_field = False
                instr_buf = []
        elif tag == 'instrText':
            if in_field:
                instr_buf.append(el.text or '')
        elif tag == 't' and not in_field:
            out.append(el.text or '')
    return ''.join(out)


# ── Mechanical audit ────────────────────────────────────────────────────

def extract_leading_authors(text: str) -> str:
    text = text.strip()
    text = SIGNAL_PREFIX.sub('', text)
    return text[:250]


def audit_references(doc: etree._Element, fns: etree._Element) -> list[dict]:
    bm_map = build_bookmark_to_fnid(doc)
    fns_idx = fn_by_id(fns)

    findings: list[dict] = []

    def scan(container, source_label):
        for p in container.iter(f'{{{W}}}p'):
            txt = paragraph_text_with_refs(p)
            low = txt.lower()
            if 'supra' not in low and 'infra' not in low:
                continue
            for m in SUPRA_PAT.finditer(txt):
                surnames_raw = m.group(1).strip(' ,')
                kind = m.group(2)
                bm = m.group(3)
                target_fid = bm_map.get(bm)
                pre = txt[max(0, m.start()-80):m.start()].strip()
                entry: dict = {
                    'source': source_label,
                    'kind': kind,
                    'context_pre': pre,
                    'surnames_raw': surnames_raw,
                    'bookmark': bm,
                }
                if target_fid is None:
                    entry.update({'target_fn': None, 'status': 'unresolved_bookmark'})
                else:
                    target_fn = fns_idx.get(target_fid)
                    target_text = get_fn_text(target_fn).strip() if target_fn is not None else ''
                    entry.update({
                        'target_fn': target_fid,
                        'target_text': target_text[:300],
                        'target_lead': extract_leading_authors(target_text),
                    })
                findings.append(entry)

    for fid, fn in fns_idx.items():
        if fid >= 1:
            scan(fn, f'fn{fid}')
    scan(doc, 'body')
    return findings


def mark_suspicion(findings: list[dict]) -> list[dict]:
    suspicious: list[dict] = []
    for f in findings:
        lead = f.get('target_lead', '')
        if not lead:
            f['status'] = f.get('status', 'unresolved_target')
            suspicious.append(f)
            continue
        tokens = re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", f['surnames_raw'])
        tokens = [t for t in tokens if t not in STOP_TOKENS]
        if not tokens:
            f['status'] = 'no_surname_tokens'
            continue
        missing = [t for t in tokens if t not in lead]
        if missing:
            f['missing_surnames'] = missing
            f['matched_surnames'] = [t for t in tokens if t in lead]
            f['status'] = 'surname_mismatch'
            suspicious.append(f)
        else:
            f['status'] = 'ok'
    return suspicious


# ── Grep first-cite resolver ───────────────────────────────────────────

# Signal words / regex artifacts to strip from surnames before tokenizing
_GREP_STOP = {
    'See', 'Also', 'But', 'Cf', 'Compare', 'With', 'Generally', 'Eg', 'E', 'G',
    'I', 'A', 'An', 'The', 'Id', 'Accord', 'Contra', 'Of', 'In', 'For',
    'And', 'Or', 'It', 'Is', 'At', 'On', 'To', 'By', 'As', 'Has', 'Have',
}


def _extract_name_tokens(surnames_raw: str) -> list[str]:
    """Pull capitalized identifier tokens from the raw reference fragment.

    The fragment is whatever precedes "supra/infra note N" — it can be:
      - author surnames        ("Hu, Malenko & Zytnick")
      - hereinafter short form ("GAO Report")
      - institutional doc      ("Best Practice Principles")
      - case name              ("ISS v. SEC")
      - title fragment         ("Power of Proxy Advisors")

    Drops Bluebook signals (See, See also, But see, Cf., E.g.) and other
    high-frequency junk so we can grep precisely. When the capture pulled
    in surrounding sentence text (e.g., "These patterns are consistent with
    Choi, Fisch & Kahan, Who Calls the Shots?"), strip back to the LAST
    contiguous capitalized-identifier span — that's the actual short form.

    Returns the capitalized tokens that should appear in the target
    footnote's first cite.
    """
    # Strip leading signal phrases
    s = re.sub(
        r'^(See(?:,?\s+e\.g\.,?)?\s+|E\.g\.,?\s+|Cf\.\s+|See\s+also\s+|But\s+see\s+|Accord\s+|Contra\s+|See(?:,)?\s+)',
        '', surnames_raw.strip(), flags=re.IGNORECASE,
    )

    # If the capture contains lowercase connective words (with, of, by, as, to,
    # are, is, that, which, and, for) BEFORE the last capitalized run, trim
    # to just the trailing short form.
    last_short_form = re.search(
        r"([A-Z][A-Za-z0-9.’'\-]+(?:[ ,&]+(?:[A-Z][A-Za-z0-9.’'\-?!:\"“”]+|the|and|of|in|for|on|to|de|von|van|la|el)\b)*[?!]?)\s*$",
        s,
    )
    if last_short_form:
        trimmed = last_short_form.group(1)
        # Only use the trimmed version if it looks like a real short form
        # (has at least one capitalized token and is shorter than the original)
        cap_count = len(re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", trimmed))
        if cap_count >= 1 and len(trimmed) < len(s):
            s = trimmed

    tokens = re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", s)
    return [t for t in tokens if t not in _GREP_STOP]


def grep_first_cite(
    surnames_raw: str,
    fns_root: etree._Element,
    source_fn: int | None = None,
) -> tuple[int, str]:
    """Find the FIRST footnote whose body contains all surname tokens AND is
    not itself just a `<X>, supra` reference.

    Returns (fn_id, status). status ∈ {'unique', 'ambiguous', 'no_match', 'no_tokens'}.
    A 'unique' hit is safe to apply without Gemini; everything else defers.
    """
    tokens = _extract_name_tokens(surnames_raw)
    if not tokens:
        return 0, 'no_tokens'

    candidates: list[int] = []
    for fn in fns_root.findall(f'{{{W}}}footnote'):
        fid_s = fn.get(f'{{{W}}}id')
        if fid_s is None:
            continue
        fid = int(fid_s)
        if fid < 1 or fid == source_fn:
            continue
        text = get_fn_text(fn).strip()
        if not text:
            continue
        # Skip footnotes whose ENTIRE meaningful content is one supra/infra reference
        # — e.g., "Gallagher, supra note 56." — they contain no first cite.
        # Footnotes that merely start with a supra but then introduce fresh cites
        # (separated by `;`, `.`, or `See also`) ARE kept.
        stripped = re.sub(r'\s+', ' ', text)
        if re.fullmatch(r"[A-Z][\w &,.''\-]{0,80}?,?\s+(?:supra|infra)\s+notes?\s+\d+\s*(?:,\s+at\s+[\w\-–]+)?\.?\s*", stripped):
            continue
        # To find genuine first cites, we want surname tokens to appear OUTSIDE
        # any nearby `supra note N` phrase. Remove all supra/infra references
        # from the text before checking — that way, "X, supra note Y" in the
        # body doesn't count as a match for X.
        sansupra = re.sub(
            r"[A-Z][\w &,.''\-?!:\"“”]{0,180}?,?\s+(?:supra|infra)\s+notes?\s+\d+(?:\s*[-–]\s*\d+)?(?:,\s+at\s+[\w\-–]+)?",
            " ",
            text,
        )
        ok = True
        for tok in tokens:
            if not re.search(r'\b' + re.escape(tok) + r'\b', sansupra):
                ok = False
                break
        if ok:
            candidates.append(fid)

    if len(candidates) == 0:
        return 0, 'no_match'
    if len(candidates) == 1:
        return candidates[0], 'unique'
    # Multiple — return the earliest in doc order; mark ambiguous
    return min(candidates), 'ambiguous'


def grep_retarget(findings: list[dict], fns_root: etree._Element) -> dict[tuple[int, str, str], tuple[int, str]]:
    """Run grep_first_cite for every unique (source_fn, surnames, bookmark) triple.

    Returns {triple: (target_fn_id, status)}. Callers split into:
      - status=='unique': apply directly (no Gemini needed)
      - status in {'ambiguous','no_match','no_tokens'}: defer to Gemini
    """
    out: dict[tuple[int, str, str], tuple[int, str]] = {}
    seen: set[tuple[int, str, str]] = set()
    for f in findings:
        src = f.get('source', '')
        src_fn = int(src.replace('fn', '')) if src.startswith('fn') else 0
        triple = (src_fn, f['surnames_raw'], f['bookmark'])
        if triple in seen:
            continue
        seen.add(triple)
        target, status = grep_first_cite(f['surnames_raw'], fns_root, source_fn=src_fn)
        out[triple] = (target, status)
    return out


# ── Gemini retargeting ─────────────────────────────────────────────────

def build_fn_index_for_gemini(fns: etree._Element) -> list[dict]:
    out = []
    for fn in fns.findall(f'{{{W}}}footnote'):
        fid = fn.get(f'{{{W}}}id')
        if fid is None or int(fid) < 1:
            continue
        text = get_fn_text(fn).strip()
        if not text:
            continue
        out.append({'fn_id': int(fid), 'text': text[:400]})
    return out


def _build_ref_prompt(ref: dict, catalog: str) -> str:
    """Per-reference prompt — used by both --gemini and --batch modes.

    The "ref identifier" can be any Bluebook short-form: author surnames,
    a [hereinafter X] tag, an institutional document name, a case name, or
    a title fragment. Don't assume it's a personal name.
    """
    return (
        "You are auditing one cross-reference in a law review article. The "
        "reference text reads `<short-form identifier>, supra/infra note N`. "
        "The identifier can be any Bluebook short form — author surnames, "
        "an institutional document title (e.g., \"GAO Report\", \"Best Practice "
        "Principles\"), a [hereinafter X] tag, a case name (e.g., \"ISS v. SEC\"), "
        "or a paper title fragment. Identify the SINGLE footnote in the catalog "
        "below whose FIRST CITATION matches that short form. The first cite may "
        "not be the leading text of the target footnote — search the entire "
        "footnote, including content after `See also`, `;`, or semicolon-"
        "separated cite lists.\n\n"
        "Reply with JSON: {\"target_fn_id\": <int>, \"confidence\": \"high|medium|low\", "
        "\"reasoning\": \"<one sentence>\"}. Use target_fn_id=0 only when no "
        "footnote in the catalog plausibly matches.\n\n"
        f"ref identifier: {ref.get('surnames') or ref.get('ref_id', '')}\n"
        f"ref kind: {ref['kind']} (supra=back-ref, infra=forward-ref)\n"
        f"context before ref: {ref.get('context_pre', '')[-160:]}\n"
        f"current (suspected wrong) target_fn_id: {ref.get('current_target')}\n\n"
        "Footnote catalog (one per line as `FN<id>: <leading text>`):\n"
        f"{catalog}"
    )


_REF_SCHEMA = {
    'type': 'object',
    'properties': {
        'target_fn_id': {'type': 'integer'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
        'reasoning': {'type': 'string'},
    },
    'required': ['target_fn_id', 'confidence'],
}


def _unique_refs(suspicious: list[dict], findings: list[dict]) -> list[dict]:
    """Build de-duplicated reference payload from suspicious refs."""
    seen: dict[tuple[int, str, str], dict] = {}
    # Walk findings (not suspicious) so callers can pass the full set
    for f in findings:
        src = f.get('source', '')
        src_fn = int(src.replace('fn', '')) if src.startswith('fn') else 0
        key = (src_fn, f['surnames_raw'], f['bookmark'])
        seen.setdefault(key, {
            'source_fn': src_fn,
            'surnames': f['surnames_raw'],
            'kind': f.get('kind', 'supra'),
            'context_pre': f.get('context_pre', ''),
            'current_target': f.get('target_fn'),
            'current_bookmark': f['bookmark'],
        })
    return list(seen.values())


def gemini_batch_retarget(
    findings: list[dict],
    fn_index: list[dict],
    out_dir: Path,
    *,
    gcs_bucket: str,
    project: str,
    location: str = 'us-central1',
    model: str = 'gemini-3.1-flash-lite-preview',
    poll_interval: int = 30,
    timeout_sec: int = 3600,
) -> dict[tuple[int, str, str], int]:
    """Submit each reference as an independent Gemini Batch request via Vertex AI.

    JSONL is uploaded to a GCS bucket; output is read back from GCS. Each
    reference gets its OWN prompt, so the model cannot skim a long batched
    context — coverage is guaranteed.
    Returns {(source_fn, surnames, bookmark): target_fn_id}.
    """
    try:
        from google import genai
        from google.cloud import storage
    except ImportError:
        raise SystemExit("Need: uv run --with google-genai --with google-cloud-storage ...")

    client = genai.Client(vertexai=True, project=project, location=location)
    storage_client = storage.Client(project=project)
    bucket = storage_client.bucket(gcs_bucket)

    catalog = "\n".join(f"FN{e['fn_id']}: {e['text']}" for e in fn_index)
    refs = _unique_refs([], findings)

    # Build JSONL — one independent request per reference
    jsonl_path = out_dir / 'crossref_batch_requests.jsonl'
    with jsonl_path.open('w') as fp:
        for i, r in enumerate(refs):
            req_body = {
                'contents': [{'role': 'user', 'parts': [{'text': _build_ref_prompt(r, catalog)}]}],
                'generationConfig': {
                    'responseMimeType': 'application/json',
                    'responseSchema': _REF_SCHEMA,
                },
            }
            # gemini-3.x thinking models must opt out or batch returns empty
            if model.startswith('gemini-3'):
                req_body['generationConfig']['thinkingConfig'] = {'thinkingLevel': 'MINIMAL'}
            row = {'key': f'ref-{i:04d}', 'request': req_body}
            fp.write(json.dumps(row) + '\n')

    print(f"Wrote {len(refs)} JSONL requests → {jsonl_path}")

    import time
    stamp = time.strftime('%Y%m%d_%H%M%S')
    input_blob_name = f'crossref-audit/{stamp}/input.jsonl'
    output_prefix = f'crossref-audit/{stamp}/outputs/'
    input_uri = f'gs://{gcs_bucket}/{input_blob_name}'
    output_uri = f'gs://{gcs_bucket}/{output_prefix}'

    print(f"Uploading JSONL → {input_uri}")
    bucket.blob(input_blob_name).upload_from_filename(str(jsonl_path))

    print(f"Submitting Vertex AI batch job (model={model}, project={project}, location={location})…")
    job = client.batches.create(
        model=model,
        src=input_uri,
        config={'display_name': f'crossref-audit-{stamp}', 'dest': output_uri},
    )
    print(f"  job: {job.name}  state: {job.state}")
    (out_dir / 'crossref_batch_job.json').write_text(json.dumps({
        'job_name': job.name,
        'input_uri': input_uri,
        'output_uri': output_uri,
        'model': model,
        'project': project,
        'location': location,
        'num_requests': len(refs),
    }, indent=2))

    # Poll
    start = time.time()
    TERMINAL = {'JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'}
    while True:
        job = client.batches.get(name=job.name)
        elapsed = int(time.time() - start)
        print(f"  [{elapsed}s] state={job.state}")
        if job.state in TERMINAL:
            break
        if elapsed > timeout_sec:
            raise TimeoutError(f"Batch job timed out after {elapsed}s")
        time.sleep(poll_interval)

    if job.state != 'JOB_STATE_SUCCEEDED':
        raise RuntimeError(f"Batch job ended in {job.state}: {getattr(job, 'error', '')}")

    # Download results — output URI is a prefix in Vertex AI
    print(f"Listing results under {output_uri}…")
    results_path = out_dir / 'crossref_batch_results.jsonl'
    with results_path.open('wb') as out_fp:
        for blob in storage_client.list_blobs(gcs_bucket, prefix=output_prefix):
            if blob.name.endswith('.jsonl') or 'predictions' in blob.name:
                print(f"  reading {blob.name}")
                out_fp.write(blob.download_as_bytes())

    # Parse results
    class RemapDict(dict):
        pass
    out = RemapDict()
    confidence: dict[tuple[int, str, str], str] = {}
    reasoning: dict[tuple[int, str, str], str] = {}
    ref_by_idx = {f'ref-{i:04d}': r for i, r in enumerate(refs)}

    parsed = 0
    with results_path.open() as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            key = row.get('key') or row.get('id')
            ref = ref_by_idx.get(key)
            if not ref:
                continue
            try:
                resp = row.get('response', {})
                cands = resp.get('candidates', [])
                if not cands:
                    print(f"  empty candidates for {key}")
                    continue
                txt = cands[0]['content']['parts'][0]['text']
                data = json.loads(txt)
            except Exception as e:
                print(f"  parse error for {key}: {e}")
                continue
            triple = (ref['source_fn'], ref['surnames'], ref['current_bookmark'])
            out[triple] = int(data.get('target_fn_id', 0))
            confidence[triple] = data.get('confidence', 'medium')
            reasoning[triple] = data.get('reasoning', '')
            parsed += 1

    print(f"Parsed {parsed}/{len(refs)} responses")
    out._confidence = confidence  # type: ignore[attr-defined]
    out._reasoning = reasoning  # type: ignore[attr-defined]
    return out


def gemini_retarget(suspicious: list[dict], fn_index: list[dict], model: str = 'gemini-3.1-flash-lite-preview') -> dict[tuple[int, str, str], int]:
    """Ask Gemini for the correct target fn_id for each (source_fn, surnames, bookmark) triple.

    Returns {(source_fn, surnames_raw, bookmark): new_target_fn_id}.
    Uses a single batched call with structured JSON output.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise SystemExit("google-genai not installed. Run with: uv run --with google-genai ...")

    client = genai.Client(api_key=os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY'))

    catalog_lines = [f"FN{e['fn_id']}: {e['text']}" for e in fn_index]
    catalog = "\n".join(catalog_lines)

    # Dedupe to unique (source_fn, surnames_raw, bookmark) triples
    seen: dict[tuple[int, str, str], dict] = {}
    for f in suspicious:
        src = f.get('source', '')
        src_fn = int(src.replace('fn', '')) if src.startswith('fn') else 0
        key = (src_fn, f['surnames_raw'], f['bookmark'])
        seen.setdefault(key, f)

    refs_payload = [
        {
            'ref_id': i,
            'source_fn': k[0],
            'surnames': k[1],
            'context_pre': v.get('context_pre', '')[-160:],
            'kind': v.get('kind', 'supra'),
            'current_bookmark': k[2],
        }
        for i, (k, v) in enumerate(seen.items())
    ]

    prompt = (
        "You are auditing a law review article's cross-references. Each entry in `references` "
        "is a hand-typed `<surnames>, supra/infra note N` reference whose bookmark target is "
        "suspected wrong. For each reference, identify the SINGLE footnote in `catalog` whose "
        "leading citation best matches the surnames / short-form title / hereinafter tag. "
        "Return one entry per ref_id with the integer fn_id of the correct target, or 0 if "
        "no match.\n\n"
        f"references:\n{json.dumps(refs_payload, indent=1)}\n\n"
        f"catalog:\n{catalog}"
    )

    schema = {
        'type': 'object',
        'properties': {
            'mappings': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'ref_id': {'type': 'integer'},
                        'target_fn_id': {'type': 'integer'},
                        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
                    },
                    'required': ['ref_id', 'target_fn_id'],
                },
            },
        },
        'required': ['mappings'],
    }

    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type='application/json',
            response_schema=schema,
        ),
    )

    data = json.loads(resp.text)
    keys = list(seen.keys())

    class RemapDict(dict):
        pass

    out = RemapDict()
    confidence: dict[tuple[int, str, str], str] = {}
    for m in data.get('mappings', []):
        i = m['ref_id']
        if 0 <= i < len(keys):
            out[keys[i]] = m['target_fn_id']
            confidence[keys[i]] = m.get('confidence', 'medium')
    out._confidence = confidence  # type: ignore[attr-defined]
    return out


# ── Apply: re-point bookmarks ──────────────────────────────────────────

def max_bookmark_id(doc: etree._Element) -> int:
    mx = 0
    for tag in (f'{{{W}}}bookmarkStart', f'{{{W}}}bookmarkEnd'):
        for el in doc.iter(tag):
            bid = el.get(f'{{{W}}}id')
            if bid and bid.lstrip('-').isdigit():
                mx = max(mx, int(bid))
    return mx


def ensure_bookmark_for_fn(doc: etree._Element, target_fn_id: int, next_id: list[int]) -> str | None:
    """Ensure a bookmark named `_Ref_corrfn<target_fn_id>` exists wrapping the
    first footnoteReference for target_fn_id. Returns the bookmark name."""
    bm_name = f'_Ref_corrfn{target_fn_id}'
    for bs in doc.iter(f'{{{W}}}bookmarkStart'):
        if bs.get(f'{{{W}}}name') == bm_name:
            return bm_name
    for ref in doc.iter(f'{{{W}}}footnoteReference'):
        if ref.get(f'{{{W}}}id') != str(target_fn_id):
            continue
        if ref.get(f'{{{W}}}customMarkFollows') == '1':
            continue
        run = ref.getparent()
        while run is not None and etree.QName(run).localname != 'r':
            run = run.getparent()
        if run is None:
            continue
        parent = run.getparent()
        idx = list(parent).index(run)
        bid = next_id[0]
        next_id[0] += 1
        bs = etree.Element(f'{{{W}}}bookmarkStart')
        bs.set(f'{{{W}}}id', str(bid))
        bs.set(f'{{{W}}}name', bm_name)
        parent.insert(idx, bs)
        be = etree.Element(f'{{{W}}}bookmarkEnd')
        be.set(f'{{{W}}}id', str(bid))
        parent.insert(idx + 2, be)
        return bm_name
    return None


def apply_remap_per_ref(
    doc: etree._Element,
    fns: etree._Element,
    remap: dict[tuple[int, str, str], int],
) -> tuple[int, list[str]]:
    """For each (source_fn, surnames, bookmark) triple in remap, locate the
    NOTEREF field in the source footnote and update its instrText to reference
    a new `_Ref_corrfn<target_fn_id>` bookmark (creating the bookmark in
    document.xml if needed)."""
    applied = 0
    skipped: list[str] = []
    next_id = [max_bookmark_id(doc) + 1]

    # Cache bookmark creation per target_fn_id
    target_to_bm: dict[int, str] = {}

    # Index footnotes by id
    fns_by_id: dict[int, etree._Element] = {}
    for fn in fns.findall(f'{{{W}}}footnote'):
        fid = fn.get(f'{{{W}}}id')
        if fid is not None:
            fns_by_id[int(fid)] = fn

    for (src_fn, surnames, old_bm), new_target in remap.items():
        if new_target <= 0:
            skipped.append(f"fn{src_fn} '{surnames}': no target")
            continue
        fn = fns_by_id.get(src_fn)
        if fn is None:
            skipped.append(f"fn{src_fn} '{surnames}': source not found")
            continue
        # Ensure bookmark exists at target
        if new_target not in target_to_bm:
            bm_name = ensure_bookmark_for_fn(doc, new_target, next_id)
            if bm_name is None:
                skipped.append(f"fn{src_fn} '{surnames}': cannot bookmark fn{new_target}")
                continue
            target_to_bm[new_target] = bm_name
        new_bm = target_to_bm[new_target]

        # Find the matching NOTEREF instr in source footnote where the
        # preceding text matches `surnames`. We look for instrText referencing
        # old_bm, and inspect the paragraph text leading up to it.
        rewrote = False
        for p in fn.iter(f'{{{W}}}p'):
            ptxt = paragraph_text_with_refs(p)
            if old_bm not in ptxt or surnames.split(',')[0].split()[0] not in ptxt:
                continue
            # Find instrText elements containing NOTEREF old_bm
            for instr in p.iter(f'{{{W}}}instrText'):
                txt = instr.text or ''
                if old_bm in txt and 'NOTEREF' in txt:
                    instr.text = txt.replace(old_bm, new_bm)
                    rewrote = True
                    applied += 1
                    break  # only one ref per (src_fn, surnames) match
            if rewrote:
                break
        if not rewrote:
            skipped.append(f"fn{src_fn} '{surnames}': NOTEREF for {old_bm} not found in paragraph")
    return applied, skipped


# ── Report ─────────────────────────────────────────────────────────────

def write_report(
    out_dir: Path,
    findings: list[dict],
    suspicious: list[dict],
    remap: dict[tuple[int, str, str], int] | None,
) -> Path:
    md = ["# Cross-Reference Target Audit", ""]
    md.append(f"- Total cross-references scanned: **{len(findings)}**")
    kinds = Counter(f['kind'] for f in findings)
    md.append(f"- By kind: {dict(kinds)}")
    statuses = Counter(f.get('status', '?') for f in findings)
    md.append(f"- By status: {dict(statuses)}")
    md.append(f"- Suspicious (surname tokens not in target): **{len(suspicious)}**")
    md.append("")

    confidence = getattr(remap, '_confidence', {}) if remap else {}

    if suspicious:
        md.append("## Suspicious references")
        for s in suspicious:
            src = s.get('source', '')
            src_fn = int(src.replace('fn', '')) if src.startswith('fn') else 0
            key = (src_fn, s['surnames_raw'], s['bookmark'])
            md.append(f"### {s['source']} → {s['bookmark']} ({s['kind']})")
            md.append(f"- Surnames written: `{s['surnames_raw']}`")
            md.append(f"- Current target: fn{s.get('target_fn')} — {(s.get('target_text') or '')[:160]}")
            if remap and key in remap:
                new = remap[key]
                conf = confidence.get(key, '?')
                md.append(f"- **Gemini proposes:** fn{new} (confidence: {conf})")
            md.append("")

    path = out_dir / 'CROSSREF_AUDIT.md'
    path.write_text("\n".join(md))
    return path


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--docx', required=True)
    ap.add_argument('--out', default=None, help="Output dir (default: <docx-dir>/scratch)")
    ap.add_argument('--grep', action='store_true', help="Deterministic first pass: resolve each reference by grepping the doc for the first non-supra footnote containing all surname tokens. No LLM calls. Defers ambiguous/no-match cases for --gemini or --batch.")
    ap.add_argument('--gemini', action='store_true', help="Single batched sync call to Gemini for corrected targets (fast, but coverage-risky)")
    ap.add_argument('--batch', action='store_true', help="Submit each reference as an independent Vertex AI Batch request — production-grade coverage")
    ap.add_argument('--apply', action='store_true', help="Re-point bookmarks in the DOCX (requires --gemini, --batch, or --remap)")
    ap.add_argument('--remap', default=None, help="JSON file with {bookmark: fn_id} to apply (skip Gemini)")
    ap.add_argument('--model', default='gemini-3.1-flash-lite-preview',
                    help="Gemini model. Default: latest flash-lite preview (cheapest, fast).")
    ap.add_argument('--gcs-bucket', default=os.environ.get('GEMINI_BATCH_BUCKET', 'nal-batch-extraction'),
                    help="GCS bucket for --batch (default: nal-batch-extraction or $GEMINI_BATCH_BUCKET)")
    ap.add_argument('--project', default=os.environ.get('GOOGLE_CLOUD_PROJECT', 'activist-defense-nal'),
                    help="GCP project for Vertex AI (default: activist-defense-nal or $GOOGLE_CLOUD_PROJECT)")
    ap.add_argument('--location', default='us-central1')
    args = ap.parse_args()

    docx = os.path.abspath(args.docx)
    out_dir = Path(args.out or (Path(docx).parent / 'scratch'))
    out_dir.mkdir(parents=True, exist_ok=True)

    doc, fns = load_docx_xml(docx)
    findings = audit_references(doc, fns)
    suspicious = mark_suspicion(findings)

    (out_dir / 'crossref_audit.json').write_text(json.dumps(findings, indent=2))
    print(f"Scanned {len(findings)} cross-references — {len(suspicious)} suspicious")

    remap: dict[tuple[int, str, str], int] | None = None
    if args.remap:
        raw = json.loads(Path(args.remap).read_text())
        if isinstance(raw, dict) and 'remap' in raw:
            raw = raw['remap']
        remap = {tuple(json.loads(k)): int(v) for k, v in raw.items()}

    # --grep: deterministic first pass. Always runs when --grep is set; can be
    # chained with --gemini/--batch which then only handle ambiguous/no-match.
    grep_unique: dict[tuple[int, str, str], int] = {}
    grep_deferred: list[dict] = []
    if args.grep:
        gr = grep_retarget(findings, fns)
        for triple, (target, status) in gr.items():
            if status == 'unique':
                grep_unique[triple] = target
            else:
                # Find the matching finding entry to defer to LLM passes
                for f in findings:
                    src = f.get('source', '')
                    sf = int(src.replace('fn', '')) if src.startswith('fn') else 0
                    if (sf, f['surnames_raw'], f['bookmark']) == triple:
                        grep_deferred.append(f)
                        break
        statuses = Counter(s for _, s in gr.values())
        print(f"--grep results: {dict(statuses)}")
        print(f"  resolved deterministically: {len(grep_unique)}")
        print(f"  deferred to LLM (ambiguous/no_match/no_tokens): {len(grep_deferred)}")
        # Save grep remap
        (out_dir / 'crossref_remap_grep.json').write_text(json.dumps({
            'remap': {json.dumps(list(k)): v for k, v in grep_unique.items()},
            'status': {json.dumps(list(k)): s for k, (_, s) in gr.items()},
        }, indent=2))
        # If no LLM mode requested, use grep result as the remap
        if not args.gemini and not args.batch and grep_unique:
            class RemapDict(dict):
                pass
            remap = RemapDict()
            remap.update(grep_unique)
            remap._confidence = {k: 'deterministic' for k in grep_unique}  # type: ignore[attr-defined]

    # When chaining grep → gemini/batch, only LLM-process the deferred set
    pool = grep_deferred if args.grep else findings

    if False:
        pass
    elif args.batch and pool:
        fn_index = build_fn_index_for_gemini(fns)
        n_unique = len({(f.get('source','').replace('fn',''), f['surnames_raw'], f['bookmark']) for f in pool})
        print(f"Submitting {n_unique} independent Vertex AI Batch requests (model={args.model})…")
        remap_llm = gemini_batch_retarget(
            pool, fn_index, out_dir,
            gcs_bucket=args.gcs_bucket,
            project=args.project,
            location=args.location,
            model=args.model,
        )
        # Merge grep_unique (high-trust) + LLM proposals (lower-trust)
        merged = type('RemapDict', (dict,), {})()
        merged.update(grep_unique)
        for k, v in remap_llm.items():
            if k not in merged:
                merged[k] = v
        merged._confidence = {k: 'deterministic' for k in grep_unique}  # type: ignore[attr-defined]
        merged._confidence.update(getattr(remap_llm, '_confidence', {}))
        merged._reasoning = getattr(remap_llm, '_reasoning', {})
        remap = merged
        (out_dir / 'crossref_remap.json').write_text(json.dumps({
            'remap': {json.dumps(list(k)): v for k, v in remap.items()},
            'confidence': {json.dumps(list(k)): c for k, c in merged._confidence.items()},
            'reasoning': {json.dumps(list(k)): r for k, r in merged._reasoning.items()},
        }, indent=2))
    elif args.gemini and pool:
        fn_index = build_fn_index_for_gemini(fns)
        unique_triples = len({(f.get('source','').replace('fn',''), f['surnames_raw'], f['bookmark']) for f in pool})
        print(f"Asking Gemini ({args.model}) about {unique_triples} unique (fn, surnames, bookmark) triples — single batched call…")
        remap_llm = gemini_retarget(pool, fn_index, model=args.model)
        merged = type('RemapDict', (dict,), {})()
        merged.update(grep_unique)
        for k, v in remap_llm.items():
            if k not in merged:
                merged[k] = v
        merged._confidence = {k: 'deterministic' for k in grep_unique}
        merged._confidence.update(getattr(remap_llm, '_confidence', {}))
        remap = merged
        (out_dir / 'crossref_remap.json').write_text(json.dumps({
            'remap': {json.dumps(list(k)): v for k, v in remap.items()},
            'confidence': {json.dumps(list(k)): c for k, c in merged._confidence.items()},
        }, indent=2))

    report = write_report(out_dir, findings, suspicious, remap)
    print(f"Report: {report}")

    if args.apply:
        if not remap:
            sys.exit("--apply requires --gemini, --batch, or --remap")
        applied, skipped = apply_remap_per_ref(doc, fns, remap)
        write_docx_xml(docx, doc, fns)
        print(f"Applied: {applied} NOTEREF rewires")
        if skipped:
            print(f"  ({len(skipped)} skipped — see report)")


if __name__ == '__main__':
    main()
