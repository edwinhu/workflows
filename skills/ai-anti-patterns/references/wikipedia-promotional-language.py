#!/usr/bin/env -S uv run python3
"""Constraint: ai-promotional-language — detect promotional language in draft text."""
import re
import sys
from pathlib import Path

# ── Shared draft extractor ─────────────────────────────────────────────
# Path traversal: <workflows>/skills/<skill>/references/<this file>
# We want         <workflows>/scripts/prose_extract.py
_SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
if (_SCRIPTS_DIR / "prose_extract.py").exists():
    sys.path.insert(0, str(_SCRIPTS_DIR))
import prose_extract  # noqa: E402

CONSTRAINT = "wikipedia-promotional-language"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

_PROMOTIONAL_PATTERNS = [
    (r'\b(rich|vibrant)\s+(tapestry|heritage|history|culture)\b', "promotional: 'rich/vibrant tapestry'"),
    (r'\b(cultural|artistic|literary|intellectual)\s+landscape\b', "promotional: 'X landscape'"),
    (r'\bboasts\s+(a|an|the|its)\b', "promotional: 'boasts a'"),
    (r'\bcontinues?\s+to\s+captivate\b', "promotional: 'continues to captivate'"),
    (r'\b(groundbreaking|revolutionary|transformative|paradigm-shifting)\b',
     "promotional: unsubstantiated superlative"),
    (r'\bstunning\s+(natural\s+)?beauty\b', "promotional: 'stunning beauty'"),
    (r'\bnestled\s+(in|among|between|within|at)\b', "promotional: 'nestled in'"),
    (r'\bin\s+the\s+heart\s+of\b', "promotional: 'in the heart of'"),
    (r'\b(it\s*\'?s?|it\s+is)\s+important\s+to\s+(note|remember|consider|acknowledge)\b',
     "promotional/AI marker: 'it is important to note'"),
    (r'\bmay\s+vary\s+(depending|based)\b', "promotional: generic hedge 'may vary'"),
    (r'\bthriving\s+(community|hub|center|ecosystem)\b', "promotional: 'thriving community'"),
    (r'\bdynamic\s+(hub|community|center|landscape|environment)\b', "promotional: 'dynamic hub'"),
]


def _find_draft_files(cwd):
    # Shared discovery — picks up .md, .markdown, .docx, .txt under
    # drafts/ and outlines/. See workflows/scripts/prose_extract.py.
    return prose_extract.find_draft_files(cwd)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = _find_draft_files(cwd)

    if not draft_files:
        return violations

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        for i, line in line_iter:
            for pattern, label in _PROMOTIONAL_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: {label} — replace with specific, neutral language"
                    )
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
