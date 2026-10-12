#!/usr/bin/env -S uv run python3
"""Constraint: ai-communication-patterns — detect chatbot communication markers in draft text."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # _writing: the contract, prose_extract
from _writing import main, prose, prose_extract
from _writing import rel as _rel

CONSTRAINT = "wikipedia-communication-patterns"
SEVERITY = "hard"  # These should never appear in finished academic writing
AUDIT_SYSTEM = "wikipedia-communication"  # prose-audit.py's system for these tables (default: the directory's style guide)
AUDIT_ORDER = 6  # prose-audit.py's load order among declared systems: the first names a span tied tables match

_HARD_PATTERNS = [
    # AI identity leakage
    (r'\bas\s+an?\s+(AI|artificial intelligence|large language)\s+(language\s+)?model\b',
     "AI identity leak: 'as an AI language model'"),
    (r"\bI('m|\s+am)\s+(just\s+)?an?\s+(AI|language\s+model|chatbot)\b",
     "AI identity leak: 'I am an AI'"),
    # [ex-ai-smell] First-person refusal. Very unlikely in legal writing, which avoids "I" —
    # and unambiguous when it does appear. (writing-ai-smell-artifacts, absorbed v5.127.0.)
    (r'\bI\s+cannot\s+(provide|assist|help|generate|write)\b',
     "AI refusal leak: 'I cannot provide'"),
    # Chatbot closers / helpers. `email finds` came from writing-ai-smell-artifacts.
    (r'\bI\s+hope\s+(this\s+)?(helps?|clarifies?|answers?|email\s+finds)\b',
     "chatbot closer: 'I hope this helps'"),
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
    # `Of course` dropped from the alternation: tics.yaml rejects the caveat opener at 5,531 hits /
    # 386.94/M, and writing-general/SKILL.md vindicates it by name as the commonest such opener in
    # the corpus (523.7/M law, 299.9/M finance). It is where a caveat naturally goes.
    (r'^\s*(Certainly|Absolutely|Sure)[!,.]', "chatbot opener: 'Certainly!'"),
    (r"\bYou'?re\s+absolutely\s+right\b", "chatbot agreement: 'You're absolutely right'"),
    (r'\bhere\s+is\s+a\s+(detailed?|comprehensive|brief|quick)\b', "chatbot framing: 'here is a detailed'"),
    (r'\bmore\s+detailed?\s+breakdown\b', "chatbot offer: 'more detailed breakdown'"),
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = context["files"]  # the prose files handed in, wherever they lie

    if not draft_files:
        return violations

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = _rel(path, cwd)
        for i, line in line_iter:
            for pattern, label in _HARD_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: HARD — {label}")
            for pattern, label in _SOFT_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: WARN — {label}")
    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, prose))
