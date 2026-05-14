#!/usr/bin/env -S uv run --with lxml python3
"""Integrate sources.bib into the docx (paths A + B).

A. RENAME — For each supra/infra ref in the docx, determine which bibkey it
   refers to (by matching surnames against bib entry authors/titles, scoped
   to the same target footnote). Replace the current `_Ref_corrfn<N>` /
   `_Ref_fn<N>` bookmark name with `_RefBib_<bibkey>`. Create new bookmarks
   (multiple per multi-cite footnote — each pointing at the same body
   footnoteReference but with a distinct bibkey-name). Update NOTEREF
   instrText to reference the new names.

B. VALIDATE — For each supra ref now pointing at `_RefBib_<bibkey>`, check
   whether the supra's hand-written surnames match the bibkey's author
   field. Emit SUPRA_BIB_AUDIT.md flagging mismatches.

Usage:
    bib_integrate.py --docx FILE.docx --bib sources.bib [--apply]
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree


W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def load_zip(docx: str) -> tuple[etree._Element, etree._Element]:
    z = zipfile.ZipFile(docx)
    doc = etree.parse(io.BytesIO(z.read('word/document.xml'))).getroot()
    fns = etree.parse(io.BytesIO(z.read('word/footnotes.xml'))).getroot()
    return doc, fns


def write_zip(docx: str, doc: etree._Element, fns: etree._Element) -> None:
    tmp = docx + '.tmp'
    with zipfile.ZipFile(docx) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == 'word/document.xml':
                data = etree.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif item.filename == 'word/footnotes.xml':
                data = etree.tostring(fns, xml_declaration=True, encoding='UTF-8', standalone=True)
            dst.writestr(item, data)
    os.replace(tmp, docx)


def parse_bib(bib_path: str) -> list[dict]:
    """Parse BibTeX into list of {bibkey, type, fields, fn_id}. Reads
    note={fnN} to extract the manuscript footnote tag."""
    text = Path(bib_path).read_text()
    entries: list[dict] = []
    # Match: @type{bibkey, ... }
    for m in re.finditer(r'@(\w+)\{([^,]+),', text):
        bibkey = m.group(2).strip()
        kind = m.group(1).strip().lower()
        start = m.end()
        # Find matching closing brace
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            c = text[i]
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            i += 1
        body = text[start:i-1]
        fields: dict[str, str] = {}
        for fm in re.finditer(r'(\w+)\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}', body):
            fields[fm.group(1).lower()] = fm.group(2).strip()
        # Pull fn_id from note (if present)
        fn_id = None
        note = fields.get('note', '')
        nm = re.search(r'fn(\d+)', note)
        if nm:
            fn_id = int(nm.group(1))
        entries.append({'bibkey': bibkey, 'kind': kind, 'fields': fields, 'fn_id': fn_id})
    return entries


def build_fn_to_bibkeys(bib: list[dict]) -> dict[int, list[dict]]:
    """Legacy: bib's note={fnN} tag → fn_id. Unreliable when sources.md was
    extracted from an older draft (numbers shifted)."""
    out: dict[int, list[dict]] = {}
    for e in bib:
        if e['fn_id'] is not None:
            out.setdefault(e['fn_id'], []).append(e)
    return out


def _bib_signature_tokens(e: dict) -> list[str]:
    """Tokens that uniquely identify a bib entry in the docx — author surnames
    and the most distinctive title words."""
    tokens: list[str] = []
    authors = e['fields'].get('author', '')
    if authors:
        # Last word of each "First Last" or "First Last and First Last"
        for piece in re.split(r'\s+and\s+', authors):
            last = re.findall(r"[A-Z][a-zA-Z'’\-]+", piece)
            if last:
                tokens.append(last[-1])
    title = re.sub(r'[{}]', '', e['fields'].get('title', ''))
    # Distinctive title tokens (capitalized words, excluding stop)
    stop = {'The', 'A', 'An', 'And', 'Of', 'In', 'For', 'To', 'On'}
    title_caps = [t for t in re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", title) if t not in stop]
    tokens.extend(title_caps[:3])
    # Institutional bibkey prefix (gao, crs, sec)
    bk = e['bibkey']
    if re.match(r'^[a-z]+\d', bk):
        prefix = re.match(r'^[a-z]+', bk).group(0)
        if prefix not in ('the', 'and', 'see'):
            tokens.append(prefix.upper())
    return tokens


def build_fn_to_bibkeys_from_docx(bib: list[dict], fns_root: etree._Element) -> dict[int, list[dict]]:
    """For each docx footnote, find bib entries whose signature tokens appear
    in the footnote text. This re-derives the fn→bibkey map from current
    docx content, sidestepping any drift between sources.md numbering and
    current docx fn_ids."""
    # Index footnotes
    fn_texts: dict[int, str] = {}
    for fn in fns_root.findall(f'{{{W}}}footnote'):
        fid = fn.get(f'{{{W}}}id')
        if fid is None or int(fid) < 1:
            continue
        fn_texts[int(fid)] = ''.join(t.text or '' for t in fn.iter(f'{{{W}}}t'))

    out: dict[int, list[dict]] = {}
    for e in bib:
        # 1. Trust the bib's own `note = {fnN}` tag if the docx has that fn.
        # The author-curated note is more reliable than signature heuristics
        # for short titles, regulatory cites, or forward-discussion refs whose
        # signature tokens are too generic to disambiguate.
        if e['fn_id'] is not None and e['fn_id'] in fn_texts:
            out.setdefault(e['fn_id'], []).append(e)
            continue
        # 2. Otherwise derive from current docx content via signature tokens.
        toks = _bib_signature_tokens(e)
        if not toks:
            continue
        for fid, text in fn_texts.items():
            stripped = re.sub(r'\s+', ' ', text).strip()
            if re.fullmatch(r"[A-Z][\w &,.''\-?!:\"“”]{0,80}?,?\s+(?:supra|infra)\s+notes?\s+\d+\.?\s*", stripped):
                continue
            if all(re.search(r'\b' + re.escape(t) + r'\b', text, re.IGNORECASE) for t in toks):
                out.setdefault(fid, []).append(e)
                break  # one fn assignment per bibkey
    return out


# ── Pick the right bibkey for a supra ref ───────────────────────────────

def _normalize(s: str) -> str:
    return re.sub(r'[^a-z]', '', (s or '').lower())


def pick_bibkey(
    supra_surnames: str,
    bib: list[dict],
    target_fn: int,
    fn_to_keys: dict[int, list[dict]],
) -> tuple[str | None, str]:
    """Score every bib entry by token overlap with `supra_surnames`, tiebreak
    by whether the bib entry lives at the current docx target fn (via the
    re-derived fn_to_keys map). Returns (bibkey, reason)."""
    tokens = [t for t in re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", supra_surnames)
              if t not in {'See', 'Also', 'But', 'Cf', 'Eg', 'Id', 'The', 'In', 'Of', 'For', 'And'}
              and len(t) >= 2]  # 2-char surnames are real (Li, Wu, Xu, Ng, …)

    # Build set of bibkeys known to live at this target_fn (by docx content match)
    keys_at_target = {e['bibkey'] for e in fn_to_keys.get(target_fn, [])}

    # If the supra has no visible surname tokens (e.g., "But see", "See also"),
    # fall back to the bib entry at target_fn — that's the cited source we
    # know lives there.
    if not tokens:
        if len(keys_at_target) == 1:
            return next(iter(keys_at_target)), 'no_tokens_unique_at_target'
        if len(keys_at_target) > 1:
            # Multiple sources at target — without surname tokens to disambiguate,
            # prefer the bib entry whose own bibkey starts the lowest in doc
            # order (heuristic — typically the first-cited source in the fn).
            return sorted(keys_at_target)[0], 'no_tokens_multi_at_target'
        return None, 'no_tokens'

    scored = []
    for e in bib:
        f = e['fields']
        haystack = _normalize(
            f.get('author', '') + ' ' + f.get('title', '') + ' ' +
            f.get('howpublished', '') + ' ' + e['bibkey']
        )
        score = sum(1 for tok in tokens if _normalize(tok) in haystack)
        # Big bonus if this entry actually lives at the target footnote
        if e['bibkey'] in keys_at_target:
            score += 100
        scored.append((score, e['bibkey']))

    scored.sort(reverse=True)
    top = scored[0]
    if top[0] == 0:
        # No bib entry's haystack matched any surname token. But if the
        # target_fn footnote uniquely identifies a single source in the bib
        # (via docx-content match), use that — better than leaving the
        # ref on its old _Ref_corrfn bookmark.
        if len(keys_at_target) == 1:
            return next(iter(keys_at_target)), 'fallback_unique_at_target'
        return None, 'no_match'
    # Tie at top?
    ties = [s for s in scored if s[0] == top[0]]
    if len(ties) > 1:
        return top[1], f'tied_{len(ties)}_at_score_{top[0]}'
    if top[0] >= 100:
        return top[1], f'at_target_fn+tokens_{top[0]-100}'
    return top[1], f'global_tokens_{top[0]}'


# ── Find supra refs in footnotes and remap bookmarks ────────────────────

BM_PREFIX = r"_Ref_(?:corrfn|fn)\d+"
SUPRA_PAT = re.compile(
    r"(?:^|[.;]\s+|\s)"
    r"([A-Z][A-Za-z0-9.’'\-\xa0 &,?!:\"“”]{0,180}?)"
    r",?\s*(supra|infra)\s+notes?\s*\{\{REF:(" + BM_PREFIX + r"|_RefBib_[\w-]+)\}\}"
)


def build_bookmark_to_fnid(doc: etree._Element) -> dict[str, int]:
    out: dict[str, int] = {}
    for bs in doc.iter(f'{{{W}}}bookmarkStart'):
        name = bs.get(f'{{{W}}}name', '')
        if not (name.startswith('_Ref_fn') or name.startswith('_Ref_corrfn') or name.startswith('_RefBib_')):
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


def get_paragraph_text_with_refs(p: etree._Element) -> list[tuple]:
    """Walk a paragraph, return list of (text|ref_marker, bookmark_name|None, instr_element|None)
    so we can identify NOTEREF refs in context for renaming."""
    items: list[tuple] = []
    in_field = False
    instr_el = None
    for el in p.iter():
        tag = etree.QName(el).localname
        if tag == 'fldChar':
            ft = el.get(f'{{{W}}}fldCharType')
            if ft == 'begin':
                in_field = True
                instr_el = None
            elif ft == 'end':
                in_field = False
        elif tag == 'instrText' and in_field:
            instr_el = el
        elif tag == 't' and not in_field:
            items.append(('text', el.text or '', None))
    return items


def max_bookmark_id(doc: etree._Element) -> int:
    mx = 0
    for tag in (f'{{{W}}}bookmarkStart', f'{{{W}}}bookmarkEnd'):
        for el in doc.iter(tag):
            bid = el.get(f'{{{W}}}id')
            if bid and bid.lstrip('-').isdigit():
                mx = max(mx, int(bid))
    return mx


def ensure_bookmark_at_fn(doc: etree._Element, target_fn_id: int, bm_name: str, next_id: list[int]) -> bool:
    """Create a new bookmark wrapping the first body-text footnoteReference for
    target_fn_id, if it doesn't already exist."""
    for bs in doc.iter(f'{{{W}}}bookmarkStart'):
        if bs.get(f'{{{W}}}name') == bm_name:
            return True
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
        bid = next_id[0]; next_id[0] += 1
        bs = etree.Element(f'{{{W}}}bookmarkStart')
        bs.set(f'{{{W}}}id', str(bid))
        bs.set(f'{{{W}}}name', bm_name)
        parent.insert(idx, bs)
        be = etree.Element(f'{{{W}}}bookmarkEnd')
        be.set(f'{{{W}}}id', str(bid))
        parent.insert(idx + 2, be)
        return True
    return False


