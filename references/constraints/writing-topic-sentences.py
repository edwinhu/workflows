#!/usr/bin/env -S uv run python3
"""Constraint: writing-topic-sentences — flag meta-commentary topic sentences in prose drafts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "writing-topic-sentences"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "hard"

_META_PATTERNS = [
    re.compile(r'\bdeserves?\s+(context|emphasis|attention|mention|noting|candor)', re.I),
    re.compile(r'\b(is|are)\s+(striking|remarkable|notable|instructive|telling|revealing)', re.I),
    re.compile(r'\bnot an overstatement\b', re.I),
    re.compile(r'\bmakes?\s+the\s+point\b', re.I),
    re.compile(r'\bworth\s+(underscoring|noting|emphasizing|highlighting)', re.I),
    re.compile(r'\bhas\s+(a|an)\s+(intuitive|structural|simple|straightforward)\s+explanation\b', re.I),
    re.compile(r'^The\s+(headline|key|central|main|primary|critical)\s+(result|finding|point|takeaway)\b', re.I),
]

_IN_FOOTNOTE = re.compile(r'^\s*\[\^')
_IS_HEADING = re.compile(r'^#+\s')
_IS_FRONTMATTER = re.compile(r'^---')
_IS_LIST = re.compile(r'^\s*[-*|]')
_IS_BLANK = re.compile(r'^\s*$')


def _is_topic_sentence(line, prev_line):
    """Heuristic: line is a topic sentence if previous line is blank, heading, or frontmatter end."""
    if not prev_line:
        return True
    prev = prev_line.strip()
    return _IS_BLANK.match(prev_line) or _IS_HEADING.match(prev) or prev == '---'


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        lines = md_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        in_frontmatter = False
        for i, line in enumerate(lines):
            stripped = line.strip()

            if stripped == '---':
                in_frontmatter = not in_frontmatter
                continue
            if in_frontmatter:
                continue

            if _IN_FOOTNOTE.match(line) or _IS_HEADING.match(stripped) or _IS_LIST.match(stripped):
                continue

            if not stripped:
                continue

            prev = lines[i - 1] if i > 0 else ""
            if not _is_topic_sentence(stripped, prev):
                continue

            for pattern in _META_PATTERNS:
                if pattern.search(stripped):
                    snippet = stripped[:80] + ("..." if len(stripped) > 80 else "")
                    violations.append(
                        f"drafts/{md_file.name}:{i+1}: meta-commentary topic sentence: "
                        f"'{snippet}'"
                    )
                    break

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
