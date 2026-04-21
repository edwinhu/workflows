#!/usr/bin/env -S uv run python3
"""Constraint check: detect monolithic constraint files.

A constraint file is monolithic if it has 3+ ### headings describing
different rules, or lives outside references/constraints/ while containing
constraint-like content.

This check scans:
1. references/constraints/*.md — flag any file with 3+ ### rule headings
2. references/*.md — flag files that look like bundled constraints
"""
from __future__ import annotations

import re
from pathlib import Path


def _count_rule_headings(text: str) -> int:
    """Count ### headings that look like separate rules, not structural sections.

    Structural headings (examples, rationalization, red flags, etc.) are
    sub-sections of a single rule. Rule headings describe different behaviors.
    """
    structural_patterns = re.compile(
        r"^###\s+(correct|incorrect|example|red flag|rationalization|"
        r"rationale|protocol|rule|why|when|how|the )",
        re.IGNORECASE,
    )
    h3_lines = re.findall(r"^###\s+.+", text, re.MULTILINE)
    return sum(1 for h in h3_lines if not structural_patterns.match(h))


def check(context: dict) -> list[dict]:
    """Run the atomic-constraints check. Returns list of violations."""
    cwd = Path(context.get("cwd", ".")).resolve()

    # Find repo root (look for .claude-plugin/)
    repo_root = cwd
    for _ in range(10):
        if (repo_root / ".claude-plugin").is_dir():
            break
        parent = repo_root.parent
        if parent == repo_root:
            return []
        repo_root = parent
    else:
        return []

    violations = []
    constraints_dir = repo_root / "references" / "constraints"
    references_dir = repo_root / "references"

    # Check 1: Monolithic files inside constraints/ (3+ rule headings)
    if constraints_dir.is_dir():
        for md_path in sorted(constraints_dir.glob("*.md")):
            # Exception: this file itself uses ### for structure
            if md_path.stem == "atomic-constraints":
                continue
            text = md_path.read_text()
            rule_count = _count_rule_headings(text)
            if rule_count >= 3:
                violations.append({
                    "file": str(md_path.relative_to(repo_root)),
                    "check": "ATOMIC-CONSTRAINTS",
                    "severity": "warning",
                    "found": f"{rule_count} rule-level ### headings",
                    "expected": "1-2 rule headings (one rule per file)",
                    "context": "File may be a monolith — consider splitting into separate constraint files",
                })

    # Check 2: Constraint-like files outside constraints/ directory
    if references_dir.is_dir():
        for md_path in sorted(references_dir.glob("*.md")):
            # Skip if it's in a subdirectory (constraints/ etc.)
            if md_path.parent != references_dir:
                continue

            stem = md_path.stem
            # Flag plural "-constraints" or "-conventions" files
            if stem.endswith("-constraints") or stem.endswith("-conventions"):
                text = md_path.read_text()
                h3_headings = re.findall(r"^###\s+", text, re.MULTILINE)
                if len(h3_headings) >= 3:
                    violations.append({
                        "file": str(md_path.relative_to(repo_root)),
                        "check": "ATOMIC-CONSTRAINTS",
                        "severity": "error",
                        "found": f"Monolithic constraint file with {len(h3_headings)} sections",
                        "expected": "Atomic files in references/constraints/ (one .md per rule)",
                        "context": f"Split into individual files in references/constraints/",
                    })

    return violations


if __name__ == "__main__":
    import json
    import sys

    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        print(json.dumps(results, indent=2))
        sys.exit(1)
    else:
        print("No monolithic constraint files detected.")
        sys.exit(0)
