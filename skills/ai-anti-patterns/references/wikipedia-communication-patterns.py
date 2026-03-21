#!/usr/bin/env python3
"""Constraint: ai-communication-patterns — detect chatbot communication markers in draft text."""
import re
import sys
from pathlib import Path

CONSTRAINT = "wikipedia-communication-patterns"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "hard"  # These should never appear in finished academic writing

_HARD_PATTERNS = [
    # AI identity leakage
    (r'\bas\s+an?\s+(AI|artificial intelligence|large language)\s+(language\s+)?model\b',
     "AI identity leak: 'as an AI language model'"),
    (r"\bI('m|\s+am)\s+(just\s+)?an?\s+(AI|language\s+model|chatbot)\b",
     "AI identity leak: 'I am an AI'"),
    # Chatbot closers / helpers
    (r'\bI\s+hope\s+(this\s+)?(helps?|clarifies?|answers?)\b', "chatbot closer: 'I hope this helps'"),
    (r'\blet\s+me\s+know\s+(if\s+(you\s+)?(have|need)|how)\b', "chatbot closer: 'let me know if'"),
    (r'\bis\s+there\s+(anything|something)\s+(else|more)\s+(I\s+can|you\s+(need|want))\b',
     "chatbot closer: 'is there anything else I can help with'"),
    (r'\b(would\s+you\s+like\s+(me\s+to|a\s+more))\b', "chatbot prompt: 'would you like me to'"),
    (r'\bfeel\s+free\s+to\s+(ask|reach\s+out|contact)\b', "chatbot closer: 'feel free to ask'"),
    # Knowledge cutoff disclaimers
    (r'\b(as\s+of\s+my\s+(last\s+)?(knowledge|training)\s+(update|cutoff|date))\b',
     "AI cutoff disclaimer: 'as of my last knowledge update'"),
    (r'\b(up\s+to\s+my\s+(last|most\s+recent)\s+(training|knowledge))\b',
     "AI cutoff disclaimer: 'up to my last training'"),
    (r'\b(while\s+specific\s+(details?|information)\s+(is|are)\s+(limited|scarce|unavailable))\b',
     "AI evasion: 'while specific details are limited'"),
    (r'\b(not\s+(widely\s+)?(available|documented|disclosed|published))\b',
     "AI evasion: 'not widely available/documented'"),
    (r'\b(based\s+on\s+(available|the\s+available)\s+(information|data|sources))\b',
     "AI hedge: 'based on available information'"),
    # Email/letter formatting that bleeds into prose
    (r'^Subject:\s+\S', "template artifact: email Subject: line in prose"),
]

_SOFT_PATTERNS = [
    # Collaborative communication
    (r'^\s*(Certainly|Of\s+course|Absolutely|Sure)[!,.]', "chatbot opener: 'Certainly!'"),
    (r"\bYou'?re\s+absolutely\s+right\b", "chatbot agreement: 'You're absolutely right'"),
    (r'\bhere\s+is\s+a\s+(detailed?|comprehensive|brief|quick)\b', "chatbot framing: 'here is a detailed'"),
    (r'\bmore\s+detailed?\s+breakdown\b', "chatbot offer: 'more detailed breakdown'"),
]


def _find_draft_files(cwd):
    paths = []
    for subdir in ("drafts", "outlines"):
        d = cwd / subdir
        if d.is_dir():
            paths.extend(d.glob("*.md"))
    planning = cwd / ".planning"
    if planning.is_dir():
        for f in ("PRECIS.md", "OUTLINE.md"):
            p = planning / f
            if p.exists():
                paths.append(p)
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
            for pattern, label in _HARD_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: HARD — {label}")
            for pattern, label in _SOFT_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: WARN — {label}")
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
