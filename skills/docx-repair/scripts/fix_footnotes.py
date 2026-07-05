#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
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

from lxml import etree

# WordprocessingML namespace, for the lxml-based bio normalization pass.
_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _wq(tag):
    """Qualify a bare WordprocessingML tag/attr name for lxml."""
    return f"{{{_W}}}{tag}"


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
    bio_unsuperscripted = _count_unsuperscripted_bio_refs(
        doc_xml, ref_style_ok=_footnote_ref_style_has_superscript(styles_xml))
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

    # Google Docs leftover content controls (the visible "boxes" in Word) —
    # present in the body AND in footnotes (and comments, not checked here).
    goog_sdts = doc_xml.count('goog_rdk') + fn_xml.count('goog_rdk')
    if goog_sdts:
        issues.append(f"goog_content_controls({goog_sdts})")

    # Google Docs leading-tab first-line indents: paragraphs whose first line is
    # indented by a literal leading <w:tab/> (to a docDefaults tab stop) instead
    # of a real <w:ind firstLine>, so they render over-indented vs neighbours.
    # Reported here; fixed by fix_leading_tab_indents under --normalize-body-indent.
    tab_indents = _count_leading_tab_indents(doc_xml)
    if tab_indents:
        issues.append(f"leading_tab_indent({tab_indents})")

    # Body paragraphs carrying a direct first-line indent instead of inheriting
    # it from a body style (Google Docs stripped the style and baked it in).
    # Fixed by apply_template_body_styles under --restyle-body.
    unstyled_body = _count_unstyled_body_indents(doc_xml)
    if unstyled_body:
        issues.append(f"unstyled_body_indent({unstyled_body})")

    # Google Docs OOXML cruft (redundant run formatting, all-zero rsids, no-op
    # shading). Detected on doc + footnotes (the bulk); hygiene cleans more parts.
    cruft = 0
    for xml in (doc_xml, fn_xml):
        cruft += len(re.findall(r'w:rsid\w+="00000000"', xml))
        cruft += len(re.findall(r'<w:shd[^>]*w:val="clear"[^>]*/>', xml))
        cruft += xml.count('w:val="none"') + xml.count('w:val="baseline"')
        cruft += len(re.findall(r'<w:(?:b|i|bCs|iCs|strike|smallCaps|rtl)'
                                r' w:val="(?:0|false)"/>', xml))
        cruft += xml.count('<w:color w:val="000000"/>')
    if cruft:
        issues.append(f"gdocs_cruft({cruft})")

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


def _footnote_ref_style_has_superscript(styles_xml):
    """True only if the ``FootnoteReference`` character style (or a style it is
    basedOn) actually defines ``vertAlign="superscript"``.

    A Google Docs round-trip can strip the superscript out of this style while
    leaving the style *reference* on the runs. Bio marks rely on the style
    rather than explicit run formatting, so when the style is stripped they
    render at baseline even though ``rStyle="FootnoteReference"`` is present —
    which is why trusting the bare style reference is unsafe."""
    if styles_xml is None:
        return False
    sid, seen = "FootnoteReference", set()
    while sid and sid not in seen:
        seen.add(sid)
        block = _extract_style(styles_xml, sid)
        if block is None:
            return False
        if re.search(r'<w:vertAlign\s+w:val="superscript"', block):
            return True
        m = re.search(r'<w:basedOn\s+w:val="([^"]+)"', block)
        sid = m.group(1) if m else None
    return False


def _run_has_superscript(run_before, ref_style_ok=False):
    """Does the rPr (if any) before the footnoteReference confer superscript?

    Explicit ``<w:vertAlign w:val="superscript"/>`` always counts. A bare
    ``rStyle="FootnoteReference"`` only counts when ``ref_style_ok`` is True —
    i.e. the caller has verified the FootnoteReference style actually defines
    superscript (see :func:`_footnote_ref_style_has_superscript`). Defaulting to
    False means a stripped style is treated as NOT superscript, so the bio fix
    adds explicit ``vertAlign`` rather than trusting the broken style."""
    if re.search(r'<w:vertAlign\s+w:val="superscript"', run_before):
        return True
    if ref_style_ok and re.search(r'<w:rStyle\s+w:val="FootnoteReference"', run_before):
        return True
    return False


def _count_unsuperscripted_bio_refs(doc_xml, num_bio_footnotes=3,
                                    ref_style_ok=False):
    """Count bio references that have customMarkFollows="1" but no superscript."""
    n = 0
    for m, fn_id, mark in _iter_bio_ref_runs(doc_xml, num_bio_footnotes):
        if not _run_has_superscript(m.group(2), ref_style_ok):
            n += 1
    return n


def fix_bio_superscript(doc_xml, num_bio_footnotes=3, ref_style_ok=False):
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

        if _run_has_superscript(before, ref_style_ok):
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


# ── Bio custom-mark restoration (authoritative, position-based) ────────
# The regex bio fixers above only match the "number run + symbol run" shape
# Word Online leaves behind. Google Docs is more destructive: it sets
# customMarkFollows="0" AND DELETES the trailing symbol run entirely, leaving
# a bare footnoteReference. The regex never matches that, so the bios stay in
# the numbered sequence (rendering 1,2,3 with real footnotes starting at 4).
#
# This pass normalizes the FIRST `num_bio_footnotes` references in document
# order — which are the author-bio marks by law-review convention — and their
# corresponding footnote bodies to the canonical baseline shape, regardless of
# how the round-trip damaged them. It is position-based (not id-based) so it is
# robust to the +1 id shift the earlier passes may or may not have applied, and
# it is idempotent: a correct bio is rebuilt to the identical shape.
#
#   body reference run :  <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>
#                         <w:footnoteReference w:customMarkFollows="1" w:id="N"/>SYM</w:r>
#   footnote body run  :  <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>SYM</w:r>
#
# where SYM is <w:sym w:font="Symbol" w:char="F02A"/> (*), <w:t>†</w:t>, <w:t>‡</w:t>.

def _glyph_elem(mark):
    """Build the symbol element (`SYM`) for a bio mark."""
    if mark["mark_type"] == "sym":
        s = etree.Element(_wq("sym"))
        s.set(_wq("font"), mark["font"])
        s.set(_wq("char"), mark["char"])
        return s
    t = etree.Element(_wq("t"))
    t.text = mark["detect_text"]  # the literal glyph, e.g. "†"
    return t


