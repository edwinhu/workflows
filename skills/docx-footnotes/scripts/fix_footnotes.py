#!/usr/bin/env -S uv run python3
"""Fix footnote formatting damage in law review OOXML.

Two classes of damage, detected and fixed independently:

A. Google Docs round-trip damage:
   1. Separator/continuation footnotes (id=-1, 0) lost
   2. Custom marks (customMarkFollows, w:sym) for author bio footnotes
   3. Paragraph styles on footnotes (FootnoteText / FNStyleBest)
   4. Footnote ID numbering (shifts when system footnotes are missing)
   5. TOC separator paragraph height (causes spillover to second page)
   6. Footnote style *definitions* (FNStyleBest etc.) stripped from
      styles.xml — restored from the law-review reference template

B. Pandoc-citeproc wrap parens:
   Pandoc-citeproc wraps bracketed citations `[@key]` that appear
   mid-paragraph inside a footnote in `  (...)` — extra space, open
   paren, content, close paren. This script strips that wrapper while
   preserving author-written explanatory parentheticals (which lack the
   double-space XML signature).

All fixes are idempotent — safe to run multiple times.

Usage:
    uv run python3 fix_footnotes.py path/to/file.docx
    uv run python3 fix_footnotes.py path/to/file.docx --output fixed.docx
    uv run python3 fix_footnotes.py path/to/file.docx --dry-run
    uv run python3 fix_footnotes.py path/to/file.docx --crossrefs  # also fix cross-refs
"""

import argparse
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# ── Custom mark definitions ────────────────────────────────────────────
AUTHOR_BIO_MARKS = [
    {"mark_type": "sym", "font": "Symbol", "char": "F02A",
     "detect_text": "*", "detect_re": r"\*"},
    {"mark_type": "text", "entity": "&#8224;",
     "detect_text": "\u2020", "detect_re": r"&#8224;|\u2020"},
    {"mark_type": "text", "entity": "&#8225;",
     "detect_text": "\u2021", "detect_re": r"&#8225;|\u2021"},
]

# The preferred footnote paragraph style
FN_PSTYLE = "FNStyleBest"

# Canonical law-review reference template — the same .docx build_docx.py feeds
# to pandoc as --reference-doc. Used to restore footnote style *definitions*
# (FNStyleBest etc.) when a Google Docs round-trip has stripped them from
# styles.xml, leaving the pStyle reference dangling at an undefined style.
TEMPLATE = (Path(__file__).resolve().parent.parent.parent
            / "writing-legal" / "templates" / "law_review_template.docx")


def read_zip_member(zf, name):
    return zf.read(name).decode("utf-8")


def detect_issues(fn_xml, doc_xml, settings_xml=None, styles_xml=None):
    """Detect both Google Docs round-trip damage and pandoc wrap parens."""
    issues = []

    # Google Docs export sets <w:evenAndOddHeaders/> in settings.xml even when
    # the document does not actually use different even/odd headers. When Word
    # opens such a file, the setting interacts with section breaks and
    # title-page properties to insert a phantom blank page (most often between
    # the cover/abstract and the table of contents). LibreOffice ignores it,
    # so the artifact is invisible until you print from Word.
    if settings_xml is not None and '<w:evenAndOddHeaders/>' in settings_xml:
        issues.append("even_odd_headers_phantom_page")

    if 'w:type="separator"' not in fn_xml:
        issues.append("missing_separators")

    if 'customMarkFollows="0"' in doc_xml and 'customMarkFollows="1"' not in doc_xml:
        issues.append("custom_marks_broken")

    # Half-fixed state: customMarkFollows="1" is already present, but the
    # bio reference runs lack any superscript formatting (no vertAlign and
    # no FootnoteReference rStyle). Symptom: bio marks render at baseline.
    bio_unsuperscripted = _count_unsuperscripted_bio_refs(doc_xml)
    if bio_unsuperscripted:
        issues.append(f"bio_marks_not_superscript({bio_unsuperscripted})")

    if re.search(r'<w:footnote\s+w:id="0">', fn_xml) and 'w:type="separator"' not in fn_xml:
        issues.append("ids_shifted")

    # Count footnotes missing pStyle — this is the main formatting issue
    footnotes = re.findall(r'<w:footnote\s+w:id="(\d+)">(.*?)</w:footnote>', fn_xml, re.DOTALL)
    missing_style = sum(1 for fid, body in footnotes if 'w:pStyle' not in body)
    if missing_style > 0:
        issues.append(f"missing_pstyle({missing_style}/{len(footnotes)})")

    # Count footnote paragraphs using FootnoteText (the Google Docs default)
    # instead of the canonical FNStyleBest. A round-trip swaps the pStyle
    # silently; the visual difference is usually small but it desyncs the
    # doc from the reference template.
    wrong_pstyle = fn_xml.count('<w:pStyle w:val="FootnoteText"/>')
    if wrong_pstyle:
        issues.append(f"wrong_pstyle({wrong_pstyle} FootnoteText)")

    # FNStyleBest applied to footnotes (or about to be, via missing_pstyle)
    # but the style itself is not defined in styles.xml. A Google Docs
    # round-trip can strip the style *definition* while the pStyle reference
    # survives — Word then silently falls back to Normal.
    if styles_xml is not None:
        will_reference = (f'w:pStyle w:val="{FN_PSTYLE}"' in fn_xml
                          or missing_style > 0
                          or wrong_pstyle > 0)
        if will_reference and not _style_present(styles_xml, FN_PSTYLE):
            issues.append("fnstylebest_style_undefined")

        # Google Docs sometimes preserves the FNStyleBest *block* but injects
        # link-blue underline color and white shading from its hyperlink
        # renderer. The fingerprints are unique to GDocs residue — authors
        # don't write `<w:u w:color="0077CC"/>` into their footnote styles.
        if _has_gdocs_style_residue(styles_xml):
            issues.append("fnstylebest_gdocs_residue")

    # Half-fixed state inside footnotes.xml: the leading mark glyph in each
    # bio footnote body lacks superscript formatting.
    bio_body_unsup = _count_unsuperscripted_bio_bodies(fn_xml)
    if bio_body_unsup:
        issues.append(f"bio_body_marks_not_superscript({bio_body_unsup})")

    # Pandoc-citeproc wrap parens: count opener signatures.
    wrap_count = len(_PANDOC_WRAP_OPEN_RE.findall(fn_xml))
    if wrap_count:
        issues.append(f"pandoc_cite_wraps({wrap_count})")

    return issues


