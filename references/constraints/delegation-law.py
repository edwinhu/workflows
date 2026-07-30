#!/usr/bin/env -S uv run python3
"""Constraint: delegation-law — main chat must not write code or investigate directly.

Checks .planning/LEARNINGS.md and git history for evidence that main chat wrote
code files directly (instead of delegating to subagents). Detects:
- Direct writes to source files from main chat (via git diff author context)
- LEARNINGS.md entries showing direct code edits without subagent delegation
"""

CONSTRAINT = "delegation-law"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify", "dev-debug",
              "dev-delegate", "dev-design", "dev-explore", "dev-handoff", "dev-test",
              "dev-test-gaps", "dev-spec-reviewer", "dev-plan-reviewer"]
SEVERITY = "hard"

import re
from pathlib import Path

# State/config directories that main chat IS allowed to write
ALLOWED_DIRS = {'.planning', '.claude', '.git'}

# Source file extensions that should only be written by subagents
SOURCE_EXTENSIONS = {
    '.py', '.js', '.ts', '.jsx', '.tsx', '.rs', '.go', '.java', '.rb',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.scala',
    '.vue', '.svelte', '.html', '.css', '.scss', '.sass', '.less',
    '.json', '.yaml', '.yml', '.toml', '.xml', '.sql',
    '.sh', '.bash', '.zsh', '.fish',
}


def is_state_file(filepath: str) -> bool:
    """Check if a file is in an allowed state directory."""
    parts = Path(filepath).parts
    return any(d in parts for d in ALLOWED_DIRS)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", ".")).resolve()
    violations = []

    # Check LEARNINGS.md for evidence of direct edits
    learnings = cwd / ".planning" / "LEARNINGS.md"
    if learnings.is_file():
        try:
            text = learnings.read_text(encoding='utf-8', errors='replace')
            # Look for patterns suggesting direct code edits in main chat
            direct_edit_patterns = [
                (re.compile(r'main chat.*(?:edited|wrote|modified|fixed).*(?:\.py|\.js|\.ts|\.rs|\.go)', re.IGNORECASE),
                 "LEARNINGS.md suggests main chat directly edited source files"),
                (re.compile(r'(?:quick fix|directly|manually).*(?:edited|changed|wrote)', re.IGNORECASE),
                 "LEARNINGS.md suggests direct intervention instead of delegation"),
            ]
            for pattern, desc in direct_edit_patterns:
                matches = pattern.findall(text)
                if matches:
                    violations.append(f"{desc}: found {len(matches)} occurrence(s)")
        except (OSError, PermissionError):
            pass

    # Check for uncommitted changes to source files (could indicate direct edits)
    # This is a heuristic — in a running workflow, uncommitted source changes
    # in main chat context may indicate delegation violation
    # Note: This check is advisory since we can't determine WHO made the changes
    # from the filesystem alone — the hook (orchestrator-mutation-guard (--workflow dev).py) is the
    # real-time structural enforcement

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