def _is_glyph_node(node, mark):
    """True if `node` is a stray symbol/text node carrying this mark's glyph."""
    if node.tag == _wq("sym"):
        return node.get(_wq("char")) == mark.get("char")
    if node.tag == _wq("t"):
        return (node.text or "").strip() == mark["detect_text"]
    return False


def _strip_following_literal_mark(ref_run, mark):
    """Google Docs deletes the symbol RUN but keeps the symbol CHARACTER,
    welding it onto the front of the next text run (e.g. `<w:t>* Nadya …</w:t>`).
    After we re-add the custom mark we must remove that orphaned literal, or the
    glyph renders twice (`**`, `††`). Strip a single leading mark glyph from the
    first text-bearing run that follows. Idempotent: once stripped, the run no
    longer starts with the mark, so a re-run is a no-op."""
    glyph = mark["detect_text"]
    for nxt in ref_run.itersiblings():
        if nxt.tag != _wq("r"):
            continue
        t = nxt.find(_wq("t"))
        if t is not None and t.text:
            if t.text[0] == glyph:
                t.text = t.text[1:]
            return


def _normalize_bio_rpr(run):
    """Set the run's rPr to exactly <w:rStyle w:val="FootnoteReference"/>.

    Matches the baseline shape: the FootnoteReference character style already
    confers superscript, so no inline <w:vertAlign> is kept (GDocs residue)."""
    rpr = run.find(_wq("rPr"))
    if rpr is None:
        rpr = etree.Element(_wq("rPr"))
        run.insert(0, rpr)
    else:
        for child in list(rpr):
            rpr.remove(child)
    rs = etree.SubElement(rpr, _wq("rStyle"))
    rs.set(_wq("val"), "FootnoteReference")


