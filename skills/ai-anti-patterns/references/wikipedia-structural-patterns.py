#!/usr/bin/env -S uv run python3
"""Constraint: ai-structural-patterns — detect AI structural filler phrases in draft text."""
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

CONSTRAINT = "wikipedia-structural-patterns"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

_STRUCTURAL_PATTERNS = [
    # Section-ending filler
    (r'^\s*(In\s+summary|In\s+conclusion|To\s+summarize|To\s+conclude|Overall),?\s*[A-Z]',
     "structure: section-ending summary filler ('In summary/conclusion') — cut or rewrite as argument"),
    # Despite-challenges formula
    (r'\bDespite\s+(these\s+)?(challenges?|obstacles?|difficulties|setbacks?)\b',
     "structure: 'Despite these challenges' formula — AI recovery arc, verify it's not formulaic"),
    # Negative parallelism / antithesis flourishes — match BOTH contracted
    # ('it's') and uncontracted ('it is') forms. The uncontracted variant is
    # easy to overlook because most published examples use the contraction.
    (r'\bNot\s+only\b.*\bbut\s+(also\s+)?\b',
     "structure: 'Not only...but also' — often AI padding"),
    (r'\bIt\s+is\s+not\s+just\s+(about|a\s+matter\s+of)\b',
     "structure: 'It is not just about' — AI framing cliché"),
    # "X is not Y, it is/it's Z" / "X is not Y; it is Z" / "X is not Y — it is Z"
    # Matches uncontracted "it is" as well as "it's" / "it’s".
    (r'\bis\s+not\s+[^.;:!?]{2,80}?[,;—-]\s+it[’\']?s?\s+(?:is\s+)?[a-z]',
     "structure: 'is not X, it is Y' antithesis — AI flourish, prefer the positive statement"),
    # "isn't X, it is/it's Y"
    (r"\bisn[’']t\s+[^.;:!?]{2,80}?[,;—-]\s+it[’']?s?\s+(?:is\s+)?[a-z]",
     "structure: \"isn't X, it is Y\" antithesis — AI flourish"),
    # ", not X" parallel tail (only when followed by a prepositional/comparative
    # form that signals the antithetical-parallel cadence)
    (r',\s+not\s+(?:through|by|because|from|via|merely|only|just|simply|to)\b',
     "structure: 'X, not Y' parallel tail — substantive comparisons OK, but two stacked in one sentence is AI cadence"),
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
