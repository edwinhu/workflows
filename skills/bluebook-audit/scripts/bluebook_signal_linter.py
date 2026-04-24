#!/usr/bin/env -S uv run python3
"""Bluebook linter for Pandoc markdown drafts.

Three passes:

1. `italicize_signals(text)` — wraps Bluebook signals (`see`, `see also`,
   `cf.`, `e.g.`, `but see`, `but cf.`, `see generally`, `accord`, `contra`,
   `compare`) in `*...*` when adjacent to a citation (`@key` inside brackets,
   or `[@key]` in running prose). Preserves case. Idempotent.

2. `find_stacked_footnotes(text)` — reports adjacent footnote references
   like `text.[^1][^2]`, which the Bluebook disfavors. Detect-only; merging
   requires human judgment (combining footnote bodies).

3. `find_subpart_refs(text)` — reports `Part X §Y`, `§A`, `§B.3` style
   subpart cross-references. Discriminator vs. statute cites: `§` followed
   by a letter (optionally with digits after a dot) is a subpart; `§`
   followed by digits or inside a statute context (`U.S.C.`, `C.F.R.`,
   `Stat.`, `Code`, or similar) is a statute cite and is left alone.
   Recommended form: `Part X.Y` (letter notation).

Not fixed here: pandoc-citeproc wraps bracketed citations `[@key]` in parens
(with a leading space) when they appear mid-paragraph inside a note. Bare
textual form `@key` would render cleanly — *if* every citation had a locator —
but for many types in this project's bib (books, misc, articles without a
locator) the bare form renders as a stray number because the Bluebook CSL is
note-style and expects the full cite to go into a footnote. So we leave the
wrapping to a separate docx post-processor.

Usage:
    from bluebook_signal_linter import lint
    cleaned = lint(markdown_text)

Or as CLI:
    uv run bluebook_signal_linter.py drafts/*.md           # edit in place
    uv run bluebook_signal_linter.py --check drafts/*.md   # report only
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Longer phrases first so "see also" matches before "see".
_SIGNAL_CORE = (
    r"(?:see\s+generally"
    r"|see\s+also"
    r"|but\s+see"
    r"|but\s+cf\."
    r"|see"
    r"|cf\."
    r"|accord"
    r"|contra"
    r"|compare"
    r"|e\.g\.)"
)

# Optional `, e.g.,` tail attached to a primary signal (e.g., `see, e.g.,`).
_SIGNAL = _SIGNAL_CORE + r"(?:,\s*e\.g\.,?)?"

# Inside citation brackets: `[signal @key` or `; signal @key`.
_INSIDE = re.compile(
    r"(\[\s*|;\s*)(" + _SIGNAL + r")(\s+@)",
    re.IGNORECASE,
)

# In prose before a parenthetical citation `[@key]`.
# Lookbehind rejects emphasis markers and word chars (no mid-word matches like
# "oversee"), and the preceding character class is restrictive enough that
# ordinary verbs not adjacent to a citation won't trigger.
_PROSE = re.compile(
    r"(?<![*_\w])(" + _SIGNAL + r")(\s+\[@)",
    re.IGNORECASE,
)


# Adjacent footnote references with at most whitespace/punctuation between.
# `[^label]:` (the definition form) has a trailing `:` and must not match.
_STACKED = re.compile(
    r"\[\^[^\]]+\](?![:(])[\s.,;:!?]*\[\^[^\]]+\](?!:)",
)


# Subpart cross-reference detection.
# Discriminator: `§` followed by a capital letter (A–Z, optionally `.N` for
# sub-subparts like `§B.3`) is a subpart. `§` followed by a digit — e.g.,
# `§ 216(1)`, `§ 78m(d)` — is a statute cite and never matches.
_SUBPART_REF = re.compile(
    r"(?:Part\s+[IVX]+\s+|Section\s+[IVX\d]+\s+)?"  # optional Part/Section prefix
    r"§\s*([A-Z](?:\.\d+)*)"                        # §B, §B.3, etc.
    r"(?![a-z])"                                    # not a word continuation
)


def find_subpart_refs(text: str) -> list[tuple[int, str, str]]:
    """Return `(line_number, raw_match, suggested_fix)` for each subpart ref.

    Proposes the letter-notation rewrite: `Part X §Y` → `Part X.Y`. For a
    bare `§Y` the caller must supply the enclosing Part's label, so the
    suggestion is returned with a `(prefix with current Part)` hint.
    """
    hits: list[tuple[int, str, str]] = []
    for m in _SUBPART_REF.finditer(text):
        raw = m.group(0)
        letter_part = m.group(1)
        if raw.lstrip().startswith("Part"):
            suggestion = re.sub(r"\s+§\s*", ".", raw, count=1)
        else:
            suggestion = f".{letter_part}  (prefix with current Part)"
        line_no = text.count("\n", 0, m.start()) + 1
        hits.append((line_no, raw, suggestion))
    return hits


def find_stacked_footnotes(text: str) -> list[tuple[int, str]]:
    """Return `(line_number, snippet)` for each pair of adjacent footnote refs.

    Stacked references like `word.[^1][^2]` should be merged per Bluebook
    convention (one footnote per citation sentence). This reports only;
    merging requires combining footnote bodies, which is a human call.
    """
    hits: list[tuple[int, str]] = []
    for m in _STACKED.finditer(text):
        start = m.start()
        line_no = text.count("\n", 0, start) + 1
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", m.end())
        line_end = len(text) if line_end == -1 else line_end
        hits.append((line_no, text[line_start:line_end]))
    return hits


def lint(text: str) -> str:
    """Run all rewrite passes on `text`. Idempotent."""
    return italicize_signals(text)


def italicize_signals(text: str) -> str:
    """Return `text` with Bluebook signals wrapped in asterisks near citations."""
    text = _INSIDE.sub(
        lambda m: f"{m.group(1)}*{m.group(2)}*{m.group(3)}",
        text,
    )
    text = _PROSE.sub(
        lambda m: f"*{m.group(1)}*{m.group(2)}",
        text,
    )
    return text


def _diff_first_change(a: str, b: str) -> str:
    """Return a short context string showing the first differing line."""
    for i, (la, lb) in enumerate(zip(a.splitlines(), b.splitlines()), 1):
        if la != lb:
            return f"line {i}:\n  - {la}\n  + {lb}"
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Italicize Bluebook signals near Pandoc citations.",
    )
    parser.add_argument("files", nargs="+", type=Path, help="Markdown files.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Report files that would change; exit 1 if any. Do not write.",
    )
    args = parser.parse_args()

    changed = []
    stacked_hits: list[tuple[Path, int, str]] = []
    subpart_hits: list[tuple[Path, int, str, str]] = []
    for path in args.files:
        original = path.read_text()
        fixed = lint(original)
        if original != fixed:
            changed.append(path)
            if args.check:
                sample = _diff_first_change(original, fixed)
                print(f"would modify: {path}\n{sample}", file=sys.stderr)
            else:
                path.write_text(fixed)
                print(f"modified: {path}")

        # Detect-only checks run against the fixed (or original) text.
        source = fixed if not args.check else original
        for lineno, snippet in find_stacked_footnotes(source):
            stacked_hits.append((path, lineno, snippet))
        for lineno, raw, suggestion in find_subpart_refs(source):
            subpart_hits.append((path, lineno, raw, suggestion))

    for path, lineno, snippet in stacked_hits:
        print(f"stacked footnote: {path}:{lineno}: {snippet}", file=sys.stderr)
    for path, lineno, raw, suggestion in subpart_hits:
        print(f"subpart ref: {path}:{lineno}: {raw!r} → {suggestion!r}", file=sys.stderr)

    if args.check and (changed or stacked_hits or subpart_hits):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