# ── Pandoc-citeproc wrap parens ────────────────────────────────────────
# Pandoc-citeproc wraps mid-footnote bracketed citations in `  (...)`. The
# docx run structure for a wrap is distinctive:
#
#   <w:r><w:t xml:space="preserve"> </w:t></w:r>          # natural trailing space
#   <w:r><w:t xml:space="preserve"> </w:t></w:r>          # EXTRA space
#   <w:r>[<w:rPr>…</w:rPr>]<w:t xml:space="preserve">(Griffin,</w:t></w:r>
#   … content runs …
#   <w:r>[<w:rPr>…</w:rPr>]<w:t xml:space="preserve">)</w:t></w:r>    # standalone )
#
# Author-written explanatory parentheticals appear as a single run
# `<w:t> (describing X)</w:t>` and therefore do not match this signature.

_WS_RUN = r'<w:r><w:t xml:space="preserve"> </w:t></w:r>'
_RPR_MAYBE = r'(?:<w:rPr>(?:[^<]|<[^/][^>]*/>|<[^/][^>]*>[^<]*</[^>]+>)*</w:rPr>)?'
_PANDOC_WRAP_OPEN_RE = re.compile(
    _WS_RUN + _WS_RUN +
    r'(<w:r>' + _RPR_MAYBE + r'<w:t[^>]*>)\('
)
_T_OPEN_RE = re.compile(r'<w:t[^>]*>')


def _find_matching_close(p, start):
    """Scan p[start:] tracking paren depth only inside `<w:t>…</w:t>` text.

    Assumes depth starts at 1 (we just stripped an opening `(`). Returns the
    absolute index of the matching `)` char, or -1 if unbalanced within p.
    """
    i = start
    depth = 1
    in_t = False
    while i < len(p):
        if not in_t:
            m = _T_OPEN_RE.search(p, i)
            if not m:
                return -1
            i = m.end()
            in_t = True
            continue
        close = p.find("</w:t>", i)
        if close == -1:
            return -1
        for j in range(i, close):
            c = p[j]
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    return j
        i = close + len("</w:t>")
        in_t = False
    return -1


def fix_pandoc_cite_wraps(fn_xml):
    """Strip `  (…)` wraps pandoc-citeproc adds around mid-footnote citations.

    Matches the opener (two whitespace-only runs + run starting with `(`),
    then finds the balanced closing `)` by counting parens inside `<w:t>`
    text (since the close may be either a standalone run or attached to
    another string, e.g., `(2025))` where one `)` ends an inline date
    parenthetical and the trailing `)` closes the wrap).

    Processes paragraph-by-paragraph so a wrap never crosses `<w:p>`.
    Idempotent: after the fix, the opener signature is gone.
    """
    changes = []
    count = 0

    out_parts = []
    last_end = 0
    for pm in re.finditer(r'<w:p(?:\s[^>]*)?>.*?</w:p>', fn_xml, re.DOTALL):
        out_parts.append(fn_xml[last_end:pm.start()])
        p = pm.group(0)
        while True:
            om = _PANDOC_WRAP_OPEN_RE.search(p)
            if not om:
                break
            close_pos = _find_matching_close(p, om.end())
            if close_pos == -1:
                break
            # Rebuild: drop one whitespace run, the opening `(`, and the
            # matching close `)` char. The opener's text run keeps its
            # trailing content (e.g., `Griffin,`), and if the closer was
            # attached to other text (e.g., `(2025))`) only the final `)`
            # is removed.
            p = (
                p[:om.start()]
                + _WS_RUN
                + om.group(1)
                + p[om.end():close_pos]
                + p[close_pos + 1:]
            )
            count += 1
        out_parts.append(p)
        last_end = pm.end()
    out_parts.append(fn_xml[last_end:])
    new_fn_xml = ''.join(out_parts)

    if count:
        changes.append(f"Stripped {count} pandoc-citeproc wrap paren(s)")
    return new_fn_xml, changes


