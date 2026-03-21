#!/usr/bin/env python3
"""Constraint: volokh-academic-legal-writing — detect violations from Volokh's Academic Legal Writing."""
import re
import sys
from pathlib import Path

CONSTRAINT = "volokh-academic-legal-writing"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

# Legalese / bureaucratese — Volokh's substitution table
_LEGALESE = [
    (r'\bon\s+the\s+grounds?\s+that\b', "Volokh: 'on the grounds that' → 'because'"),
    (r'\bnegatively\s+affect\b', "Volokh: 'negatively affect' → 'harm', 'worsen', 'reduce'"),
    (r'\butilitarian\s+value\b', "Volokh: 'utilitarian value' → 'useful'"),
    (r'\baccessibility\s+of\b', "Volokh: 'accessibility of X' → 'access to X'"),
    (r'\bopposition\s+to\b.*\bis\s+needed\b',
     "Volokh: 'opposition to X is needed' → 'we should oppose X because'"),
    (r'\bimpact\s+on\b(?!\s+\w+\s+(is|was|will|would))',
     "Volokh: 'impact on' — consider 'effect on' or a concrete verb"),
]

# Long synonyms for short words — Volokh's substitution table
_LONG_SYNONYMS = [
    (r'\ba\s+large\s+number\s+of\b', "Volokh: 'a large number of' → 'many'"),
    (r'\bin\s+close\s+proximity\s+(to|with)\b', "Volokh: 'in close proximity to' → 'near'"),
    (r'\bthe\s+legislative\s+branch\s+of\s+government\b',
     "Volokh: 'the legislative branch of government' → 'the legislature'"),
    (r'\bat\s+this\s+point\s+in\s+time\b', "Volokh: 'at this point in time' → 'now'"),
    (r'\bprior\s+to\b', "Volokh: 'prior to' → 'before'"),
    (r'\bin\s+order\s+to\b', "Volokh: 'in order to' → 'to'"),
    (r'\bdue\s+to\s+the\s+fact\s+that\b', "Volokh: 'due to the fact that' → 'because'"),
    (r'\bin\s+the\s+event\s+that\b', "Volokh: 'in the event that' → 'if'"),
    (r'\bwith\s+respect\s+to\b|\bwith\s+regard\s+(to|for)\b',
     "Volokh: 'with respect/regard to' → 'about', 'regarding', or restructure"),
    (r'\bpursuant\s+to\b', "Volokh: 'pursuant to' — legalese; use 'under' or 'following'"),
    (r'\bnotwithstanding\s+(the\s+)?(foregoing|above)\b',
     "Volokh: 'notwithstanding the foregoing' — legalese; rewrite directly"),
]

# Nominalization — turning verbs/adjectives into abstract nouns
_NOMINALIZATION = [
    (r'\bthe\s+\w+tion\s+(of|in|for|by|from)\b',
     "Volokh: nominalization 'the Xtion of' — try a verb instead"),
    (r'\bthe\s+\w+ment\s+(of|in|for|by|from)\b',
     "Volokh: nominalization 'the Xment of' — try a verb instead"),
    (r'\bthe\s+\w+ance\s+(of|in|for|by|from)\b',
     "Volokh: nominalization 'the Xance of' — try a verb instead"),
    (r'\bthe\s+\w+ence\s+(of|in|for|by|from)\b',
     "Volokh: nominalization 'the Xence of' — try a verb instead"),
]

# Unduly harsh criticism words — Volokh: use 'mistaken', 'unsound', 'erroneous'
_HARSH_WORDS = [
    (r'\b(idiotic|ridiculous|absurd|preposterous|nonsensical|ludicrous)\b',
     "Volokh: unduly harsh — use 'mistaken', 'unsound', or 'erroneous'"),
    (r'\b(fraud(ulent)?|dishonest|lie(s|d)?|liar)\b(?!\s+(prevention|detection|deterrence))',
     "Volokh: personal attack language — attack the argument, not the author"),
]

# "Arguably" without argument — Volokh: state the argument or cut it
_EMPTY_QUALIFIERS = [
    (r'\barguably\b', "Volokh: 'arguably' — give the argument; 'arguably' without argument proves nothing"),
    (r'\braises?\s+(serious\s+)?(constitutional|legal|significant|important|grave)\s+(concerns?|questions?|issues?)\b',
     "Volokh: 'raises X concerns' — not an argument; explain why it's unconstitutional/unsound"),
    (r'\b(troubling|troublesome|problematic|concerning)\b(?!\s+because)',
     "Volokh: 'troubling/problematic' without 'because' — explain the specific problem"),
]

# Legal doublets — Volokh: use one word unless phrase has specific legal significance
_DOUBLETS = [
    (r'\bany\s+and\s+all\b', "Volokh: 'any and all' — legal doublet; use one word"),
    (r'\bnull\s+and\s+void\b', "Volokh: 'null and void' — legal doublet; use 'void'"),
    (r'\bfull\s+and\s+complete\b', "Volokh: 'full and complete' — legal doublet; use one word"),
    (r'\btrue\s+and\s+correct\b', "Volokh: 'true and correct' — legal doublet; use one word"),
]

# Unnecessary introductory clauses
_INTRO_CLAUSES = [
    (r'\bit\s+(should|must|need)\s+be\s+(mentioned|noted|emphasized|stressed)\s+that\b',
     "Volokh: 'it should be mentioned that' — delete and state the point directly"),
    (r'\bin\s+having\s+\w+ed\b', "Volokh: introductory clause 'In having X-ed' — delete"),
    (r'\bit\s+is\s+(important|necessary|essential|critical)\s+to\s+(note|remember|recognize|acknowledge)\b',
     "Volokh: 'it is important to note' — delete; make the sentence do the work"),
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

    all_patterns = (
        _LEGALESE + _LONG_SYNONYMS + _NOMINALIZATION +
        _HARSH_WORDS + _EMPTY_QUALIFIERS + _DOUBLETS + _INTRO_CLAUSES
    )

    for path in draft_files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = path.relative_to(cwd)
        for i, line in enumerate(text.splitlines(), start=1):
            if line.strip().startswith("#"):
                continue  # skip headings
            for pattern, label in all_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: {label}")
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
