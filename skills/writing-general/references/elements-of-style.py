#!/usr/bin/env python3
"""Constraint: strunk-elements-of-style — detect violations from Strunk's Elements of Style Section V."""
import re
import sys
from pathlib import Path

CONSTRAINT = "strunk-elements-of-style"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

# Section V: Words and Expressions Commonly Misused — testable violations
_HARD_VIOLATIONS = [
    # Rule 5 proxy: comma splice marker
    # (too many false positives to check mechanically — left as convention)

    # "Different than" — should be "different from"
    (r'\bdifferent\s+than\b', "S&W §V: 'different than' → use 'different from'"),

    # "Due to" as adverbial (incorrect): "He lost, due to carelessness"
    (r',\s*due\s+to\b', "S&W §V: 'due to' as adverbial modifier — use 'because of' or 'owing to'"),

    # "The fact that" — almost always cut-able
    (r'\bthe\s+fact\s+that\b', "S&W Rule 13: 'the fact that' — omit or rewrite"),
    (r'\bdue\s+to\s+the\s+fact\s+that\b', "S&W Rule 13: 'due to the fact that' → 'because'"),
    (r'\bin\s+(light|view)\s+of\s+the\s+fact\s+that\b',
     "S&W Rule 13: 'in view of the fact that' → 'since' or 'because'"),

    # "He is a man who" — redundant construction
    (r'\b\w+\s+is\s+(a|an)\s+\w+\s+who\b', "S&W Rule 13: 'X is a Y who' — cut the relative clause intro"),

    # Less/fewer: "less" before countable noun (rough heuristic)
    (r'\bless\s+(people|students|cases|instances|examples|times|words|pages|citations|arguments|courts|judges)\b',
     "S&W §V: 'less' → 'fewer' before countable nouns"),

    # "Most" for "almost"
    (r'\bmost\s+all\b|\bmost\s+any\b|\bmost\s+everyone\b|\bmost\s+always\b',
     "S&W §V: 'most all/any/everyone/always' → 'almost'"),

    # "Kind of" / "sort of" as hedges (not literal)
    (r'\b(kind|sort)\s+of\s+(important|significant|clear|obvious|clear|interesting|useful|helpful)\b',
     "S&W §V: 'kind of X' → 'rather X' or 'somewhat X'"),

    # "Try and" instead of "try to"
    (r'\btry\s+and\s+\w', "S&W §V / McCloskey: 'try and' → 'try to'"),

    # "Interesting" as a perfunctory introduction
    (r'\b(it\s+is|this\s+is)\s+interesting\s+(to\s+note|that|how)\b',
     "S&W §V: 'it is interesting that' — make it interesting, don't announce it"),
    (r'^\s*(Interesting(ly)?|It\s+is\s+interesting)\b',
     "S&W §V: 'Interesting...' opener — cut the announcement"),

    # "Certainly" / "very" as empty intensifiers
    (r'\bvery\s+(important|significant|clear|obvious|interesting|useful|critical|crucial)\b',
     "S&W §V: 'very X' — use a more precise intensifier or cut 'very'"),
    (r'^\s*Certainly\b|\bCertainly,\s+\w',
     "S&W §V: 'Certainly' as intensifier — often empty"),
]

_SOFT_VIOLATIONS = [
    # "Along these lines" — overworked phrase
    (r'\balong\s+these\s+lines\b', "S&W §V: 'along these lines' — overworked phrase, be specific"),

    # "Factor" / "Feature" as hackneyed nouns
    (r'\b(key|important|critical|major|significant)\s+factor\b',
     "S&W §V: 'X factor' — hackneyed; name the specific cause"),
    (r'\b(important|key|notable|significant)\s+feature\b',
     "S&W §V: 'X feature' — hackneyed; describe it specifically"),

    # "However" as first word of sentence
    (r'^\s*However,\s', "S&W §V: 'However,' at sentence start — move to mid-sentence"),

    # "Etc." in academic writing
    (r'\betc\.\s*$|\betc\.,', "S&W §V: 'etc.' — complete the list or use 'such as'"),

    # Passive voice proxy (soft warn)
    (r'\b(is|are|was|were|been|being)\s+(being\s+)?\w+ed\b',
     "S&W Rule 10: possible passive voice — prefer active where the actor matters"),
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
        rel = path.relative_to(cwd)
        for i, line in enumerate(text.splitlines(), start=1):
            # Skip markdown heading lines for passive voice check (they're not prose)
            is_heading = line.strip().startswith("#")
            for pattern, label in _HARD_VIOLATIONS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: {label}")
            if not is_heading:
                for pattern, label in _SOFT_VIOLATIONS:
                    if re.search(pattern, line, re.IGNORECASE):
                        violations.append(f"{rel}:{i}: SOFT — {label}")
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