def fix_footnotes_xml(fn_xml, num_bio_footnotes=3):
    """Fix footnotes.xml formatting."""
    changes = []
    needs_id_shift = 'w:type="separator"' not in fn_xml

    if needs_id_shift:
        # 1. Shift all footnote IDs by +1
        for old_id in range(300, -1, -1):
            old = f'<w:footnote w:id="{old_id}">'
            new = f'<w:footnote w:id="{old_id + 1}">'
            if old in fn_xml:
                fn_xml = fn_xml.replace(old, new)
        changes.append("Shifted footnote IDs by +1")

        # 2. Add separator/continuation footnotes
        para_id1 = f"{random.randint(0, 0xFFFFFFFF):08X}"
        para_id2 = f"{random.randint(0, 0xFFFFFFFF):08X}"
        sep = f"""
  <w:footnote w:type="separator" w:id="-1">
    <w:p w14:paraId="{para_id1}" w14:textId="77777777" w:rsidR="003D4C1D" w:rsidRDefault="003D4C1D">
      <w:r>
        <w:separator/>
      </w:r>
    </w:p>
  </w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0">
    <w:p w14:paraId="{para_id2}" w14:textId="77777777" w:rsidR="003D4C1D" w:rsidRDefault="003D4C1D">
      <w:r>
        <w:continuationSeparator/>
      </w:r>
    </w:p>
  </w:footnote>"""
        fn_xml = re.sub(r'(<w:footnotes[^>]*>)', r'\1' + sep, fn_xml, count=1)
        changes.append("Added separator/continuation footnotes")

        # 3. Fix author bio custom marks
        for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
            fn_id = str(i + 1)
            if mark["mark_type"] == "sym":
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:sym w:font="{mark["font"]}" w:char="{mark["char"]}"/></w:r>')
            else:
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:t>{mark["entity"]}</w:t></w:r>')

            pattern = (
                rf'(<w:footnote w:id="{fn_id}">.*?)'
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:rStyle w:val="FootnoteReference"/>\s*'
                r'(?:<w:vertAlign w:val="superscript"/>\s*)?</w:rPr>\s*'
                r'<w:footnoteRef/>\s*</w:r>\s*'
                r'<w:r[^>]*>\s*<w:rPr>.*?</w:rPr>\s*'
                rf'<w:t[^>]*>(?:{mark["detect_re"]})</w:t>\s*</w:r>'
            )
            fn_xml_new = re.sub(pattern, rf'\1{repl}', fn_xml, count=1, flags=re.DOTALL)
            if fn_xml_new != fn_xml:
                fn_xml = fn_xml_new
                changes.append(f"Fixed bio footnote {fn_id} custom mark")

    # 4. Add pStyle to ALL footnotes missing it
    # Match footnotes with <w:pPr> that don't already have <w:pStyle>
    count = 0

    def add_pstyle(m):
        nonlocal count
        count += 1
        return m.group(1) + f'\n        <w:pStyle w:val="{FN_PSTYLE}"/>'

    fn_xml = re.sub(
        r'(<w:footnote\s+w:id="\d+">\s*<w:p[^>]*>\s*<w:pPr>)(?!\s*<w:pStyle)',
        add_pstyle,
        fn_xml
    )
    if count:
        changes.append(f"Added {FN_PSTYLE} pStyle to {count} footnotes")

    # 5. Reassign any existing FootnoteText pStyle inside footnotes to
    # FNStyleBest. Google Docs round-trips swap the canonical law-review
    # style for its own default; we want all footnote paragraphs on the
    # same style so the template's tabs/indent/sz=20 are picked up
    # consistently. Safe within footnotes.xml — pStyle only appears as
    # a paragraph-style reference here, never as a styleId definition.
    fn_xml, reassign_count = re.subn(
        r'<w:pStyle w:val="FootnoteText"/>',
        f'<w:pStyle w:val="{FN_PSTYLE}"/>',
        fn_xml,
    )
    if reassign_count:
        changes.append(
            f"Reassigned {reassign_count} FootnoteText pStyles to {FN_PSTYLE}"
        )

    return fn_xml, changes


