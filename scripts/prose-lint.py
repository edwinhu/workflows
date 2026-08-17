#!/usr/bin/env -S uv run --with lxml python3
"""Unified prose linter — runs the regex constraint tables from every
writing-related skill against a draft (`.md` or `.docx`).

Covers:
  - ai-anti-patterns: AI-writing tells (puffery, antithesis, chatbot openers)
  - writing-general: Strunk & White violations
  - writing-econ:    McCloskey's *Economical Writing* word-choice rules
  - writing-legal:   Volokh's *Academic Legal Writing* substitution table

This is the on-demand counterpart to the per-skill `check(context)`
constraint runners, which only scan `<cwd>/{drafts,outlines}/*.md`. Use
this when you have a single file path (and especially when it's a `.docx`).

Usage:
    uv run --with lxml python3 prose-lint.py path/to/draft.docx
    uv run --with lxml python3 prose-lint.py drafts/*.md
    uv run --with lxml python3 prose-lint.py --only ai-anti-patterns,writing-legal draft.docx

Output: `path:line:col [category] label\\n    …context…`.
Exit 0 if no matches, 1 otherwise (so it can gate CI).
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path
from typing import Iterable

WORKFLOWS_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = WORKFLOWS_ROOT / "skills"

# Make sibling prose_extract.py importable when run directly.
sys.path.insert(0, str(WORKFLOWS_ROOT / "scripts"))
import prose_extract  # noqa: E402

# Each entry: (category, skill-dir, module-filename, attribute-name).
# Category strings let users filter via --only.
PATTERN_TABLES: list[tuple[str, str, str, str]] = [
    # ai-anti-patterns
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-structural-patterns.py",      "_STRUCTURAL_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-puffery-and-exaggeration.py", "_PUFFERY_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-promotional-language.py",     "_PROMOTIONAL_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-chatgpt-artifacts.py",        "_ARTIFACT_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-template-artifacts.py",       "_PLACEHOLDER_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-communication-patterns.py",   "_HARD_PATTERNS"),
    ("ai-anti-patterns", "ai-anti-patterns", "wikipedia-communication-patterns.py",   "_SOFT_PATTERNS"),
    # writing-general — Strunk & White
    ("writing-general",  "writing",  "strunk-elements-of-style.py", "_HARD_VIOLATIONS"),
    ("writing-general",  "writing",  "strunk-elements-of-style.py", "_SOFT_VIOLATIONS"),
    # writing-econ — McCloskey
    ("writing-econ",     "writing",     "mccloskey-economical-writing.py", "_VAGUE_NOUNS"),
    ("writing-econ",     "writing",     "mccloskey-economical-writing.py", "_PRETENTIOUS_VERBS"),
    ("writing-econ",     "writing",     "mccloskey-economical-writing.py", "_ERSATZ_ECON"),
    ("writing-econ",     "writing",     "mccloskey-economical-writing.py", "_STRUCTURAL"),
    # writing-legal — Volokh
    ("writing-legal",    "writing",    "volokh-distilled.py", "_LEGALESE"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_LONG_SYNONYMS"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_NOMINALIZATION"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_HARSH_WORDS"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_EMPTY_QUALIFIERS"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_DOUBLETS"),
    ("writing-legal",    "writing",    "volokh-distilled.py", "_INTRO_CLAUSES"),
]


def load_patterns(only: set[str] | None = None):
    """Yield (category, label, compiled_regex) for every pattern in scope."""
    for category, skill, filename, attr in PATTERN_TABLES:
        if only and category not in only:
            continue
        path = SKILLS_DIR / skill / "references" / filename
        if not path.exists():
            continue
        spec = importlib.util.spec_from_file_location(
            f"{skill}.{filename}".replace("-", "_"), path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            print(f"WARN: failed to load {path}: {e}", file=sys.stderr)
            continue
        table = getattr(mod, attr, None)
        if not table:
            continue
        for pattern, label in table:
            try:
                rx = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
            except re.error as e:
                print(f"WARN: bad regex in {filename}:{attr} — {e}",
                      file=sys.stderr)
                continue
            yield category, label, rx


def screen(path: Path, patterns: list[tuple[str, str, re.Pattern]],
           context_chars: int = 60, max_hits: int | None = None) -> int:
    """Print matches; return count."""
    lines = prose_extract.read_lines(path)
    hits = 0
    for lineno, text in lines:
        for category, label, rx in patterns:
            for m in rx.finditer(text):
                if max_hits is not None and hits >= max_hits:
                    return hits
                start = max(0, m.start() - context_chars)
                end = min(len(text), m.end() + context_chars)
                ctx = text[start:end].strip()
                lead = "…" if start > 0 else ""
                trail = "…" if end < len(text) else ""
                print(f"{path}:{lineno}:{m.start()+1} [{category}] {label}")
                print(f"    {lead}{ctx}{trail}")
                hits += 1
    return hits


def main():
    parser = argparse.ArgumentParser(
        description="Prose linter for AI patterns + S&W + McCloskey + Volokh",
    )
    parser.add_argument("files", nargs="+", type=Path,
                        help="Paths to .docx / .md / .txt files (globs OK)")
    parser.add_argument("--only", default=None,
                        help="Comma-separated category list: "
                             "ai-anti-patterns,writing-general,writing-econ,writing-legal")
    parser.add_argument("--max", type=int, default=None,
                        help="Stop after N hits per file (default: no limit)")
    parser.add_argument("--context", type=int, default=60,
                        help="Chars of context around each match (default: 60)")
    args = parser.parse_args()

    only = set(s.strip() for s in args.only.split(",")) if args.only else None
    patterns = list(load_patterns(only))
    if not patterns:
        print("No patterns loaded — check --only spelling and skill dirs",
              file=sys.stderr)
        sys.exit(2)

    total = 0
    for f in args.files:
        if not f.exists():
            print(f"WARN: {f} not found", file=sys.stderr)
            continue
        total += screen(f, patterns, args.context, args.max)

    if total:
        print(f"\n{total} hit(s) across {len(args.files)} file(s).",
              file=sys.stderr)
        sys.exit(1)
    print("PASS: no patterns matched.", file=sys.stderr)


if __name__ == "__main__":
    main()