def precompute_cached_displays(doc: etree._Element, fns: etree._Element, bio_count: int = 3) -> int:
    """Walk every NOTEREF field and write the correct display number into the
    cached <w:t> between <fldChar separate> and <fldChar end>. Pre-computing
    means displayed numbers are correct on first read — no F9 required."""
    bm_to_fnid: dict[str, int] = {}
    for bs in doc.iter(f'{{{W}}}bookmarkStart'):
        name = bs.get(f'{{{W}}}name', '')
        if not (name.startswith('_Ref_fn') or name.startswith('_Ref_corrfn') or name.startswith('_RefBib_')):
            continue
        parent = bs.getparent()
        idx = list(parent).index(bs)
        for sib in parent[idx+1:]:
            if sib.tag == f'{{{W}}}bookmarkEnd':
                break
            ref = sib if sib.tag == f'{{{W}}}footnoteReference' else sib.find(f'.//{{{W}}}footnoteReference')
            if ref is not None:
                bm_to_fnid[name] = int(ref.get(f'{{{W}}}id'))
                break

    pat = re.compile(r'NOTEREF\s+(_Ref_(?:corrfn|fn)\d+|_RefBib_[\w-]+)')
    updated = 0
    for fn in fns.findall(f'{{{W}}}footnote'):
        for p in fn.iter(f'{{{W}}}p'):
            flat = [el for el in p.iter() if etree.QName(el).localname in ('fldChar', 'instrText', 't')]
            i = 0
            while i < len(flat):
                el = flat[i]
                if etree.QName(el).localname == 'fldChar' and el.get(f'{{{W}}}fldCharType') == 'begin':
                    bm_name, sep_idx, end_idx = None, None, None
                    for j in range(i+1, len(flat)):
                        sub = flat[j]
                        st = etree.QName(sub).localname
                        if st == 'instrText':
                            m = pat.search(sub.text or '')
                            if m:
                                bm_name = m.group(1)
                        elif st == 'fldChar':
                            ft = sub.get(f'{{{W}}}fldCharType')
                            if ft == 'separate':
                                sep_idx = j
                            elif ft == 'end':
                                end_idx = j
                                break
                    if bm_name and sep_idx and end_idx:
                        for k in range(sep_idx+1, end_idx):
                            if etree.QName(flat[k]).localname == 't':
                                target = bm_to_fnid.get(bm_name)
                                if target and target > bio_count:
                                    d = target - bio_count
                                    if flat[k].text != str(d):
                                        flat[k].text = str(d)
                                        updated += 1
                                break
                    i = (end_idx or i) + 1
                else:
                    i += 1
    return updated


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--docx', required=True)
    ap.add_argument('--bib', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--bio-count', type=int, default=3,
                    help="Number of author-bio footnotes that consume display positions (default: 3 — *, †, ‡).")
    ap.add_argument('--no-precompute', action='store_true',
                    help="Skip pre-computing cached NOTEREF display values.")
    ap.add_argument('--out-report', default=None)
    args = ap.parse_args()

    bib = parse_bib(args.bib)
    print(f"Parsed {len(bib)} bibtex entries")

    doc, fns = load_zip(args.docx)
    bm_map = build_bookmark_to_fnid(doc)

    # Re-derive fn → bibkey map from CURRENT docx content (not from bib's note={fnN}
    # tag, which is based on an older draft's numbering)
    fn_to_keys = build_fn_to_bibkeys_from_docx(bib, fns)
    print(f"Re-derived: {len(fn_to_keys)} unique docx fn_ids have bib entries; "
          f"{sum(len(v) for v in fn_to_keys.values())} (bibkey, fn_id) pairs")

    # Walk every NOTEREF supra ref in footnotes, determine target bibkey
    rename_plan: list[dict] = []  # {source_fn, surnames, old_bm, target_fn, new_bm, reason}
    BM_NOTEREF = re.compile(r'NOTEREF\s+(' + BM_PREFIX + r'|_RefBib_[\w-]+)')

    for fn in fns.findall(f'{{{W}}}footnote'):
        src_fid = fn.get(f'{{{W}}}id')
        if src_fid is None or int(src_fid) < 1:
            continue
        src_fn = int(src_fid)
        for p in fn.iter(f'{{{W}}}p'):
            # Collect (text, NOTEREF) pairs in order
            elements = []
            in_field = False
            for el in p.iter():
                tag = etree.QName(el).localname
                if tag == 'fldChar':
                    ft = el.get(f'{{{W}}}fldCharType')
                    if ft == 'begin':
                        in_field = True
                    elif ft == 'end':
                        in_field = False
                elif tag == 'instrText' and in_field:
                    m = BM_NOTEREF.search(el.text or '')
                    if m:
                        elements.append(('REF', m.group(1), el))
                elif tag == 't' and not in_field:
                    elements.append(('TEXT', el.text or '', None))

            # Walk and find each REF, with preceding TEXT as surnames context
            for i, (kind, val, el) in enumerate(elements):
                if kind != 'REF':
                    continue
                # Collect last ~120 chars of preceding text
                ctx = ''
                for j in range(i - 1, -1, -1):
                    if elements[j][0] == 'TEXT':
                        ctx = elements[j][1] + ctx
                    if len(ctx) > 160:
                        break
                # Look for the supra pattern ending at this REF
                placeholder = ctx + '{{REF:' + val + '}}'
                m = SUPRA_PAT.search(placeholder)
                target_fn = bm_map.get(val)
                if target_fn is None:
                    continue
                if m:
                    surnames = m.group(1).strip(' ,')
                else:
                    # SUPRA_PAT didn't match — context might have a `%`, fancy
                    # punctuation, or be the second half of a range ref ("-"
                    # before {{REF}}). Don't skip the ref; just hand pick_bibkey
                    # an empty surnames string so it can fall back to target_fn.
                    surnames = ''
                bibkey, reason = pick_bibkey(surnames, bib, target_fn, fn_to_keys)
                if bibkey is None:
                    rename_plan.append({
                        'source_fn': src_fn, 'surnames': surnames,
                        'old_bm': val, 'target_fn': target_fn,
                        'new_bm': None, 'reason': reason, 'instr_el': el,
                    })
                else:
                    rename_plan.append({
                        'source_fn': src_fn, 'surnames': surnames,
                        'old_bm': val, 'target_fn': target_fn,
                        'new_bm': '_RefBib_' + bibkey, 'reason': reason, 'instr_el': el,
                    })

    print(f"Walked supras: {len(rename_plan)}")
    renamed = sum(1 for r in rename_plan if r['new_bm'])
    print(f"  with bibkey assigned: {renamed}")
    print(f"  no bib at target: {len(rename_plan) - renamed}")

    # Apply
    if args.apply:
        next_id = [max_bookmark_id(doc) + 1]
        applied = 0
        for r in rename_plan:
            if not r['new_bm']:
                continue
            if not ensure_bookmark_at_fn(doc, r['target_fn'], r['new_bm'], next_id):
                continue
            # Update the instr element's text
            txt = r['instr_el'].text or ''
            new_txt = BM_NOTEREF.sub(f"NOTEREF {r['new_bm']}", txt, count=1)
            if new_txt != txt:
                r['instr_el'].text = new_txt
                applied += 1
        print(f"Applied: {applied} NOTEREF rewires (bookmarks created as needed)")
        if not args.no_precompute:
            updated = precompute_cached_displays(doc, fns, bio_count=args.bio_count)
            print(f"Pre-computed {updated} cached NOTEREF display values "
                  f"(bio_count={args.bio_count}, body display = fn_id − {args.bio_count})")
        write_zip(args.docx, doc, fns)

    # Validation: for each supra ref now mapped to a bibkey, check authors match surnames
    print("\n=== Validation ===")
    mismatches = []
    bib_by_key = {e['bibkey']: e for e in bib}
    for r in rename_plan:
        if not r['new_bm']:
            continue
        bk = r['new_bm'].replace('_RefBib_', '')
        entry = bib_by_key.get(bk)
        if not entry:
            continue
        authors = entry['fields'].get('author', '')
        title = entry['fields'].get('title', '')
        howpub = entry['fields'].get('howpublished', '')
        note = entry['fields'].get('note', '')
        # Build a single searchable haystack of every place an identifier might
        # live: author, title, howpublished, AND the bibkey itself (which often
        # encodes institutional short forms like `gao`, `crs`, `sec`).
        haystack = _normalize(authors + ' ' + title + ' ' + howpub + ' ' + bk + ' ' + note)
        tokens = re.findall(r"\b[A-Z][a-zA-Z'’\-]+\b", r['surnames'])
        stop = {'See', 'Also', 'But', 'Cf', 'Eg', 'Id', 'The', 'In', 'Of'}
        tokens = [t for t in tokens if t not in stop and len(t) > 2]
        matched = [t for t in tokens if _normalize(t) in haystack]
        if tokens and not matched:
            mismatches.append({
                'source_fn': r['source_fn'], 'surnames': r['surnames'],
                'bibkey': bk, 'authors': authors, 'title': title[:80],
                'howpublished': howpub[:80],
            })

    print(f"Mismatches: {len(mismatches)}")
    if args.out_report or mismatches:
        report_path = args.out_report or (Path(args.docx).parent / 'scratch' / 'SUPRA_BIB_AUDIT.md')
        Path(report_path).parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, 'w') as f:
            f.write("# Supra → Bib validation\n\n")
            f.write(f"Total supras with bibkey: {renamed}; mismatches: {len(mismatches)}\n\n")
            for m in mismatches:
                f.write(f"## fn{m['source_fn']} — `{m['surnames'][:60]}`\n")
                f.write(f"- Resolved bibkey: `{m['bibkey']}`\n")
                f.write(f"- Bib authors: {m['authors']}\n")
                f.write(f"- Bib title: {m['title']}\n\n")
        print(f"Report: {report_path}")


if __name__ == '__main__':
    main()
