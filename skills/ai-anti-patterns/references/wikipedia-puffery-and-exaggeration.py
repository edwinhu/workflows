#!/usr/bin/env -S uv run python3
"""Constraint: ai-puffery — detect puffery and exaggeration phrases in draft text."""
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

CONSTRAINT = "wikipedia-puffery-and-exaggeration"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"  # warn — puffery phrases can appear in legitimate academic prose

_PUFFERY_PATTERNS = [
    (r'\b(stands|serves)\s+as\b', "puffery: 'stands/serves as'"),
    (r'\bis\s+a\s+(testament|reminder)\b', "puffery: 'is a testament/reminder'"),
    (r'\bplays\s+a\s+(vital|significant|crucial|pivotal|key)\s+role\b', "puffery: 'plays a X role'"),
    (r'\b(underscores?|highlights?|emphasizes?|showcases?)\s+(its|the)\s+(importance|significance)\b',
     "puffery: 'underscores its importance'"),
    (r'\b(reflects?|symboliz(es?|ing))\s+(the\s+)?(broader|wider)\b', "puffery: 'reflects broader'"),
    (r'\b(enduring|lasting)\s+(impact|legacy|influence|contribution)\b', "puffery: 'enduring/lasting impact'"),
    (r'\bindelible\s+(mark|impact|legacy)\b', "puffery: 'indelible mark'"),
    (r'\bdeeply\s+rooted\b', "puffery: 'deeply rooted'"),
    (r'\bsteadfast\s+(dedication|commitment|resolve)\b', "puffery: 'steadfast dedication'"),
    (r'\bprofound\s+(heritage|legacy|impact|significance|influence)\b', "puffery: 'profound X'"),
    (r'\b(key|pivotal|critical)\s+turning\s+point\b', "puffery: 'key turning point'"),
    (r'\b(ensuring|highlighting|emphasizing|underscoring|showcasing)\s+\w', "puffery: dangling -ing analysis phrase"),
]


def _find_draft_files(cwd):
    """Find draft and outline files (.md + .docx) under drafts/ and outlines/.
    Delegates to the shared discovery helper."""
    return prose_extract.find_draft_files(cwd)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = _find_draft_files(cwd)

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
                        f"{path.relative_to(cwd)}:{i}: {label} — remove or rewrite with specific evidence"
                    )
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
