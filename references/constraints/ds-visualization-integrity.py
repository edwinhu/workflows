#!/usr/bin/env python3
"""Constraint: ds-visualization-integrity — charts must not mislead."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-visualization-integrity"
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
            # Dual y-axes: .twinx() creates a second y-axis with independent scale
            if re.search(r'\.twinx\s*\(\s*\)', line):
                violations.append(
                    f"{path.relative_to(cwd)}:{i}: .twinx() — dual y-axes manufacture visual "
                    "correlation; use separate panels instead"
                )

            # 3D plots distort proportions
            if re.search(r"projection\s*=\s*['\"]3d['\"]", line, re.IGNORECASE):
                violations.append(
                    f"{path.relative_to(cwd)}:{i}: 3D projection — depth distorts proportions; "
                    "use 2D always"
                )
            if re.search(r'from\s+mpl_toolkits\.mplot3d', line):
                violations.append(
                    f"{path.relative_to(cwd)}:{i}: mpl_toolkits.mplot3d import — "
                    "3D charts distort proportions; use 2D"
                )

            # Truncated y-axis: set_ylim(non_zero_lower, ...) where lower > 0
            m = re.search(r'\.set_ylim\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*,', line)
            if m:
                lower = float(m.group(1))
                if lower > 0:
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: set_ylim({lower}, ...) — truncated y-axis "
                        "exaggerates differences; start at 0 or label the break"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
