#!/usr/bin/env -S uv run python3
"""Constraint: ai-puffery — detect puffery and exaggeration phrases in draft text."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # _writing: the contract, prose_extract
from _writing import main, prose, prose_extract
from _writing import rel as _rel

CONSTRAINT = "wikipedia-puffery-and-exaggeration"
SEVERITY = "soft"  # warn — puffery phrases can appear in legitimate academic prose
AUDIT_SYSTEM = "wikipedia-puffery"  # prose-audit.py's system for these tables (default: the directory's style guide)
AUDIT_ORDER = 2  # prose-audit.py's load order among declared systems: the first names a span tied tables match

# ABSORBED writing-ai-smell-puffery (v5.127.0). That constraint and this table were the same
# system built twice — 63 patterns against 75, overlapping on puffery, promotional superlatives,
# filler transitions and artifacts — and running both is what reported one phrase two or three
# times under three labels. Its duplicates were dropped (`rich tapestry` → wikipedia-promotional,
# `stands as a`/`it is important to note` → already here and there, respectively) and the entries
# it had that this table lacked were merged in below, marked `[ex-ai-smell]`.
_PUFFERY_PATTERNS = [
    # `stands as` narrowed off the bare copula: `serves as` is REJECTED in tics.yaml at 786 hits /
    # 141.35/M, the highest-rate rejection in the file after the caveat openers, and the bare
    # `stands as` carried it. What the gated table ships is `stands as a testament to`
    # (scored-tics-patterns.py), and the `is a testament/reminder` line below covers the rest.
    (r'\bstands\s+as\s+a\s+(testament|reminder|beacon|symbol)\b', "puffery: 'stands as a testament'"),
    (r'\bis\s+a\s+(testament|reminder)\b', "puffery: 'is a testament/reminder'"),
    # `plays a crucial/vital/key role` (bare) DELETED — tics.yaml rejects it at 122 hits / 21.94/M.
    # Only the narrowed `plays a pivotal role in shaping` passed the gate, and it ships from there.
    # [ex-ai-smell] The de-hedging siblings of 'it is important to note', which was itself deleted
    # from wikipedia-promotional-language.py as corpus-rejected. These two are not: they carry no
    # `rejected:` entry and stay until one is measured.
    (r'\bit\s+is\s+worth\s+noting\b', "puffery: 'it is worth noting'"),
    (r'\bit\s+should\s+be\s+noted\s+that\b', "puffery: 'it should be noted that'"),
    # `delves into` (bare) DELETED. The comment that stood here named the tension — the corpus gate
    # REJECTED the bare form at 65 hits / 11.69/M and kept only `delve into the intricacies of` —
    # and elected to keep firing anyway, with the escape clause "if it false-positives in practice,
    # delete this line rather than weakening the scored table." It does; this is that deletion.
    # `underscores/highlights the importance` narrowed: `underscores the importance` is REJECTED in
    # tics.yaml at 5.93/M. The other three verbs carry no such measurement.
    (r'\b(highlights?|emphasizes?|showcases?)\s+(its|the)\s+(importance|significance)\b',
     "puffery: 'highlights its importance'"),
    (r'\b(reflects?|symboliz(es?|ing))\s+(the\s+)?(broader|wider)\b', "puffery: 'reflects broader'"),
    (r'\b(enduring|lasting)\s+(impact|legacy|influence|contribution)\b', "puffery: 'enduring/lasting impact'"),
    (r'\bindelible\s+(mark|impact|legacy)\b', "puffery: 'indelible mark'"),
    (r'\bdeeply\s+rooted\b', "puffery: 'deeply rooted'"),
    (r'\bsteadfast\s+(dedication|commitment|resolve)\b', "puffery: 'steadfast dedication'"),
    (r'\bprofound\s+(heritage|legacy|impact|significance|influence)\b', "puffery: 'profound X'"),
    (r'\b(key|pivotal|critical)\s+turning\s+point\b', "puffery: 'key turning point'"),
    (r'\b(ensuring|highlighting|emphasizing|underscoring|showcasing)\s+\w', "puffery: dangling -ing analysis phrase"),
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = context["files"]  # the prose files handed in, wherever they lie

    if not draft_files:
        return violations  # No drafts yet — skip

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        for i, line in line_iter:
            for pattern, label in _PUFFERY_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(
                        f"{_rel(path, cwd)}:{i}: {label} — remove or rewrite with specific evidence"
                    )
    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, prose))