def _find_bio_footnote_first_run(fn_xml, fn_id):
    """Return (match, body_start, run_match) for the first <w:r>...</w:r> inside
    footnote fn_id's body, or (None, None, None) if not found."""
    fn_m = re.search(
        rf'<w:footnote\s+w:id="{fn_id}">(.*?)</w:footnote>',
        fn_xml, re.DOTALL,
    )
    if not fn_m:
        return None, None, None
    body = fn_m.group(1)
    run_m = re.search(r'<w:r(\s[^>]*)?>((?:(?!</?w:r\b).)*?)</w:r>', body, re.DOTALL)
    return fn_m, body, run_m


def _count_unsuperscripted_bio_bodies(fn_xml, num_bio_footnotes=3):
    n = 0
    for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
        fn_id = str(i + 1)
        fn_m, body, run_m = _find_bio_footnote_first_run(fn_xml, fn_id)
        if not run_m:
            continue
        inner = run_m.group(0)
        # Does this run carry the mark glyph?
        if mark["mark_type"] == "sym":
            if f'w:char="{mark["char"]}"' not in inner:
                continue
        else:
            if mark["detect_text"] not in inner:
                continue
        if _run_has_superscript(inner):
            continue
        n += 1
    return n


def fix_bio_superscript_in_footnotes(fn_xml, num_bio_footnotes=3):
    """Add superscript formatting to the leading mark glyph inside each bio
    footnote body (in footnotes.xml). Idempotent."""
    changes = []
    sup_rpr = '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'

    for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
        fn_id = str(i + 1)
        fn_m, body, run_m = _find_bio_footnote_first_run(fn_xml, fn_id)
        if not run_m:
            continue
        run_full = run_m.group(0)
        run_attrs = run_m.group(1) or ''
        run_inner = run_m.group(2)

        # Confirm this run actually contains the expected mark glyph.
        if mark["mark_type"] == "sym":
            if f'w:char="{mark["char"]}"' not in run_inner:
                continue
        else:
            if mark["detect_text"] not in run_inner:
                continue

        if _run_has_superscript(run_inner):
            continue

        # Merge or insert rPr at start of run inner content.
        rpr_m = re.match(r'\s*<w:rPr>(.*?)</w:rPr>', run_inner, re.DOTALL)
        if rpr_m:
            new_inner = run_inner.replace(
                rpr_m.group(0),
                f'<w:rPr>{rpr_m.group(1)}<w:vertAlign w:val="superscript"/></w:rPr>',
                1,
            )
        else:
            new_inner = sup_rpr + run_inner

        new_run = f'<w:r{run_attrs}>{new_inner}</w:r>'
        # Replace within the footnote body to avoid colliding with identical
        # runs in other footnotes.
        new_body = body.replace(run_full, new_run, 1)
        fn_xml = fn_xml.replace(body, new_body, 1)
        changes.append(f"Superscripted leading mark in footnote {fn_id}")

    return fn_xml, changes


def fix_settings_xml(settings_xml):
    """Remove Google Docs export artifacts from settings.xml that cause Word
    to render phantom blank pages. Idempotent."""
    changes = []
    if settings_xml is None:
        return None, changes
    if '<w:evenAndOddHeaders/>' in settings_xml:
        settings_xml = settings_xml.replace('<w:evenAndOddHeaders/>', '')
        changes.append("Removed <w:evenAndOddHeaders/> (phantom blank page)")
    return settings_xml, changes


def _iter_bio_ref_runs(doc_xml, num_bio_footnotes):
    """Yield (match, fn_id, mark) for each bio footnoteReference run with
    customMarkFollows="1". The match captures the full <w:r>...</w:r>, with
    groups: 1=run attrs, 2=content before footnoteReference, 3=content after."""
    for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
        fn_id = str(i + 1)
        fn_ref = f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
        pattern = re.compile(
            r'<w:r(\s[^>]*)?>((?:(?!</?w:r\b).)*?)' + re.escape(fn_ref) +
            r'((?:(?!</w:r>).)*?)</w:r>',
            re.DOTALL,
        )
        m = pattern.search(doc_xml)
        if m:
            yield m, fn_id, mark


def _run_has_superscript(run_before):
    """Does the rPr (if any) before the footnoteReference confer superscript?"""
    if re.search(r'<w:vertAlign\s+w:val="superscript"', run_before):
        return True
    if re.search(r'<w:rStyle\s+w:val="FootnoteReference"', run_before):
        return True
    return False


def _count_unsuperscripted_bio_refs(doc_xml, num_bio_footnotes=3):
    """Count bio references that have customMarkFollows="1" but no superscript."""
    n = 0
    for m, fn_id, mark in _iter_bio_ref_runs(doc_xml, num_bio_footnotes):
        if not _run_has_superscript(m.group(2)):
            n += 1
    return n


