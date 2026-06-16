"""Prose extraction for writing-skill constraint checks.

Two responsibilities:
  1. Find draft files in a project (`drafts/`, `outlines/`) — both .md and
     .docx, since later-stage drafts are often .docx (Word, Google Docs export).
  2. Yield (lineno, text) tuples for either format. For .docx the "lineno" is
     a 1-based paragraph index across document.xml and footnotes.xml.

`is_docx` sniffs the ZIP magic + `word/document.xml` entry rather than the
file suffix, so `.docx.bak` / `.docx.bak3` / numbered backups still detect
correctly.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Iterator

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

DRAFT_GLOBS = ("*.md", "*.markdown", "*.docx", "*.txt", "*.typ")
DRAFT_SUBDIRS = ("drafts", "outlines")


def find_draft_files(cwd: Path) -> list[Path]:
    """Return draft files under `<cwd>/{drafts,outlines}/` matching DRAFT_GLOBS."""
    paths: list[Path] = []
    for subdir in DRAFT_SUBDIRS:
        d = cwd / subdir
        if d.is_dir():
            for g in DRAFT_GLOBS:
                paths.extend(d.glob(g))
    return paths


def is_docx(path: Path) -> bool:
    """Detect docx by ZIP magic + presence of word/document.xml. Tolerates
    suffixes like .docx.bak that authors create around edits."""
    try:
        with path.open("rb") as f:
            if f.read(4) != b"PK\x03\x04":
                return False
        with zipfile.ZipFile(path) as z:
            return "word/document.xml" in z.namelist()
    except (OSError, zipfile.BadZipFile):
        return False


def _iter_docx_paragraphs(path: Path) -> Iterator[tuple[int, str]]:
    try:
        from lxml import etree
    except ImportError as e:
        raise RuntimeError(
            "lxml is required to read .docx — install with `uv add lxml` or "
            "run the script with `uv run --with lxml python3 ...`"
        ) from e
    counter = 0
    with zipfile.ZipFile(path) as z:
        for member in ("word/document.xml", "word/footnotes.xml"):
            try:
                data = z.read(member)
            except KeyError:
                continue
            root = etree.fromstring(data)
            for p in root.iter(W_NS + "p"):
                text = "".join(t.text or "" for t in p.iter(W_NS + "t"))
                if text.strip():
                    counter += 1
                    yield counter, text


def _iter_text_lines(path: Path) -> Iterator[tuple[int, str]]:
    """Yield (lineno, line) for a .md / .txt file. Skips fenced code blocks
    (```...```) since constraint checks are about prose, not code samples."""
    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    in_fence = False
    for i, line in enumerate(content.splitlines(), start=1):
        stripped = line.rstrip()
        if stripped.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        yield i, stripped


def _delim_delta(line: str) -> int:
    """Net count of opening minus closing brackets/braces/parens in a line.

    Used to track multi-line Typst code expressions (e.g. a `#let foo = (` dict
    spanning several lines). Naive — does not account for delimiters inside
    string literals — but adequate for skipping code blocks in a prose linter.
    """
    opens = line.count("(") + line.count("{") + line.count("[")
    closes = line.count(")") + line.count("}") + line.count("]")
    return opens - closes


def _iter_typ_lines(path: Path) -> Iterator[tuple[int, str]]:
    """Yield (lineno, prose_text) for a Typst (.typ) file, stripping markup.

    Typst mixes prose with code/markup. We want only the prose body so that
    prose rules (Strunk, AI tells, …) don't fire on `#let`/`#import`/function
    calls. We skip:
      - lines starting with `#` (code/markup: #let, #import, #show, #set,
        #figure, function calls) and any continuation lines while a `#`-line's
        brackets remain unbalanced (multi-line dicts/args);
      - `//` line comments and `/* … */` block comments;
      - lines that are only bracket/brace punctuation;
    and we strip leading heading (`=`) and list (`-`, `+`) markers, yielding the
    remaining prose text. Everything else is yielded verbatim.
    """
    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    in_block_comment = False
    code_depth = 0  # unbalanced delimiters opened by a skipped code line
    for i, raw in enumerate(content.splitlines(), start=1):
        line = raw.strip()

        # Block comments /* ... */
        if in_block_comment:
            if "*/" in line:
                in_block_comment = False
            continue
        if line.startswith("/*"):
            if "*/" not in line:
                in_block_comment = True
            continue

        # Continuation of a multi-line code expression.
        if code_depth > 0:
            code_depth = max(0, code_depth + _delim_delta(line))
            continue

        if not line:
            continue
        if line.startswith("//"):
            continue

        # Typst code/markup commands and function calls.
        if line.startswith("#"):
            code_depth = max(0, _delim_delta(line))
            continue

        # Markup-only lines (e.g. a lone `]`, `)`, or `{`).
        if line and all(ch in "[](){}" for ch in line):
            continue

        # Strip leading heading markers (`=`, `==`, …).
        if line.startswith("="):
            line = line.lstrip("=").strip()
            if not line:
                continue
        # Strip leading list markers (`-`, `+`).
        elif line[:1] in ("-", "+") and line[1:2] in (" ", ""):
            line = line[1:].strip()
            if not line:
                continue

        yield i, line


def iter_lines(path: Path) -> Iterator[tuple[int, str]]:
    """Unified line iterator — docx by paragraph, typst/text by line."""
    if is_docx(path):
        yield from _iter_docx_paragraphs(path)
    elif path.suffix.lower() == ".typ":
        yield from _iter_typ_lines(path)
    else:
        yield from _iter_text_lines(path)


def read_lines(path: Path) -> list[tuple[int, str]]:
    """Materialized variant of iter_lines (callers iterate multiple times)."""
    return list(iter_lines(path))
