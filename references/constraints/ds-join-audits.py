#!/usr/bin/env -S uv run python3
"""Constraint: ds-join-audits — every merge/join must produce diagnostic log."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-join-audits"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = [
        p for p in cwd.rglob("*.py")
        if not any(part in p.parts for part in [".planning", "scratch", "__pycache__", ".pixi"])
        and p.name != "check-all.py"
        and "references/constraints" not in str(p)
    ]

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = source.splitlines()
        for i, line in enumerate(lines, start=1):
            # Detect .merge( calls (DataFrame merge)
            if re.search(r'\.merge\s*\(', line) or re.search(r'\bpd\.merge\s*\(', line):
                # Check surrounding 5 lines before and after for print/logging
                start = max(0, i - 6)
                end = min(len(lines), i + 5)
                context_block = "\n".join(lines[start:end])
                if not re.search(r'\bprint\s*\(|logging\.\w+\s*\(|logger\.\w+\s*\(', context_block):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: .merge() without diagnostic print — "
                        "log row counts, match rates, key uniqueness"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