def fix_bio_superscript(doc_xml, num_bio_footnotes=3):
    """Half-fixed-state repair: bio refs already have customMarkFollows="1",
    but the run lacks superscript formatting. Add inline <w:vertAlign> and,
    if the mark glyph is welded to trailing text in the same <w:t>, split
    the run so only the mark is superscripted."""
    changes = []
    for _, fn_id, mark in list(_iter_bio_ref_runs(doc_xml, num_bio_footnotes)):
        # Re-search every iteration since doc_xml may have changed.
        fn_ref = f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
        pattern = re.compile(
            r'<w:r(\s[^>]*)?>((?:(?!</?w:r\b).)*?)' + re.escape(fn_ref) +
            r'((?:(?!</w:r>).)*?)</w:r>',
            re.DOTALL,
        )
        m = pattern.search(doc_xml)
        if not m:
            continue

        attrs = m.group(1) or ''
        before = m.group(2)
        after = m.group(3)
        full = m.group(0)

        if _run_has_superscript(before):
            continue

        sup_rpr = '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'

        # Merge or insert rPr.
        rpr_m = re.search(r'<w:rPr>(.*?)</w:rPr>', before, re.DOTALL)
        if rpr_m:
            new_before = before.replace(
                rpr_m.group(0),
                f'<w:rPr>{rpr_m.group(1)}<w:vertAlign w:val="superscript"/></w:rPr>',
                1,
            )
        else:
            new_before = sup_rpr + before

        # Inspect glyph after footnoteReference.
        sym_m = re.match(
            r'\s*(<w:sym\s+w:font="[^"]+"\s+w:char="[^"]+"/>)\s*$',
            after, re.DOTALL,
        )
        t_m = re.match(
            r'\s*<w:t(\s[^>]*)?>([^<]*)</w:t>\s*$',
            after, re.DOTALL,
        )

        if sym_m:
            new_run = f'<w:r{attrs}>{new_before}{fn_ref}{sym_m.group(1)}</w:r>'
        elif t_m:
            text = t_m.group(2)
            mark_char = mark["detect_text"]
            if not text.startswith(mark_char):
                continue
            if text == mark_char:
                new_run = (f'<w:r{attrs}>{new_before}{fn_ref}'
                           f'<w:t>{mark_char}</w:t></w:r>')
            else:
                trail = text[len(mark_char):]
                trail_attr = ' xml:space="preserve"' if (trail != trail.strip()) else ''
                new_run = (f'<w:r{attrs}>{new_before}{fn_ref}'
                           f'<w:t>{mark_char}</w:t></w:r>'
                           f'<w:r><w:t{trail_attr}>{trail}</w:t></w:r>')
        else:
            continue

        doc_xml = doc_xml.replace(full, new_run, 1)
        changes.append(f"Superscripted bio reference {fn_id}")

    return doc_xml, changes


def fix_document_xml(doc_xml, num_bio_footnotes=3):
    """Fix document.xml footnote references."""
    changes = []
    needs_id_shift = 'customMarkFollows="1"' not in doc_xml

    if needs_id_shift:
        for old_id in range(300, -1, -1):
            old = f'w:customMarkFollows="0" w:id="{old_id}"'
            new = f'w:customMarkFollows="0" w:id="{old_id + 1}"'
            if old in doc_xml:
                doc_xml = doc_xml.replace(old, new)
        changes.append("Shifted footnoteReference IDs by +1")

        for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
            fn_id = str(i + 1)
            if mark["mark_type"] == "sym":
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
                        f'<w:sym w:font="{mark["font"]}" w:char="{mark["char"]}"/></w:r>')
            else:
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
                        f'<w:t>{mark["entity"]}</w:t></w:r>')

            pattern = (
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:vertAlign w:val="superscript"/>\s*</w:rPr>\s*'
                rf'<w:footnoteReference w:customMarkFollows="0" w:id="{fn_id}"/>\s*</w:r>\s*'
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:vertAlign w:val="superscript"/>\s*'
                r'(?:<w:rtl w:val="0"/>\s*)?</w:rPr>\s*'
                rf'<w:t[^>]*>(?:{mark["detect_re"]})</w:t>\s*</w:r>'
            )
            doc_xml_new = re.sub(pattern, repl, doc_xml, count=1, flags=re.DOTALL)
            if doc_xml_new != doc_xml:
                doc_xml = doc_xml_new
                changes.append(f"Fixed bio reference {fn_id}")

    return doc_xml, changes


def fix_toc_separator(doc_xml):
    """Shrink the TOC-to-body separator paragraph to near-zero height."""
    changes = []
    pattern = (
        r'(</w:sdt>\s*<w:p[^>]*>.*?)'
        r'<w:spacing[^/]*/>'
        r'(.*?<w:br w:type="page"/>)'
    )

    def replacer(m):
        prefix, suffix = m.group(1), m.group(2)
        if re.search(r'<w:sz w:val="(?!2")[^"]*"', prefix + suffix):
            changes.append("Shrunk TOC separator paragraph")
            new = re.sub(r'<w:spacing[^/]*/>', '<w:spacing w:after="0" w:before="0" w:line="14" w:lineRule="auto"/>', prefix)
            new = re.sub(r'<w:sz w:val="[^"]*"/>', '<w:sz w:val="2"/>', new)
            new = re.sub(r'<w:szCs w:val="[^"]*"/>', '<w:szCs w:val="2"/>', new)
            return new + suffix
        return m.group(0)

    doc_xml = re.sub(pattern, replacer, doc_xml, count=1, flags=re.DOTALL)
    return doc_xml, changes