def restore_bio_custom_marks(doc_xml, fn_xml, num_bio_footnotes=3):
    """Force the first `num_bio_footnotes` footnotes into custom-mark form in
    both document.xml (the body reference) and footnotes.xml (the footnote
    body). Returns (doc_xml, fn_xml, changes). See module comment above."""
    changes = []
    marks = AUTHOR_BIO_MARKS[:num_bio_footnotes]
    if not marks:
        return doc_xml, fn_xml, changes

    # ── document.xml: the in-text bio references ──────────────────────
    doc = etree.fromstring(doc_xml.encode("utf-8"))
    refs = list(doc.iter(_wq("footnoteReference")))[:num_bio_footnotes]
    fixed_refs = 0
    for idx, ref in enumerate(refs):
        mark = marks[idx]
        run = ref.getparent()
        if run is None or run.tag != _wq("r"):
            continue
        already = (ref.get(_wq("customMarkFollows")) == "1"
                   and ref.getnext() is not None
                   and _is_glyph_node(ref.getnext(), mark))
        ref.set(_wq("customMarkFollows"), "1")
        _normalize_bio_rpr(run)
        # Drop any stray glyph nodes following the reference inside this run.
        for sib in list(ref.itersiblings()):
            if _is_glyph_node(sib, mark):
                run.remove(sib)
        # Drop an orphaned glyph run that GDocs/Word may have split off next.
        nxt = run.getnext()
        if nxt is not None and nxt.tag == _wq("r"):
            kids = [k for k in nxt if k.tag != _wq("rPr")]
            if kids and all(_is_glyph_node(k, mark) for k in kids):
                run.getparent().remove(nxt)
        # Append exactly one fresh glyph right after the reference.
        ref.addnext(_glyph_elem(mark))
        # Remove the literal mark GDocs welded onto the following text run.
        _strip_following_literal_mark(run, mark)
        if not already:
            fixed_refs += 1
    if fixed_refs:
        changes.append(
            f"Restored custom marks on {fixed_refs} bio body reference(s)")
    doc_xml = etree.tostring(
        doc, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")

    # ── footnotes.xml: the bio footnote bodies ────────────────────────
    foot = etree.fromstring(fn_xml.encode("utf-8"))
    bios = []
    for fn in foot.iter(_wq("footnote")):
        if fn.get(_wq("type")) in ("separator", "continuationSeparator"):
            continue
        bios.append(fn)
        if len(bios) >= num_bio_footnotes:
            break
    fixed_bodies = 0
    for idx, fn in enumerate(bios):
        mark = marks[idx]
        # The auto-number placeholder run, if it survived.
        ref_run = None
        for r in fn.iter(_wq("r")):
            if r.find(_wq("footnoteRef")) is not None:
                ref_run = r
                break
        if ref_run is not None:
            fref = ref_run.find(_wq("footnoteRef"))
            ref_run.remove(fref)
            _normalize_bio_rpr(ref_run)
            for child in list(ref_run):
                if child.tag != _wq("rPr"):
                    ref_run.remove(child)
            ref_run.append(_glyph_elem(mark))
            _strip_following_literal_mark(ref_run, mark)
            fixed_bodies += 1
        else:
            # No footnoteRef: already a custom mark. Ensure the first run still
            # carries the right glyph (rebuild defensively for idempotency).
            first_run = fn.find(f".//{_wq('r')}")
            if first_run is not None:
                kids = [k for k in first_run if k.tag != _wq("rPr")]
                if not (kids and all(_is_glyph_node(k, mark) for k in kids)):
                    _normalize_bio_rpr(first_run)
                    for child in list(first_run):
                        if child.tag != _wq("rPr"):
                            first_run.remove(child)
                    first_run.append(_glyph_elem(mark))
                    _strip_following_literal_mark(first_run, mark)
                    fixed_bodies += 1
    if fixed_bodies:
        changes.append(
            f"Restored symbol glyph on {fixed_bodies} bio footnote bod(y/ies)")
    fn_xml = etree.tostring(
        foot, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")

    return doc_xml, fn_xml, changes


# ── Feature 1: strip Google Docs leftover content controls ─────────────
def strip_goog_content_controls(doc_xml):
    """Unwrap every ``<w:sdt>`` whose ``<w:tag w:val>`` contains ``goog_rdk``.

    Google Docs' export wraps freshly-written / suggestion-mode body content in
    ``<w:sdt>`` content controls tagged ``goog_rdk_<n>`` — often 3-deep around a
    section. Word renders the nested ones as visible **boxes** around the text.
    Each such control is replaced in place by the children of its
    ``<w:sdtContent>``; the loop repeats until none remain, so nested controls
    flatten fully. Non-``goog`` sdts (real form controls, the TOC ``docPartObj``)
    are kept untouched. Idempotent — a doc with no ``goog_rdk`` sdts is a no-op.
    Returns ``(doc_xml, changes)``.
    """
    root = etree.fromstring(doc_xml.encode("utf-8"))
    total = 0
    # Snapshot-then-process each pass; reparented inner sdts stay valid and are
    # caught on a later pass. The loop is the belt-and-suspenders for nesting.
    while True:
        removed = 0
        for sdt in list(root.iter(_wq("sdt"))):
            tag = sdt.find(f"{_wq('sdtPr')}/{_wq('tag')}")
            val = tag.get(_wq("val")) if tag is not None else None
            if not (val and "goog_rdk" in val):
                continue
            parent = sdt.getparent()
            if parent is None:
                continue
            content = sdt.find(_wq("sdtContent"))
            children = list(content) if content is not None else []
            idx = parent.index(sdt)
            for off, child in enumerate(children):
                parent.insert(idx + off, child)
            # Preserve any tail text hanging off the sdt element.
            if sdt.tail:
                if children:
                    children[-1].tail = (children[-1].tail or "") + sdt.tail
                else:
                    prev = sdt.getprevious()
                    if prev is not None:
                        prev.tail = (prev.tail or "") + sdt.tail
                    else:
                        parent.text = (parent.text or "") + sdt.tail
            parent.remove(sdt)
            removed += 1
        total += removed
        if removed == 0:
            break
    if not total:
        return doc_xml, []
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, [f"Stripped {total} Google Docs content control(s) (goog_rdk sdt)"]


# ── Feature 2: heading normalization ───────────────────────────────────
# Section markers that LOOK like headings on a short standalone line.
_HEADING_MARKER_RE = re.compile(r'^\s*(\([A-Za-z0-9]+\)|[A-Za-z]+\.|\d+\.)\s+\S')
_ROMAN_RE = re.compile(r'^[IVXLCDM]+$')
# Front-matter labels that look like headings but must NOT be restyled.
_HEADING_EXCLUDE_LABELS = {"abstract", "table of contents", "contents"}


def _heading_level_for_marker(token):
    """Map a leading section-marker token to a Heading level (1-5), else None.

    Tiers: Roman ``I.``→1, upper letter ``A.``→2, digit ``1.``→3, lower letter
    ``a.``→4, parenthesized ``(a)``/``(1)``→5. Single uppercase Roman chars
    other than ``I`` (V/X/L/C/D/M) are read as alphabetic markers (→2), since a
    lone ``C.`` between ``B.`` and ``D.`` is far more common than Roman 100.
    """
    m = re.match(r'^\([A-Za-z0-9]+\)$', token)
    if m:
        return 5
    m = re.match(r'^([A-Za-z0-9]+)\.$', token)
    if not m:
        return None
    body = m.group(1)
    if body.isdigit():
        return 3
    if body.islower():
        return 4
    if _ROMAN_RE.match(body) and (len(body) > 1 or body == "I"):
        return 1
    return 2


def _para_all_bold(p):
    """True if every text-bearing run in the paragraph is bold."""
    runs = [r for r in p.findall(_wq("r")) if r.find(_wq("t")) is not None]
    if not runs:
        return False
    for r in runs:
        rpr = r.find(_wq("rPr"))
        if rpr is None:
            return False
        b = rpr.find(_wq("b"))
        if b is None or b.get(_wq("val")) in ("0", "false"):
            return False
    return True


def _is_toc_paragraph(p):
    """True if p lives inside a Table-of-Contents structure (a ``docPartObj``
    sdt — Word's TOC wrapper)."""
    anc = p.getparent()
    while anc is not None:
        if anc.tag == _wq("sdt") and anc.find(
                f"{_wq('sdtPr')}/{_wq('docPartObj')}") is not None:
            return True
        anc = anc.getparent()
    return False


def _looks_like_toc_entry(p, txt):
    """Heuristic TOC-row guard for TOCs not wrapped in a docPartObj sdt: a
    trailing page number paired with a hyperlink and/or tab/dot leader."""
    if not re.search(r'\d$', txt):
        return False
    has_link = p.find(f".//{_wq('hyperlink')}") is not None
    has_tab = p.find(f".//{_wq('tab')}") is not None
    return has_link or has_tab


def _set_heading_style(p, level):
    """Force ``pStyle = HeadingN`` on the paragraph (creating pPr/pStyle as the
    schema-required first children if absent)."""
    pPr = p.find(_wq("pPr"))
    if pPr is None:
        pPr = etree.Element(_wq("pPr"))
        p.insert(0, pPr)
    ps = pPr.find(_wq("pStyle"))
    if ps is None:
        ps = etree.Element(_wq("pStyle"))
        pPr.insert(0, ps)
    ps.set(_wq("val"), f"Heading{level}")


def normalize_headings(doc_xml):
    """Restyle heading-looking paragraphs that carry no Heading style.

    Detect short standalone paragraphs that either lead with a section marker
    (``I.`` / ``A.`` / ``1.`` / ``a.`` / ``(a)``) or are entirely bold, and that
    are currently unstyled (pStyle None / Normal). Assign ``HeadingN`` by marker
    tier (bold-without-marker → Heading1). Idempotent.

    False-positive guards (the reason this is safe to run on a correct doc):
      * already ``Heading*`` / ``TOC*`` / ``Title`` styled → skipped;
      * Table-of-Contents entries (inside a docPartObj sdt, or a trailing
        page-number row with a hyperlink/tab leader) → skipped;
      * ``Abstract`` and similar front-matter labels → skipped.
    Returns ``(doc_xml, changes)``.
    """
    root = etree.fromstring(doc_xml.encode("utf-8"))
    restyled = 0
    for p in root.iter(_wq("p")):
        pPr = p.find(_wq("pPr"))
        cur = None
        if pPr is not None:
            ps = pPr.find(_wq("pStyle"))
            if ps is not None:
                cur = ps.get(_wq("val"))
        if cur is not None and cur not in ("Normal", "BodyText"):
            continue  # already styled (Heading*, TOC*, Title, …) — leave it
        if _is_toc_paragraph(p):
            continue
        txt = "".join(t.text or "" for t in p.iter(_wq("t"))).strip()
        if not txt or len(txt) > 100:
            continue
        if txt.lower() in _HEADING_EXCLUDE_LABELS:
            continue
        if _looks_like_toc_entry(p, txt):
            continue
        level = None
        m = _HEADING_MARKER_RE.match(txt)
        if m:
            level = _heading_level_for_marker(m.group(1))
        if level is None and _para_all_bold(p):
            level = 1
        if level is None:
            continue
        _set_heading_style(p, level)
        restyled += 1
    if not restyled:
        return doc_xml, []
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, [f"Normalized {restyled} unstyled heading-looking paragraph(s)"]


# w:pPr children to KEEP when stripping a heading paragraph's direct formatting.
# pStyle is the style reference; numPr is kept only when the heading is a genuine
# list (auto-numbered) heading — everything else is direct formatting to drop.
_HEADING_PPR_KEEP = ("pStyle", "numPr")


def normalize_heading_formatting(doc_xml):
    """Strip per-paragraph direct formatting from Heading-styled paragraphs so
    they derive ENTIRELY from the style definition (Eddy: "set these once in the
    template and forget about it").

    Google Docs bakes direct formatting into headings, so two paragraphs with the
    same Heading style render differently (one flush-left ``<w:ind w:left="0"
    w:firstLine="0"/>``, another forced to Arial/sz22, …). For every
    ``Heading*`` paragraph this:
      * reduces ``<w:pPr>`` to only ``<w:pStyle>`` (+ ``<w:numPr>`` for a genuine
        list heading) — dropping ``ind`` / ``spacing`` / ``tabs`` / the
        paragraph-mark ``<w:rPr>`` / ``pPrChange`` / any other direct property;
      * strips ``<w:rPr>`` from every run.
    Then it DELETES empty heading paragraphs (Google Docs leaves blank styled
    ones that render as stray indented lines). A paragraph carrying a section
    break (``sectPr``) is never deleted. Idempotent.

    Returns ``(doc_xml, changes)``.
    """
    root = etree.fromstring(doc_xml.encode("utf-8"))
    normalized = 0
    removed = 0
    for p in list(root.iter(_wq("p"))):
        pPr = p.find(_wq("pPr"))
        if pPr is None:
            continue
        ps = pPr.find(_wq("pStyle"))
        style = ps.get(_wq("val")) if ps is not None else None
        if not (style and style.startswith("Heading")):
            continue
        has_sectpr = pPr.find(_wq("sectPr")) is not None
        text = "".join(t.text or "" for t in p.iter(_wq("t"))).strip()
        if not text and not has_sectpr:
            parent = p.getparent()
            if parent is not None:
                parent.remove(p)
                removed += 1
            continue
        # Keep numPr only for a GENUINE list heading — one whose number is
        # auto-generated. If the heading text already starts with a literal
        # marker ("a. …", "1. …"), an auto-number would render doubled, so drop
        # numPr too and leave only pStyle.
        keep = ("pStyle",) if _HEADING_MARKER_RE.match(text) else _HEADING_PPR_KEEP
        changed = False
        for child in list(pPr):
            if etree.QName(child).localname in keep:
                continue
            pPr.remove(child)
            changed = True
        for r in p.findall(_wq("r")):
            rpr = r.find(_wq("rPr"))
            if rpr is not None:
                r.remove(rpr)
                changed = True
        if changed:
            normalized += 1
    changes = []
    if normalized:
        changes.append(
            f"Stripped direct formatting from {normalized} heading paragraph(s)")
    if removed:
        changes.append(f"Removed {removed} empty heading paragraph(s)")
    if not changes:
        return doc_xml, []
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, changes


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

    # No bios → no numbering offset to correct; never add numRestart on a bio-less paper.
    if bio_count <= 0:
        return settings_xml, fn_xml, doc_xml, changes

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


_BODY_STYLE = "BodyText"


def _iter_unstyled_body_paras(root):
    """Yield (p, pPr, ind) for every Normal/unstyled body paragraph (AFTER the
    first Heading1 — front matter keeps its own formatting) that carries a
    *direct* first-line indent with no left/hanging indent. Shared structural
    predicate for both the detect-count and the fix passes — text-emptiness
    (empty vs non-empty) is left to the caller since count/apply treat it
    differently."""
    seen_h1 = False
    for p in root.iter(_wq("p")):
        st = _para_style(p)
        if st == "Heading1":
            seen_h1 = True
            continue
        if not seen_h1 or st not in (None, "Normal"):
            continue  # front matter (abstract/TOC) keeps its own formatting
        pPr = p.find(_wq("pPr"))
        ind = pPr.find(_wq("ind")) if pPr is not None else None
        if (ind is not None and ind.get(_wq("firstLine"))
                and not ind.get(_wq("left")) and not ind.get(_wq("hanging"))):
            yield p, pPr, ind


def _count_unstyled_body_indents(doc_xml):
    """Count Normal/unstyled body paragraphs that carry a *direct* first-line
    indent — the template's BodyText style should supply it instead. Signals a
    Google Docs round-trip that stripped the body style and baked the indent
    into every paragraph."""
    try:
        root = etree.fromstring(doc_xml.encode("utf-8"))
    except Exception:
        return 0
    n = 0
    for p, _pPr, _ind in _iter_unstyled_body_paras(root):
        if "".join(t.text or "" for t in p.iter(_wq("t"))).strip():
            n += 1
    return n


def apply_template_body_styles(doc_xml, styles_xml, template_path):
    """Ensure the template's body styles exist AND are applied to body text.

    Google Docs round-trips strip the ``Normal``/``BodyText`` style definitions
    and bake the body formatting (first-line indent, line spacing) into every
    paragraph as direct overrides — so headings/indents look fine but nothing is
    style-driven, and any paragraph that lost its override (or grew a leading
    tab) renders inconsistently. This restores the law-review template's body
    styles and re-homes the formatting into them:

    1. Replace a stripped/empty ``Normal`` with the template's, and ensure
       ``BodyText`` / ``BodyTextFirstIndent`` / ``FirstParagraph`` (and their
       linked ``*Char`` styles) are defined (copied from the template).
    2. Re-style every Normal/unstyled body paragraph that carries a direct
       first-line indent to ``BodyText``, stripping the now-redundant direct
       ``ind`` / ``spacing`` / ``pBdr``. Empty paragraphs keep their style but
       lose the stray direct indent.

    Editorial and **reflows** the document (BodyText carries the template's
    spacing), so OPT-IN via ``--restyle-body``. Pair with the indent passes
    (run after them) so tab-led / indent-lacking paragraphs already have a real
    firstLine to convert. Idempotent. Returns (doc_xml, styles_xml, changes).
    """
    changes = []
    if styles_xml is None:
        return doc_xml, styles_xml, changes
    try:
        with zipfile.ZipFile(template_path) as tz:
            tpl_styles = tz.read('word/styles.xml').decode('utf-8')
    except (FileNotFoundError, KeyError, zipfile.BadZipFile):
        changes.append(f"WARNING: template not readable at {template_path} — "
                       f"cannot apply template body styles")
        return doc_xml, styles_xml, changes

    # (a) restore the template's Normal (the doc's is stripped/empty) + body styles
    tpl_normal = _extract_style(tpl_styles, "Normal")
    doc_normal = _extract_style(styles_xml, "Normal")
    if tpl_normal and doc_normal and doc_normal != tpl_normal:
        styles_xml = styles_xml.replace(doc_normal, tpl_normal, 1)
        changes.append("Replaced stripped Normal style with template definition")
    styles_xml, ens = ensure_footnote_styles(
        styles_xml, template_path,
        needed=("BodyText", "BodyTextFirstIndent", "FirstParagraph"))
    changes.extend(ens)

    # (b) apply BodyText to direct-indented body paragraphs; clean stray indents.
    # Front-matter guard: only paragraphs AFTER the first Heading1 — the title,
    # author line, Abstract block, and TOC must keep their own formatting (the
    # abstract is NOT body text; styling it as BodyText adds indent+spacing and
    # spills it to a second page).
    root = etree.fromstring(doc_xml.encode("utf-8"))
    restyled = emptied = 0
    for p, pPr, ind in _iter_unstyled_body_paras(root):
        if "".join(t.text or "" for t in p.iter(_wq("t"))).strip():
            ps = pPr.find(_wq("pStyle"))
            if ps is None:
                ps = etree.Element(_wq("pStyle"))
                pPr.insert(0, ps)
            ps.set(_wq("val"), _BODY_STYLE)
            for tag in ("ind", "spacing", "pBdr"):
                el = pPr.find(_wq(tag))
                if el is not None:
                    pPr.remove(el)
            restyled += 1
        else:
            pPr.remove(ind)
            emptied += 1
    if restyled or emptied:
        doc_xml = etree.tostring(
            root, xml_declaration=True, encoding="UTF-8", standalone=True
        ).decode("utf-8")
        changes.append(
            f"Applied {_BODY_STYLE} style to {restyled} body paragraph(s); "
            f"stripped stray direct indent from {emptied} empty paragraph(s)")
    return doc_xml, styles_xml, changes


# ── Google Docs OOXML hygiene (de-cruft) ───────────────────────────────
# Run-property toggles whose explicit "off" value is a redundant no-op (a run
# inherits "off" by default). We strip these ONLY when the value is explicitly
# off — never a bare element (which means ON) and never an explicit "1"/"true".
_OFF_TOGGLE_TAGS = {
    "b", "bCs", "i", "iCs", "strike", "dstrike", "smallCaps", "caps",
    "emboss", "imprint", "outline", "vanish",
}
_OFF_VALUES = {"0", "false"}
# All-zero rsid attributes are the Google Docs signature (Word writes random
# non-zero rsids). Stripping only "00000000" leaves real Word revision metadata.
_RSID_LOCALNAMES = {"rsidR", "rsidRPr", "rsidDel", "rsidP", "rsidTr", "rsidSect"}
# Content parts whose run/paragraph formatting is direct-formatting cruft. We
# deliberately EXCLUDE styles.xml and numbering.xml — an explicit "off" toggle
# there can intentionally override an inherited "on" (changes rendering).
_HYGIENE_PART_RE = re.compile(
    r'^word/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$')


def is_hygiene_part(name):
    """True for the content parts the GDocs hygiene pass should clean."""
    return bool(_HYGIENE_PART_RE.match(name))


def _default_body_font(styles_xml):
    """The document's default body font (docDefaults rFonts ascii), or None."""
    if not styles_xml:
        return None
    m = re.search(r'<w:docDefaults>.*?</w:docDefaults>', styles_xml, re.DOTALL)
    scope = m.group(0) if m else styles_xml
    mm = re.search(r'<w:rFonts[^>]*\bw:ascii="([^"]+)"', scope)
    return mm.group(1) if mm else None


def _rfonts_is_redundant(el, default_font):
    """True if an <w:rFonts> only names the default body font (safe to drop).

    Keeps any rFonts that names a DIFFERENT font (Symbol for the `*` glyph, an
    intentional Arial, Times New Roman, …) or that references a theme font.
    """
    if not default_font:
        return False
    for a in el.attrib:
        if etree.QName(a).localname.endswith("Theme"):
            return False  # theme-bound font reference — keep
    present = [el.get(_wq(x)) for x in ("ascii", "hAnsi", "cs", "eastAsia")]
    present = [v for v in present if v]
    return bool(present) and all(v == default_font for v in present)


def _strip_rpr_cruft(rpr, default_font):
    """Remove redundant children from one <w:rPr>. Returns the count removed.

    KEEPS every meaningful "on" property: bold/italic on, real underline,
    smallCaps=1, super/subscript, non-black color, non-default fonts.
    """
    n = 0
    for child in list(rpr):
        ln = etree.QName(child).localname
        val = child.get(_wq("val"))
        drop = False
        if ln in _OFF_TOGGLE_TAGS:
            drop = val in _OFF_VALUES
        elif ln == "u":
            drop = val == "none"
        elif ln == "vertAlign":
            drop = val == "baseline"          # keep superscript/subscript
        elif ln == "rtl":
            drop = val in _OFF_VALUES
        elif ln == "color":
            drop = (val == "000000"           # black is the default
                    and child.get(_wq("themeColor")) is None)
        elif ln == "rFonts":
            drop = _rfonts_is_redundant(child, default_font)
        if drop:
            rpr.remove(child)
            n += 1
    return n


def gdocs_hygiene(xml, default_font=None):
    """Strip Google Docs OOXML cruft from one part's XML. Returns (xml, count).

    Removes: all-zero rsid attributes; no-op ``<w:shd w:val="clear">`` (auto
    fill/color) anywhere; redundant "off"/default run properties inside every
    ``<w:rPr>`` (see :func:`_strip_rpr_cruft`); and any ``<w:rPr>``/``<w:pPr>``
    left empty afterward. Idempotent — a clean part returns unchanged with 0.
    """
    root = etree.fromstring(xml.encode("utf-8"))
    n = 0

    # 1. All-zero rsid attributes on any element.
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        for a in list(el.attrib):
            if (etree.QName(a).localname in _RSID_LOCALNAMES
                    and el.attrib[a] == "00000000"):
                del el.attrib[a]
                n += 1

    # 2. No-op shading (clear + auto fill/color) wherever it appears.
    for shd in list(root.iter(_wq("shd"))):
        if (shd.get(_wq("val")) == "clear"
                and shd.get(_wq("fill")) in (None, "auto")
                and shd.get(_wq("color")) in (None, "auto")):
            parent = shd.getparent()
            if parent is not None:
                parent.remove(shd)
                n += 1

    # 3. Redundant run-property toggles / default color / default fonts.
    for rpr in list(root.iter(_wq("rPr"))):
        n += _strip_rpr_cruft(rpr, default_font)

    # 4. Drop rPr/pPr left empty by the strips above (rPr first, so a pPr that
    #    held only an emptied paragraph-mark rPr is then itself removed).
    for tag in ("rPr", "pPr"):
        for el in list(root.iter(_wq(tag))):
            if len(el) == 0 and not el.attrib:
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)
                    n += 1

    if n == 0:
        return xml, 0
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, n


def _para_style(p):
    """The pStyle val of a paragraph, or None."""
    pPr = p.find(_wq("pPr"))
    if pPr is None:
        return None
    ps = pPr.find(_wq("pStyle"))
    return ps.get(_wq("val")) if ps is not None else None


def normalize_body_indent(doc_xml):
    """Apply the document's dominant first-line indent to body paragraphs that
    lack one (Google Docs drops it on freshly-written paragraphs).

    Editorial, so OPT-IN. The dominant indent is the mode of ``<w:ind
    firstLine>`` over Normal/unstyled body paragraphs. Front-matter guard: only
    paragraphs AFTER the first Heading1 (title/abstract/TOC excluded), only
    unstyled/Normal paragraphs longer than 60 chars, and only when the paragraph
    has no existing first-line / left / hanging indent. Returns (doc_xml, changes).
    """
    root = etree.fromstring(doc_xml.encode("utf-8"))
    paras = list(root.iter(_wq("p")))
    dominant = _dominant_firstline(paras)
    if dominant is None:
        return doc_xml, []

    seen_h1 = False
    applied = 0
    for p in paras:
        st = _para_style(p)
        if st == "Heading1":
            seen_h1 = True
            continue
        if not seen_h1 or st not in (None, "Normal"):
            continue
        text = "".join(t.text or "" for t in p.iter(_wq("t"))).strip()
        if len(text) <= 60:
            continue
        pPr = p.find(_wq("pPr"))
        ind = pPr.find(_wq("ind")) if pPr is not None else None
        if ind is not None and (ind.get(_wq("firstLine"))
                                or ind.get(_wq("left"))
                                or ind.get(_wq("hanging"))):
            continue
        if pPr is None:
            pPr = etree.Element(_wq("pPr"))
            p.insert(0, pPr)
        ind = _ensure_ind(pPr)
        ind.set(_wq("firstLine"), dominant)
        applied += 1
    if not applied:
        return doc_xml, []
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, [f"Normalized body first-line indent (firstLine={dominant}) "
                 f"on {applied} paragraph(s)"]


def _dominant_firstline(paras):
    """Mode of ``<w:ind firstLine>`` over Normal/unstyled paragraphs, or None
    if no paragraph carries a real firstLine indent to infer from. Shared by
    :func:`normalize_body_indent` and :func:`fix_leading_tab_indents`."""
    from collections import Counter
    firstlines = Counter()
    for p in paras:
        if _para_style(p) not in (None, "Normal"):
            continue
        ind = p.find(f"{_wq('pPr')}/{_wq('ind')}")
        if ind is not None and ind.get(_wq("firstLine")):
            firstlines[ind.get(_wq("firstLine"))] += 1
    return firstlines.most_common(1)[0][0] if firstlines else None


def _ensure_ind(pPr):
    """Return ``pPr``'s ``<w:ind>`` child, creating one at the correct
    schema-ordered insertion point if absent. Word silently drops pPr children
    that appear out of CT_PPr schema order, so a freshly created ``<w:ind>``
    must land before ``rPr``/``sectPr`` (whichever comes first), else appended
    at the end."""
    ind = pPr.find(_wq("ind"))
    if ind is None:
        ind = etree.Element(_wq("ind"))
        ref = pPr.find(_wq("rPr"))
        if ref is None:
            ref = pPr.find(_wq("sectPr"))
        if ref is not None:
            ref.addprevious(ind)
        else:
            pPr.append(ind)
    return ind


_RUN_CONTENT_TAGS = ("tab", "t", "br", "drawing", "footnoteReference")


def _para_leads_with_tab(p):
    """True if the paragraph's first run begins with a literal ``<w:tab/>``.

    Google Docs sometimes encodes a first-line indent as a leading tab
    character (jumping to a ``docDefaults`` tab stop) instead of a real
    ``<w:ind firstLine>``. The tab must be the FIRST *content* child of the
    first run (rPr/bookmarks ignored) — a tab elsewhere in the run is a real
    tab, not an indent artifact.
    """
    first_run = p.find(_wq("r"))
    if first_run is None:
        return first_run, None
    content = [c for c in first_run
               if c.tag in {_wq(t) for t in _RUN_CONTENT_TAGS}]
    if content and content[0].tag == _wq("tab"):
        return first_run, content[0]
    return first_run, None


def _iter_leading_tab_paras(root):
    """Yield body paragraphs whose first-line indent is a leading tab (GDocs).

    Same front-matter guard as :func:`_iter_unstyled_body_paras`: only
    paragraphs AFTER the first Heading1 (title/abstract/TOC excluded), only
    Normal/unstyled paragraphs, only text longer than 60 chars."""
    seen_h1 = False
    for p in root.iter(_wq("p")):
        st = _para_style(p)
        if st == "Heading1":
            seen_h1 = True
            continue
        if not seen_h1 or st not in (None, "Normal"):
            continue  # front matter (abstract/TOC) keeps its own formatting
        if len("".join(t.text or "" for t in p.iter(_wq("t"))).strip()) <= 60:
            continue
        if _para_leads_with_tab(p)[1] is not None:
            yield p


def _count_leading_tab_indents(doc_xml):
    """Count body paragraphs whose first-line indent is a leading tab (GDocs)."""
    try:
        root = etree.fromstring(doc_xml.encode("utf-8"))
    except Exception:
        return 0
    return sum(1 for _ in _iter_leading_tab_paras(root))


def fix_leading_tab_indents(doc_xml):
    """Convert Google Docs leading-tab first-line indents to real firstLine.

    Google Docs sometimes drops a paragraph's ``<w:ind firstLine>`` and instead
    inserts a literal leading ``<w:tab/>`` so the first line jumps to a
    ``docDefaults`` tab stop (often ~0.47"). Those paragraphs then render
    over-indented next to neighbours that use a real firstLine indent — the
    visible "this paragraph is indented further than the others" bug. This
    strips the leading tab and sets ``firstLine`` to the document's dominant
    body first-line indent, so all body paragraphs agree. Idempotent.

    Editorial (it changes the visual indent of the affected paragraphs to the
    dominant value), so it runs under ``--normalize-body-indent`` alongside
    :func:`normalize_body_indent`. Same guards: front matter (before the first
    Heading1) is untouched, Normal/unstyled paragraphs only, text longer than
    60 chars.

    If tab-led paragraphs exist but no paragraph in the document carries a
    real firstLine indent to infer the dominant value from, this does NOT
    silently no-op — it returns a WARNING change entry so the caller/log
    surfaces the unfixed issue (matches ``detect_issues``' report).
    """
    root = etree.fromstring(doc_xml.encode("utf-8"))
    paras = list(root.iter(_wq("p")))
    targets = list(_iter_leading_tab_paras(root))
    if not targets:
        return doc_xml, []
    dominant = _dominant_firstline(paras)
    if dominant is None:
        return doc_xml, [
            f"WARNING: {len(targets)} leading-tab paragraph(s) detected but no "
            f"real firstLine indent exists to infer the dominant value — not fixed"]

    content_tags = {_wq(t) for t in _RUN_CONTENT_TAGS}
    fixed = 0
    for p in targets:
        # Strip EVERY leading tab — Google Docs can stack a tab-only run before a
        # tab+text run, so one removal isn't enough. Loop until the first content
        # of the paragraph is no longer a tab.
        while True:
            first_run, tab = _para_leads_with_tab(p)
            if tab is None:
                break
            first_run.remove(tab)
            # drop the run if stripping the tab left it contentless (rPr only)
            if not any(c.tag in content_tags for c in first_run):
                p.remove(first_run)
        pPr = p.find(_wq("pPr"))
        if pPr is None:
            pPr = etree.Element(_wq("pPr"))
            p.insert(0, pPr)
        ind = _ensure_ind(pPr)
        # a leading tab is mutually exclusive with firstLine/hanging
        for a in ("firstLine", "hanging"):
            if ind.get(_wq(a)) is not None:
                del ind.attrib[_wq(a)]
        ind.set(_wq("firstLine"), dominant)
        fixed += 1
    if not fixed:
        return doc_xml, []
    out = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    ).decode("utf-8")
    return out, [f"Converted {fixed} Google Docs leading-tab indent(s) to "
                 f"firstLine={dominant}"]


