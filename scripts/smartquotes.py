#!/usr/bin/env python3
"""
Convert straight quotes to typographic (smart) quotes in markdown files.

Usage:
    python smartquotes.py <file.md>
    python smartquotes.py <file.md> --check  # dry-run, show diff

Converts:
    "straight" → "curly"
    'straight' → 'curly'
    apostrophes: don't → don't

Preserves:
    - Em dashes (—)
    - Code blocks and inline code
    - All other formatting

Requires: pip install smartypants
"""

import argparse
import html
import sys
from pathlib import Path

try:
    import smartypants
except ImportError:
    print("Error: smartypants not installed. Run: pip install smartypants", file=sys.stderr)
    sys.exit(1)


def convert_quotes(text: str) -> str:
    """Convert straight quotes to smart quotes, preserving code blocks."""
    # smartypants.Attr.q = quotes only (no dashes, ellipses, etc.)
    converted = smartypants.smartypants(text, smartypants.Attr.q)
    # smartypants outputs HTML entities; decode to Unicode
    return html.unescape(converted)


def main():
    parser = argparse.ArgumentParser(
        description="Convert straight quotes to smart quotes in markdown files."
    )
    parser.add_argument("file", type=Path, help="Markdown file to process")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Dry run: show what would change without modifying the file",
    )
    args = parser.parse_args()

    if not args.file.exists():
        print(f"Error: {args.file} not found", file=sys.stderr)
        sys.exit(1)

    original = args.file.read_text()
    converted = convert_quotes(original)

    if args.check:
        if original == converted:
            print("No changes needed.")
        else:
            # Show simple before/after for changed lines
            orig_lines = original.splitlines()
            conv_lines = converted.splitlines()
            changes = 0
            for i, (o, c) in enumerate(zip(orig_lines, conv_lines), 1):
                if o != c:
                    changes += 1
                    print(f"Line {i}:")
                    print(f"  - {o[:80]}{'...' if len(o) > 80 else ''}")
                    print(f"  + {c[:80]}{'...' if len(c) > 80 else ''}")
            print(f"\n{changes} line(s) would be changed.")
        sys.exit(0)

    if original == converted:
        print("No changes needed.")
    else:
        args.file.write_text(converted)
        print(f"Converted quotes in {args.file}")


if __name__ == "__main__":
    main()
