#!/usr/bin/env -S uv run python3
"""Constraint: verification-vs-investigation — running tests is verification, reading code is investigation.

Checks .planning/LEARNINGS.md for evidence that the main chat performed
investigation actions (reading source code, grepping project files, running
docker exec, etc.) when it should have delegated to subagents.

Detection: scan LEARNINGS.md for patterns like "read source", "grep", "docker exec"
in main-chat context (outside of subagent blocks).
"""

CONSTRAINT = "verification-vs-investigation"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify", "dev-debug",
              "dev-delegate", "dev-test", "dev-test-gaps"]
SEVERITY = "hard"

import re
from pathlib import Path


# Patterns that indicate investigation (not verification) by main chat
INVESTIGATION_PATTERNS = [
    (re.compile(r'main chat.*(?:grep|rg|read|glob).*(?:source|src/|lib/|app/)', re.IGNORECASE),
     "Main chat performed investigation (reading/grepping source code)"),
    (re.compile(r'main chat.*docker exec', re.IGNORECASE),
     "Main chat performed operational investigation (docker exec)"),
    (re.compile(r'main chat.*(?:curl|wget).*(?:localhost|127\.0\.0\.1)', re.IGNORECASE),
     "Main chat performed operational investigation (HTTP requests)"),
    (re.compile(r'main chat.*(?:sqlite3|psql|mysql)', re.IGNORECASE),
     "Main chat performed operational investigation (database queries)"),
]

# Patterns that indicate proper verification
VERIFICATION_PATTERNS = [
    re.compile(r'(?:pytest|vitest|jest|npm test|cargo test|meson test).*(?:pass|PASS|OK)', re.IGNORECASE),
    re.compile(r'git (?:status|log|diff)', re.IGNORECASE),
    re.compile(r'exit code[:\s]*0', re.IGNORECASE),
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", ".")).resolve()
    violations = []

    learnings = cwd / ".planning" / "LEARNINGS.md"
    if not learnings.is_file():
        # No LEARNINGS.md = nothing to check (not a violation itself)
        return violations

    try:
        text = learnings.read_text(encoding='utf-8', errors='replace')
    except (OSError, PermissionError):
        return violations

    for pattern, desc in INVESTIGATION_PATTERNS:
        matches = pattern.findall(text)
        if matches:
            violations.append(f"{desc}: found {len(matches)} occurrence(s) in LEARNINGS.md")

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
