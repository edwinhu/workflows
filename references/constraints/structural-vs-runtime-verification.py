#!/usr/bin/env -S uv run python3
"""Constraint: structural-vs-runtime-verification — only runtime evidence counts as verification.

Checks .planning/LEARNINGS.md and .planning/VALIDATION.md for structural-only
verification claims (e.g., "code exists in file", "grep found the pattern")
without corresponding runtime evidence (test output, exit codes, etc.).

Detection: scan verification-related entries for structural-only language
without accompanying runtime evidence.
"""

CONSTRAINT = "structural-vs-runtime-verification"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify", "dev-debug",
              "dev-test", "dev-test-gaps"]
SEVERITY = "hard"

import re
from pathlib import Path


# Structural-only claims (weak evidence)
STRUCTURAL_PATTERNS = [
    re.compile(r'(?:code|function|class|test)\s+(?:exists|is defined|was created|was written)', re.IGNORECASE),
    re.compile(r'grep\s+(?:found|shows|confirms)', re.IGNORECASE),
    re.compile(r'(?:ast-grep|rg)\s+(?:found|shows|confirms)', re.IGNORECASE),
    re.compile(r'diff\s+shows\s+the\s+change', re.IGNORECASE),
    re.compile(r'implementation\s+looks\s+correct', re.IGNORECASE),
    re.compile(r'code\s+looks\s+(?:correct|good|right)', re.IGNORECASE),
]

# Runtime evidence (strong evidence) — presence of these near a structural claim is OK
RUNTIME_EVIDENCE_PATTERNS = [
    re.compile(r'(?:test|tests)\s+(?:pass|passed|passing|PASS|OK|SUCCESS)', re.IGNORECASE),
    re.compile(r'exit\s+code[:\s]*0', re.IGNORECASE),
    re.compile(r'(?:PASS|PASSED|OK|SUCCESS):\s+\d+', re.IGNORECASE),
    re.compile(r'\d+\s+(?:passed|tests?\s+passed)', re.IGNORECASE),
    re.compile(r'ran\s+(?:test|tests|command)', re.IGNORECASE),
    re.compile(r'output\s*(?:shows|confirms|displays)', re.IGNORECASE),
]


def has_nearby_runtime_evidence(text: str, match_pos: int, window: int = 500) -> bool:
    """Check if there's runtime evidence within a window of characters around the match."""
    start = max(0, match_pos - window)
    end = min(len(text), match_pos + window)
    context = text[start:end]
    return any(p.search(context) for p in RUNTIME_EVIDENCE_PATTERNS)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", ".")).resolve()
    violations = []

    files_to_check = [
        cwd / ".planning" / "LEARNINGS.md",
        cwd / ".planning" / "VALIDATION.md",
    ]

    for filepath in files_to_check:
        if not filepath.is_file():
            continue

        try:
            text = filepath.read_text(encoding='utf-8', errors='replace')
        except (OSError, PermissionError):
            continue

        for pattern in STRUCTURAL_PATTERNS:
            for match in pattern.finditer(text):
                if not has_nearby_runtime_evidence(text, match.start()):
                    line_num = text[:match.start()].count('\n') + 1
                    violations.append(
                        f"{filepath.name}:{line_num} — structural-only verification claim "
                        f"without nearby runtime evidence: '{match.group()[:60]}'"
                    )

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