def main():
    parser = argparse.ArgumentParser(
        description="Fix footnote damage (Google Docs round-trip, pandoc-citeproc wraps)"
    )
    parser.add_argument("docx", help="Path to the .docx file")
    parser.add_argument("--output", "-o", help="Output path (default: overwrite input)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change")
    parser.add_argument("--bio-footnotes", type=int, default=None,
                        help="Number of author bio footnotes. Default: AUTO-DETECT from the "
                             "doc's customMarkFollows refs (0 if none) — do NOT assume 3, or a "
                             "paper with no author bios gets *,†,‡ stamped on its real first three "
                             "footnotes. Pass an explicit count for a Google-Docs round-trip that "
                             "stripped the marks (auto-detect would see 0).")
    parser.add_argument("--crossrefs", action="store_true",
                        help="Also run create_crossrefs.py after fixing")
    parser.add_argument("--fix-numbering", action="store_true",
                        help="Fix numbering offset from customMarkFollows bio footnotes")
    parser.add_argument("--normalize-headings", action="store_true",
                        help="Restyle unstyled heading-looking paragraphs (section "
                             "markers / bold short lines) to HeadingN; excludes TOC "
                             "entries and front-matter labels (off by default)")
    parser.add_argument("--no-hygiene", action="store_true",
                        help="Skip the Google Docs OOXML hygiene pass (de-cruft). "
                             "Hygiene is ON by default — strips all-zero rsids, "
                             "redundant off/default run formatting, no-op shading, "
                             "default-font/black-color residue across content parts")
    parser.add_argument("--normalize-body-indent", action="store_true",
                        help="Normalize body first-line indents to the document's "
                             "dominant value: apply it to paragraphs that lack one, "
                             "AND convert Google Docs leading-tab indents (a literal "
                             "<w:tab/> jumping to a tab stop) into real firstLine "
                             "indents (editorial; off by default)")
    parser.add_argument("--restyle-body", action="store_true",
                        help="Ensure the template's body styles (Normal/BodyText/"
                             "…) exist AND apply BodyText to body paragraphs, "
                             "stripping their direct first-line indent/spacing/"
                             "pBdr so formatting is style-driven. Reflows the "
                             "document (template spacing). Implies the body-indent "
                             "passes. Editorial; off by default")
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

    # Bio-footnote count: AUTO-DETECT from the customMarkFollows refs the build set, NOT a
    # hardcoded 3. A paper with no author bios (single author, no acknowledgements) has zero
    # customMarkFollows refs → bio_count=0 → no symbols forced onto its real footnotes.
    # IMPORTANT: the documented Google Docs damage (footnotes-reference.md) ALWAYS flips
    # customMarkFollows="1" → customMarkFollows="0" on round-trip, so counting only "1" misses
    # every damaged paper's bio refs and silently skips bio restoration. Count BOTH variants —
    # a bio-less paper has neither, so this preserves the no-spurious-bios behavior; a damaged
    # paper (all "0") now detects correctly. An explicit --bio-footnotes overrides either way.
    if args.bio_footnotes is not None:
        bio_count = args.bio_footnotes
    else:
        cmf_1 = (doc_xml or '').count('customMarkFollows="1"')
        cmf_0 = (doc_xml or '').count('customMarkFollows="0"')
        bio_count = cmf_1 + cmf_0
    if args.bio_footnotes is None:
        variant = 'customMarkFollows="1"' if cmf_1 and not cmf_0 else (
            'customMarkFollows="0" (damaged — marks flipped by a Google Docs round-trip)' if cmf_0 and not cmf_1 else
            f'customMarkFollows="1" ({cmf_1}) + customMarkFollows="0" ({cmf_0})' if cmf_1 and cmf_0 else
            'customMarkFollows="1"/"0" (none found)')
        print(f"Auto-detected {bio_count} author bio footnote(s) from {variant} refs.")

    issues = detect_issues(fn_xml, doc_xml, settings_xml, styles_xml)
    if not issues and not args.fix_numbering and not args.normalize_headings:
        print("No footnote damage detected.")
        return

    print(f"Detected issues: {', '.join(issues)}")
    print()

    all_changes = []

    # Feature 1: strip Google Docs content controls from footnotes.xml FIRST so
    # the footnote fixers see flattened structure. goog_rdk sdts live here too
    # (not just document.xml) and render as boxes in the footnote area.
    fn_xml_fixed, fn_sdt_changes = strip_goog_content_controls(fn_xml)
    if fn_sdt_changes:
        all_changes.append("footnotes.xml: " + fn_sdt_changes[0])

    fn_xml_fixed, fn_changes = fix_footnotes_xml(fn_xml_fixed, bio_count)
    all_changes.extend(fn_changes)

    fn_xml_fixed, pandoc_changes = fix_pandoc_cite_wraps(fn_xml_fixed)
    all_changes.extend(pandoc_changes)

    fn_xml_fixed, bio_body_changes = fix_bio_superscript_in_footnotes(
        fn_xml_fixed, bio_count)
    all_changes.extend(bio_body_changes)

    # Feature 1: strip Google Docs leftover content controls FIRST so every
    # downstream pass sees the flattened structure (no goog_rdk sdt wrappers).
    doc_xml_fixed, sdt_changes = strip_goog_content_controls(doc_xml)
    if sdt_changes:
        all_changes.append("document.xml: " + sdt_changes[0])

    doc_xml_fixed, doc_changes = fix_document_xml(doc_xml_fixed, bio_count)
    all_changes.extend(doc_changes)

    # Authoritative bio normalization (lxml, position-based). Repairs the
    # Google-Docs bare-reference case and rebuilds the canonical custom-mark
    # ref shape; leaves a correct bio untouched (idempotent).
    doc_xml_fixed, fn_xml_fixed, bio_norm_changes = restore_bio_custom_marks(
        doc_xml_fixed, fn_xml_fixed, bio_count)
    all_changes.extend(bio_norm_changes)

    # Superscript the bio reference marks — MUST run after restore_bio_custom_marks,
    # which rebuilds the ref runs (and would otherwise discard the vertAlign). The
    # ref_style_ok check uses the *original* styles: when a Google Docs round-trip
    # stripped superscript out of the FootnoteReference style, the bare style ref
    # is not enough and we add explicit vertAlign.
    doc_xml_fixed, bio_ref_changes = fix_bio_superscript(
        doc_xml_fixed, bio_count,
        ref_style_ok=_footnote_ref_style_has_superscript(styles_xml))
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

    # Feature 2: heading normalization (opt-in). Runs last on document.xml, after
    # the goog_rdk strip so TOC detection sees the kept docPartObj sdt.
    if args.normalize_headings:
        # 2b first: style heading-looking paragraphs that aren't yet headings, so
        # 2a then normalizes their formatting too.
        doc_xml_fixed, h2b_changes = normalize_headings(doc_xml_fixed)
        all_changes.extend(h2b_changes)
        # 2a: strip direct formatting + delete empty heading paragraphs.
        doc_xml_fixed, h2a_changes = normalize_heading_formatting(doc_xml_fixed)
        all_changes.extend(h2a_changes)
        # Restore Heading1-4 style definitions from the template if a round-trip
        # stripped them (same add-only restore fix_footnotes does for FNStyleBest).
        styles_xml_fixed, heading_style_changes = ensure_footnote_styles(
            styles_xml_fixed, args.template,
            needed=("Heading1", "Heading2", "Heading3", "Heading4"))
        all_changes.extend(heading_style_changes)

    if args.fix_numbering:
        settings_xml_fixed, fn_xml_fixed, doc_xml_fixed, num_changes = fix_numbering_offset(
            settings_xml_fixed, fn_xml_fixed, doc_xml_fixed, bio_count)
        all_changes.extend(num_changes)

    # Body-paragraph first-line-indent normalization (editorial, opt-in).
    if args.normalize_body_indent or args.restyle_body:
        doc_xml_fixed, tab_changes = fix_leading_tab_indents(doc_xml_fixed)
        all_changes.extend(tab_changes)
        doc_xml_fixed, indent_changes = normalize_body_indent(doc_xml_fixed)
        all_changes.extend(indent_changes)

    # Move body formatting into the template's body styles (editorial, opt-in,
    # reflows). Runs AFTER the indent passes so tab-led / indent-lacking paras
    # already carry a real firstLine to convert into a BodyText style.
    if args.restyle_body:
        doc_xml_fixed, styles_xml_fixed, restyle_changes = apply_template_body_styles(
            doc_xml_fixed, styles_xml_fixed or styles_xml, args.template)
        all_changes.extend(restyle_changes)

    # Content-part post-processing across every part that carries body content.
    # document.xml + footnotes.xml are already in flight (goog strip applied
    # above); the auxiliary parts (comments, headers, footers) are read here.
    # Two passes per part, both scoped to the SAME content-part list:
    #   * Feature 1 — strip goog_rdk content controls (ALWAYS; they render as
    #     boxes in the footnote/comment area too, not just the body);
    #   * Hygiene de-cruft (default-on; --no-hygiene skips).
    # Cleaned aux parts are collected in `aux_out` for the write loop.
    aux_out = {}
    default_font = _default_body_font(styles_xml_fixed or styles_xml)
    if not args.no_hygiene:
        doc_xml_fixed, n = gdocs_hygiene(doc_xml_fixed, default_font)
        if n:
            all_changes.append(f"Hygiene: removed {n} GDocs cruft node(s)/attr(s) from document.xml")
        fn_xml_fixed, n = gdocs_hygiene(fn_xml_fixed, default_font)
        if n:
            all_changes.append(f"Hygiene: removed {n} GDocs cruft node(s)/attr(s) from footnotes.xml")
    with zipfile.ZipFile(docx_path, 'r') as zf:
        for name in zf.namelist():
            if name in ('word/document.xml', 'word/footnotes.xml'):
                continue
            if not is_hygiene_part(name):
                continue
            xml = zf.read(name).decode('utf-8')
            changed = False
            xml, sdt_ch = strip_goog_content_controls(xml)
            if sdt_ch:
                changed = True
                all_changes.append(f"{name}: " + sdt_ch[0])
            if not args.no_hygiene:
                xml, n = gdocs_hygiene(xml, default_font)
                if n:
                    changed = True
                    all_changes.append(f"Hygiene: removed {n} GDocs cruft node(s)/attr(s) from {name}")
            if changed:
                aux_out[name] = xml

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
                    elif item.filename in aux_out:
                        zout.writestr(item, aux_out[item.filename].encode('utf-8'))
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
