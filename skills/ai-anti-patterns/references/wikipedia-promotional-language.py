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
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "soft"

_PROMOTIONAL_PATTERNS = [
    (r'\b(rich|vibrant)\s+(tapestry|heritage|history|culture)\b', "promotional: 'rich/vibrant tapestry'"),
    (r'\b(cultural|artistic|literary|intellectual)\s+landscape\b', "promotional: 'X landscape'"),
    (r'\bboasts\s+(a|an|the|its)\b', "promotional: 'boasts a'"),
    (r'\bcontinues?\s+to\s+captivate\b', "promotional: 'continues to captivate'"),
    # SUPERLATIVES — the ai-smell implementation replaced the flat match here (v5.127.0).
    #
    # The flat rule was `(groundbreaking|revolutionary|transformative|paradigm-shifting)`, which
    # fires on "unprecedented federal intervention" and "transformative use doctrine" — a legal
    # term of art and a historical fact, neither of them puffery. writing-ai-smell-puffery had the
    # better answer: flag a superlative only when it modifies the AUTHOR'S OWN work, detected by a
    # 60-character window to a self-contribution noun. That heuristic was a Python function, which
    # no table-driven loader could see; encoded here as a regex, it reaches every loader.
    #
    # The regex measures the GAP between the two tokens rather than a window centred on the
    # superlative — marginally tighter than the original, and the same rule in every direction.
    ((r'\b(?:article|analysis|framework|finding|approach|paper|argument|thesis|contribution|'
      r'study|research|theory|claim)\b.{0,60}?'
      r'\b(?:unprecedented|transformative|revolutionary|groundbreaking)\b'
      r'|\b(?:unprecedented|transformative|revolutionary|groundbreaking)\b.{0,60}?'
      r'\b(?:article|analysis|framework|finding|approach|paper|argument|thesis|contribution|'
      r'study|research|theory|claim)\b'),
     ("promotional: superlative self-attribution — the author's own work called unprecedented/"
      "transformative/revolutionary/groundbreaking; state what it does instead")),
    # Kept flat: `paradigm-shifting` has no legal or historical term-of-art usage to protect.
    (r'\bparadigm-shifting\b', "promotional: unsubstantiated superlative"),
    (r'\bstunning\s+(natural\s+)?beauty\b', "promotional: 'stunning beauty'"),
    # [ex-ai-smell] Broadened from `nestled (in|among|between|within|at)`: bare "nestled" is the
    # tell whatever preposition follows, and diction.yaml already rates it at 0.2/M in 14.3M
    # sentences of human law + finance prose.
    (r'\bnestled\b', "promotional: 'nestled'"),
    (r'\bin\s+the\s+heart\s+of\b', "promotional: 'in the heart of'"),
    (r'\b(it\s*\'?s?|it\s+is)\s+important\s+to\s+(note|remember|consider|acknowledge)\b',
     "promotional/AI marker: 'it is important to note'"),
    (r'\bmay\s+vary\s+(depending|based)\b', "promotional: generic hedge 'may vary'"),
    (r'\bthriving\s+(community|hub|center|ecosystem)\b', "promotional: 'thriving community'"),
    (r'\bdynamic\s+(hub|community|center|landscape|environment)\b', "promotional: 'dynamic hub'"),
    # [ex-ai-smell] Marketing adjectives this table lacked entirely.
    (r'\bcutting[- ]edge\b', "promotional: 'cutting-edge'"),
    (r'\bunparalleled\b', "promotional: 'unparalleled'"),
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
