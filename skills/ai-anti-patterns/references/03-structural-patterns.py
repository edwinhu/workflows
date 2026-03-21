#!/usr/bin/env python3
"""Constraint: ai-structural-patterns — detect AI structural filler phrases in draft text."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ai-structural-patterns"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

_STRUCTURAL_PATTERNS = [
    # Section-ending filler
    (r'^\s*(In\s+summary|In\s+conclusion|To\s+summarize|To\s+conclude|Overall),?\s*[A-Z]',
     "structure: section-ending summary filler ('In summary/conclusion') — cut or rewrite as argument"),
    # Despite-challenges formula
    (r'\bDespite\s+(these\s+)?(challenges?|obstacles?|difficulties|setbacks?)\b',
     "structure: 'Despite these challenges' formula — AI recovery arc, verify it's not formulaic"),
    # Negative parallelism openers
    (r'\bNot\s+only\b.*\bbut\s+(also\s+)?\b', "structure: 'Not only...but also' — often AI padding"),
    (r'\bIt\s+is\s+not\s+just\s+(about|a\s+matter\s+of)\b',
     "structure: 'It is not just about' — AI framing cliché"),
    # Weasel attributions
    (r'\b(industry|market|published?)\s+reports?\s+(suggest|indicate|show|note)\b',
     "structure: vague attribution 'industry reports suggest' — cite a specific source"),
    (r'\b(observers?|analysts?|experts?|researchers?|scholars?)\s+(have\s+)?(cited|noted|argued|suggested|observed)\b',
     "structure: vague attribution 'observers have noted' — who specifically?"),
    (r'\bhave\s+been\s+described\s+as\b',
     "structure: passive vague attribution 'have been described as' — by whom?"),
    # AI conversation openers that bleed into prose
    (r'^\s*(Certainly|Of\s+course|Absolutely|Definitely)[!,.]',
     "structure: chatbot opener at start of paragraph"),
]


def _find_draft_files(cwd):
    paths = []
    for subdir in ("drafts", "outlines"):
        d = cwd / subdir
        if d.is_dir():
            paths.extend(d.glob("*.md"))
    return paths


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = _find_draft_files(cwd)

    if not draft_files:
        return violations

    for path in draft_files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            for pattern, label in _STRUCTURAL_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: {label}"
                    )
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