def fix_numbering_offset(settings_xml, fn_xml, doc_xml, bio_count=3):
    """Fix footnote numbering offset caused by customMarkFollows bio footnotes.

    Adds numRestart=eachSect to settings.xml so body footnotes restart at 1.
    Updates NOTEREF cached display values to subtract bio_count.
    CRITICAL: numRestart goes in settings.xml ONLY, NOT in sectPr (causes all-zeros).
    """
    changes = []

    # Check if already fixed
    if 'numRestart' in settings_xml:
        return settings_xml, fn_xml, doc_xml, changes

    # Check if document has customMarkFollows bio footnotes
    cmf_count = doc_xml.count('customMarkFollows="1"')
    if cmf_count < bio_count:
        return settings_xml, fn_xml, doc_xml, changes

    # 1. Add numRestart to settings.xml footnotePr
    if '<w:footnotePr>' in settings_xml:
        settings_xml = settings_xml.replace(
            '<w:footnotePr>',
            '<w:footnotePr><w:numRestart w:val="eachSect"/>'
        )
        changes.append("Added numRestart=eachSect to settings.xml")
    else:
        changes.append("WARNING: No footnotePr in settings.xml — cannot add numRestart")
        return settings_xml, fn_xml, doc_xml, changes

    # 2. Update NOTEREF cached values in footnotes.xml
    noteref_pattern = (
        r'(NOTEREF _Ref_fn(\d+)[^<]*</w:instrText>'
        r'.*?fldCharType="separate"/>.*?<w:t[^>]*>)(\d+)(</w:t>)'
    )
    noteref_count = 0

    def noteref_replacer(m):
        nonlocal noteref_count
        ref_id = int(m.group(2))
        old_val = int(m.group(3))
        if ref_id > bio_count and old_val > bio_count:
            noteref_count += 1
            return m.group(1) + str(old_val - bio_count) + m.group(4)
        return m.group(0)

    fn_xml = re.sub(noteref_pattern, noteref_replacer, fn_xml, flags=re.DOTALL)
    if noteref_count:
        changes.append(f"Updated {noteref_count} NOTEREF cached values (subtracted {bio_count})")

    # 3. Also update NOTEREF in document.xml (cross-refs in body text)
    noteref_doc_count = 0

    def noteref_doc_replacer(m):
        nonlocal noteref_doc_count
        ref_id = int(m.group(2))
        old_val = int(m.group(3))
        if ref_id > bio_count and old_val > bio_count:
            noteref_doc_count += 1
            return m.group(1) + str(old_val - bio_count) + m.group(4)
        return m.group(0)

    doc_xml = re.sub(noteref_pattern, noteref_doc_replacer, doc_xml, flags=re.DOTALL)
    if noteref_doc_count:
        changes.append(f"Updated {noteref_doc_count} NOTEREF cached values in document body")

    # 4. Update plain text "supra note N" references
    supra_pattern = r'(supra\s+note\s+)(\d+)'
    supra_count = 0

    def supra_replacer(m):
        nonlocal supra_count
        old_num = int(m.group(2))
        if old_num > bio_count:
            supra_count += 1
            return m.group(1) + str(old_num - bio_count)
        return m.group(0)

    fn_xml = re.sub(supra_pattern, supra_replacer, fn_xml)
    doc_xml = re.sub(supra_pattern, supra_replacer, doc_xml)
    if supra_count:
        changes.append(f"Updated {supra_count} plain-text supra note references")

    return settings_xml, fn_xml, doc_xml, changes


# ── Footnote style definitions ─────────────────────────────────────────
def _style_present(styles_xml, style_id):
    """Is a <w:style> with this styleId defined in styles.xml?"""
    return re.search(
        rf'<w:style\b[^>]*\bw:styleId="{re.escape(style_id)}"', styles_xml
    ) is not None


def _extract_style(styles_xml, style_id):
    """Return the full <w:style …>…</w:style> block for style_id, or None."""
    m = re.search(
        rf'<w:style\b[^>]*\bw:styleId="{re.escape(style_id)}".*?</w:style>',
        styles_xml, re.DOTALL,
    )
    return m.group(0) if m else None


def _style_deps(style_block):
    """styleIds referenced via basedOn / link / next inside a style block."""
    return set(re.findall(
        r'<w:(?:basedOn|link|next)\s+w:val="([^"]+)"', style_block))


