#!/usr/bin/env -S uv run python3
"""footnote_mask — shared footnote/citation masker for prose scorers.

Footnotes/citations are OFF-LIMITS to a de-AI rewrite and to prose-quality linting: they
carry `[@bibkey]` cites, quoted and statutory text, and legal-normal prose that would
otherwise trip tic/diction/style findings meant for BODY prose only. Masking blanks
footnote spans to spaces — PRESERVING line count and every line's length — so line-anchored
findings never land inside a footnote and reported line numbers stay valid without any
caller needing to track an offset map.

Extracted (finding 5/7, code-review pass) from skills/de-ai-revise/scripts/de_ai_audit.py,
which was the only caller, so that hooks/writing-prose-check.py (which invokes
style_metrics.py --lint directly on an on-disk draft) can mask BEFORE linting too, instead
of scoring footnote text as if it were body prose.

Covers:
  - pandoc inline `^[...]` footnotes (one level of nested `[...]` for citations)
  - markdown reference-style `[^id]: ...` definitions, including MULTI-PARAGRAPH
    continuations (a blank line does not end the block if the next non-blank line is
    still indented — pandoc's syntax for a footnote spanning more than one paragraph)
"""
from __future__ import annotations

import re

_INLINE_FN = re.compile(r"\^\[(?:[^\[\]]|\[[^\]]*\])*\]")
_REF_FN_DEF = re.compile(r"^\s*\[\^[^\]]+\]:")


def _blank(s: str) -> str:
    """Replace every non-newline char with a space (keeps length + line breaks)."""
    return re.sub(r"[^\n]", " ", s)


def mask_footnotes(text: str) -> str:
    # 1. inline ^[...] footnotes (may span lines; _blank preserves the newlines)
    text = _INLINE_FN.sub(lambda m: _blank(m.group(0)), text)
    # 2. reference [^id]: definition blocks — the def line + indented continuation lines,
    # INCLUDING multi-paragraph continuations. Pandoc footnotes may have a blank line between
    # paragraphs of the SAME footnote, with the next paragraph still 4-space/tab indented — a
    # blank line does NOT end the block unless the next non-blank line is un-indented (a new
    # footnote def, or body text). Look past a run of blank lines to decide.
    lines = text.split("\n")
    n = len(lines)
    out, in_def, i = [], False, 0
    while i < n:
        ln = lines[i]
        if _REF_FN_DEF.match(ln):
            in_def = True
            out.append(_blank(ln)); i += 1; continue
        if in_def:
            if ln.strip() == "":
                j = i
                while j < n and lines[j].strip() == "":
                    j += 1
                if j < n and re.match(r"^(\s{2,}|\t)", lines[j]):
                    out.append(_blank(ln)); i += 1; continue   # continuation paragraph ahead — stay masked
                in_def = False
                out.append(ln); i += 1; continue              # no continuation follows — block ends here
            if re.match(r"^(\s{2,}|\t)", ln):  # indented continuation stays masked
                out.append(_blank(ln)); i += 1; continue
            in_def = False                # non-indented line ends the block
        out.append(ln); i += 1
    return "\n".join(out)
