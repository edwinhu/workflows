#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml"]
# ///
"""Find article citations in the DOCX that are absent from sources.bib.

`sources.bib` was auto-extracted in May and the manuscript moved on, so it is a
lagging record, not a source of truth. Using it to VALIDATE the document has the
dependency backwards and hides exactly the citations that were added or reworked
most recently — here, the fn 131-155 block, which is also where the
cross-reference and signal-italic defects clustered.

Parsing is deterministic (`Author(s), Title, Vol Journal Page (Year)`) rather
than model-driven: bluebook-audit's own guidance is that Gemini "hallucinates
citation formats and fabricates citation details", and a fabricated bib entry is
worse than a missing one because it looks answered.

Emits BibTeX for REVIEW. Nothing is appended automatically — a wrong entry
silently becomes the citation of record.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docx_footnotes import build_fn_table, display_to_id, load_parts

CITE = re.compile(
    r'(?P<authors>[A-Z][A-Za-zÀ-ž.\'’\-]+'
    r'(?:[ ,&]+(?:\([A-Za-z]+\)|[A-Z][A-Za-zÀ-ž.\'’\-]+|and))*?), '
    r'(?P<title>[A-Z][^,;]{10,120}?), '
    r'(?P<vol>\d{1,4}) (?P<journal>[A-Z][A-Za-z.&\'’\- ]{2,34}?) '
    r'(?P<page>\d{1,5})(?:, \d+)?(?: \([^)]*\))? \((?P<year>\d{4})\)')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--docx', required=True)
    ap.add_argument('--bib', type=Path, default=Path('paper/references/sources.bib'))
    ap.add_argument('--out', type=Path, help='write proposed entries here')
    a = ap.parse_args()

    bib = a.bib.read_text(errors='ignore')
    bibtitles = [norm(t) for t in re.findall(r'title\s*=\s*\{+(.*?)\}+\s*,?\s*\n', bib)]
    bibkeys = set(re.findall(r'@\w+\{([^,]+),', bib))

    p = load_parts(a.docx)
    tbl = build_fn_table(p['document'], p['footnotes'])

    out, seen = [], set()
    for _fid, info in sorted(tbl.items(), key=lambda kv: (kv[1].display or 10**6)):
        if not info.display:
            continue
        text = re.sub(r'\s+', ' ', info.text)
        for m in CITE.finditer(text):
            title = m.group('title').strip()
            n = norm(title)
            if len(n) < 12 or n in seen:
                continue
            if any(n in bt or bt.startswith(n[:26]) for bt in bibtitles):
                continue
            seen.add(n)
            authors = m.group('authors').strip(' ,&')
            # a leading signal or short-form leaks into the author capture
            authors = re.sub(r'^(See also|See, e\.g\.,|See|E\.g\.,|Cf\.|But see|'
                             r'Accord|Contra|and|in)\s+', '', authors).strip(' ,&')
            # Key on the FIRST author's surname — the bib's existing convention
            # (rock2018, celarier2018). Keying on the last author silently files
            # a paper under a co-author and breaks lookup by cite.
            first = re.split(r'[,&]| and ', authors)[0].strip()
            surname = first.split()[-1] if first.split() else 'anon'
            key = re.sub(r'[^a-z]', '', surname.lower()) + m.group('year')
            while key in bibkeys:
                key += 'a'
            bibkeys.add(key)
            out.append(
                f'@article{{{key},\n'
                f'  author = {{{authors}}},\n'
                f'  title = {{{{{title}}}}},\n'
                f'  journal = {{{m.group("journal").strip()}}},\n'
                f'  volume = {{{m.group("vol")}}},\n'
                f'  pages = {{{m.group("page")}}},\n'
                f'  year = {{{m.group("year")}}},\n'
                f'  note = {{fn{info.display}}}\n'
                f'}}\n')

    text = '\n'.join(out)
    print(f'{len(out)} article cite(s) in the manuscript but not in {a.bib.name}\n')
    print(text)
    if a.out:
        a.out.write_text(
            '% Proposed additions — extracted deterministically from the DOCX\n'
            '% footnotes. REVIEW before merging into sources.bib.\n\n' + text,
            encoding='utf-8')
        print(f'wrote {a.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