# Google Docs hyperlink-renderer residue inside footnote style definitions.
# Authors do not hand-author these values; their presence inside the FNStyleBest
# or FNStyleBestChar block is a reliable signal that GDocs mutated the style.
_GDOCS_RESIDUE_RE = re.compile(
    r'(?:<w:u\s+w:color="0077CC"/?>|'
    r'<w:shd\s+w:val="clear"\s+w:color="auto"\s+w:fill="FFFFFF"/?>)'
)
_FN_STYLES_TO_CHECK = ('FNStyleBest', 'FNStyleBestChar')


def _has_gdocs_style_residue(styles_xml):
    """True if FNStyleBest/FNStyleBestChar contain GDocs hyperlink residue."""
    if styles_xml is None:
        return False
    for sid in _FN_STYLES_TO_CHECK:
        block = _extract_style(styles_xml, sid)
        if block and _GDOCS_RESIDUE_RE.search(block):
            return True
    return False


def replace_mutated_footnote_styles(styles_xml, template_path,
                                    ids=_FN_STYLES_TO_CHECK):
    """Replace footnote style definitions that show Google Docs residue
    (link-blue underline color, white paragraph shading) with the canonical
    definitions from the law-review reference template. Add-only counterpart
    of ensure_footnote_styles handles the *missing* case; this handles the
    *present-but-mutated* case. Idempotent: a clean style is left untouched.

    Returns (styles_xml, changes).
    """
    changes = []
    if styles_xml is None:
        return styles_xml, changes

    try:
        with zipfile.ZipFile(template_path) as tz:
            tpl_styles = tz.read('word/styles.xml').decode('utf-8')
    except (FileNotFoundError, KeyError, zipfile.BadZipFile):
        changes.append(
            f"WARNING: template not readable at {template_path} — cannot "
            f"replace mutated footnote style definition(s)")
        return styles_xml, changes

    replaced = []
    for sid in ids:
        doc_block = _extract_style(styles_xml, sid)
        if doc_block is None:
            continue
        if not _GDOCS_RESIDUE_RE.search(doc_block):
            continue
        tpl_block = _extract_style(tpl_styles, sid)
        if tpl_block is None:
            changes.append(
                f"WARNING: cannot replace '{sid}' — missing from template")
            continue
        styles_xml = styles_xml.replace(doc_block, tpl_block, 1)
        replaced.append(sid)

    if replaced:
        changes.append(
            f"Replaced {len(replaced)} GDocs-mutated style definition(s) "
            f"from template: " + ", ".join(replaced))
    return styles_xml, changes


def ensure_footnote_styles(styles_xml, template_path, needed=(FN_PSTYLE,)):
    """Ensure `needed` styles — and the basedOn/link/next styles they depend
    on — are defined in styles.xml. Missing definitions are copied verbatim
    from the law-review reference template. Add-only: a style already present
    is never modified. Idempotent.

    Returns (styles_xml, changes).
    """
    changes = []
    if styles_xml is None:
        return styles_xml, changes

    try:
        with zipfile.ZipFile(template_path) as tz:
            tpl_styles = tz.read('word/styles.xml').decode('utf-8')
    except (FileNotFoundError, KeyError, zipfile.BadZipFile):
        changes.append(
            f"WARNING: template not readable at {template_path} — cannot "
            f"verify {'/'.join(needed)} style definition(s)")
        return styles_xml, changes

    queue = list(needed)
    seen = set()
    added = []
    while queue:
        sid = queue.pop(0)
        if sid in seen:
            continue
        seen.add(sid)
        if _style_present(styles_xml, sid):
            continue
        block = _extract_style(tpl_styles, sid)
        if block is None:
            changes.append(
                f"WARNING: style '{sid}' missing from both document and template")
            continue
        styles_xml = styles_xml.replace(
            '</w:styles>', block + '</w:styles>', 1)
        added.append(sid)
        queue.extend(_style_deps(block))  # pull in basedOn/link/next deps

    if added:
        changes.append(
            f"Restored {len(added)} style definition(s) from template: "
            + ", ".join(added))
    return styles_xml, changes


