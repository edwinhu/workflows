#!/usr/bin/env -S uv run --with lxml python3
"""Fast regex screen for AI-writing anti-patterns.

Backstops the LLM-based `/ai-anti-patterns` review by running the regex
tables in `references/wikipedia-*.py` against arbitrary files. Cheap to
run on every draft before a more expensive prose review.

Usage:
    uv run --with lxml python3 screen.py path/to/draft.docx
    uv run --with lxml python3 screen.py path/to/draft.md path/to/other.docx
    uv run --with lxml python3 screen.py --only structural draft.docx

Output: one line per match, `path:line:col [category] context`.
Exit code 0 if no matches, 1 if any match (so it can gate CI / hooks).

Categories pulled from references/wikipedia-*.py — to add a pattern,
edit the corresponding module; this script picks it up automatically.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path
from typing import Iterable

REF_DIR = Path(__file__).resolve().parent.parent / "references"

# Use the shared extractor at ~/projects/workflows/scripts/prose_extract.py.
# Falls back to a local copy if the workflows scripts dir is not reachable
# (e.g., the skill was vendored elsewhere).
_WORKFLOWS_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
if (_WORKFLOWS_SCRIPTS / "prose_extract.py").exists():
    sys.path.insert(0, str(_WORKFLOWS_SCRIPTS))
import prose_extract  # noqa: E402

# Each entry: (category short-name, module filename, attribute holding patterns)
PATTERN_TABLES = [
    ("structural",   "wikipedia-structural-patterns.py",     "_STRUCTURAL_PATTERNS"),
    ("puffery",      "wikipedia-puffery-and-exaggeration.py", "_PUFFERY_PATTERNS"),
    ("promotional",  "wikipedia-promotional-language.py",    "_PROMOTIONAL_PATTERNS"),
    ("chatgpt",      "wikipedia-chatgpt-artifacts.py",       "_ARTIFACT_PATTERNS"),
    ("template",     "wikipedia-template-artifacts.py",      "_PLACEHOLDER_PATTERNS"),
    ("communication","wikipedia-communication-patterns.py",  "_HARD_PATTERNS"),
    ("communication","wikipedia-communication-patterns.py",  "_SOFT_PATTERNS"),
    # Scored AI-tic table (generated from the ai-tic linter's tics.yaml): every
    # entry passed the ~0-human-rate gate against the law+finance corpora; the
    # severity (sev1-5) rides in the label as `ai-tic·sevN·id`.
    ("scored-tic",   "scored-tics-patterns.py",               "_TIC_PATTERNS"),
]


def load_patterns(only: set[str] | None = None):
    """Yield (category, label, compiled_regex) for every pattern in scope."""
    for category, filename, attr in PATTERN_TABLES:
        if only and category not in only:
            continue
        path = REF_DIR / filename
        if not path.exists():
            continue
        spec = importlib.util.spec_from_file_location(filename.replace("-", "_"), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        table = getattr(mod, attr, None)
        if not table:
            continue
        for pattern, label in table:
            try:
                rx = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
            except re.error as e:
                print(f"WARN: bad regex in {filename}:{attr} — {e}", file=sys.stderr)
                continue
            yield category, label, rx


# ── Text extraction ────────────────────────────────────────────────────
# Delegate to the shared helper. Kept as a thin alias so callers that already
# import `extract` from this module don't break.
extract = prose_extract.read_lines


# ── Match runner ───────────────────────────────────────────────────────
def screen(path: Path, patterns: Iterable[tuple[str, str, re.Pattern]],
           context_chars: int = 60, max_hits: int | None = None) -> int:
    """Print matches; return number of hits."""
    lines = extract(path)
    patterns = list(patterns)  # defensive: outer loop iterates many times
    hits = 0
    for lineno, text in lines:
        for category, label, rx in patterns:
            for m in rx.finditer(text):
                if max_hits is not None and hits >= max_hits:
                    return hits
                start = max(0, m.start() - context_chars)
                end = min(len(text), m.end() + context_chars)
                ctx = text[start:end].strip()
                # Ellipsis markers when truncated
                lead = "…" if start > 0 else ""
                trail = "…" if end < len(text) else ""
                print(f"{path}:{lineno}:{m.start()+1} [{category}] {label}")
                print(f"    {lead}{ctx}{trail}")
                hits += 1
    return hits


def main():
    parser = argparse.ArgumentParser(
        description="Regex screen for AI-writing anti-patterns",
    )
    parser.add_argument("files", nargs="+", type=Path,
                        help="Paths to .docx / .md / .txt files")
    parser.add_argument("--only", action="append", default=[],
                        help="Restrict to one or more categories: "
                             "structural, puffery, promotional, chatgpt, "
                             "template, communication. Repeatable.")
    parser.add_argument("--max", type=int, default=None,
                        help="Stop after N hits per file (default: no limit)")
    parser.add_argument("--context", type=int, default=60,
                        help="Chars of context around each match (default: 60)")
    args = parser.parse_args()

    only = set(args.only) if args.only else None
    patterns = list(load_patterns(only))
    if not patterns:
        print("No patterns loaded — check references/ directory", file=sys.stderr)
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
    print("PASS: no anti-patterns matched.", file=sys.stderr)


if __name__ == "__main__":
    main()