def main():
    parser = argparse.ArgumentParser(
        description="Fix footnote damage (Google Docs round-trip, pandoc-citeproc wraps)"
    )
    parser.add_argument("docx", help="Path to the .docx file")
    parser.add_argument("--output", "-o", help="Output path (default: overwrite input)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change")
    parser.add_argument("--bio-footnotes", type=int, default=3,
                        help="Number of author bio footnotes (default: 3)")
    parser.add_argument("--crossrefs", action="store_true",
                        help="Also run create_crossrefs.py after fixing")
    parser.add_argument("--fix-numbering", action="store_true",
                        help="Fix numbering offset from customMarkFollows bio footnotes")
    parser.add_argument("--template", default=str(TEMPLATE),
                        help="Law-review reference template (.docx) to restore "
                             "missing footnote style definitions from "
                             "(default: bundled writing-legal template)")
    args = parser.parse_args()

    docx_path = Path(args.docx).resolve()
    output_path = Path(args.output).resolve() if args.output else docx_path

    if not docx_path.exists():
        print(f"Error: {docx_path} not found", file=sys.stderr)
        sys.exit(1)

    with zipfile.ZipFile(docx_path, 'r') as zf:
        fn_xml = read_zip_member(zf, 'word/footnotes.xml')
        doc_xml = read_zip_member(zf, 'word/document.xml')
        # settings.xml is always read so we can detect/fix the GDocs
        # evenAndOddHeaders artifact; fix_numbering uses it too.
        settings_xml = read_zip_member(zf, 'word/settings.xml')
        # styles.xml is read to verify the FNStyleBest definition survives.
        styles_xml = read_zip_member(zf, 'word/styles.xml')

    issues = detect_issues(fn_xml, doc_xml, settings_xml, styles_xml)
    if not issues and not args.fix_numbering:
        print("No footnote damage detected.")
        return

    print(f"Detected issues: {', '.join(issues)}")
    print()

    all_changes = []

    fn_xml_fixed, fn_changes = fix_footnotes_xml(fn_xml, args.bio_footnotes)
    all_changes.extend(fn_changes)

    fn_xml_fixed, pandoc_changes = fix_pandoc_cite_wraps(fn_xml_fixed)
    all_changes.extend(pandoc_changes)

    fn_xml_fixed, bio_body_changes = fix_bio_superscript_in_footnotes(
        fn_xml_fixed, args.bio_footnotes)
    all_changes.extend(bio_body_changes)

    doc_xml_fixed, doc_changes = fix_document_xml(doc_xml, args.bio_footnotes)
    all_changes.extend(doc_changes)

    doc_xml_fixed, bio_ref_changes = fix_bio_superscript(
        doc_xml_fixed, args.bio_footnotes)
    all_changes.extend(bio_ref_changes)

    doc_xml_fixed, toc_changes = fix_toc_separator(doc_xml_fixed)
    all_changes.extend(toc_changes)

    settings_xml_fixed, settings_changes = fix_settings_xml(settings_xml)
    all_changes.extend(settings_changes)

    # Restore the FNStyleBest style definition (and its dependencies) from the
    # reference template if a Google Docs round-trip stripped it out.
    styles_xml_fixed, styles_changes = ensure_footnote_styles(
        styles_xml, args.template)
    all_changes.extend(styles_changes)

    # And replace any FNStyleBest/FNStyleBestChar block that survived the
    # round-trip but picked up GDocs hyperlink residue (link-blue underline
    # color, white paragraph shading) with the clean template version.
    styles_xml_fixed, mutation_changes = replace_mutated_footnote_styles(
        styles_xml_fixed, args.template)
    all_changes.extend(mutation_changes)

    if args.fix_numbering:
        settings_xml_fixed, fn_xml_fixed, doc_xml_fixed, num_changes = fix_numbering_offset(
            settings_xml_fixed, fn_xml_fixed, doc_xml_fixed, args.bio_footnotes)
        all_changes.extend(num_changes)

    print(f"Changes ({len(all_changes)}):")
    for c in all_changes:
        print(f"  - {c}")

    if args.dry_run:
        print("\nDry run — no files modified.")
        return

    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        with zipfile.ZipFile(docx_path, 'r') as zin:
            with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    if item.filename == 'word/footnotes.xml':
                        zout.writestr(item, fn_xml_fixed.encode('utf-8'))
                    elif item.filename == 'word/document.xml':
                        zout.writestr(item, doc_xml_fixed.encode('utf-8'))
                    elif item.filename == 'word/settings.xml' and settings_xml_fixed is not None:
                        zout.writestr(item, settings_xml_fixed.encode('utf-8'))
                    elif item.filename == 'word/styles.xml' and styles_xml_fixed is not None:
                        zout.writestr(item, styles_xml_fixed.encode('utf-8'))
                    else:
                        zout.writestr(item, zin.read(item.filename))

        shutil.move(tmp_path, output_path)
        print(f"\nWritten to: {output_path}")
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

    # Optionally run cross-refs
    if args.crossrefs:
        crossrefs_script = Path(__file__).parent / "create_crossrefs.py"
        if crossrefs_script.exists():
            print("\nRunning cross-reference conversion...")
            result = subprocess.run(
                [sys.executable, str(crossrefs_script), "--docx", str(output_path)],
                capture_output=True, text=True
            )
            print(result.stdout)
            if result.returncode != 0:
                print(result.stderr, file=sys.stderr)
        else:
            print(f"\nWarning: {crossrefs_script} not found, skipping cross-refs")

    print("Done. Open in Word -> Ctrl+A, F9 to update all fields.")


if __name__ == "__main__":
    main()
