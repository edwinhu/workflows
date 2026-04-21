#!/usr/bin/env -S uv run python3
"""Constraint: ds-error-handling — pipeline errors must be loud, not silent."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-error-handling"
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
            stripped = line.strip()

            # except: pass (bare except with pass — silent swallow)
            if re.match(r'^except\s*(Exception\s*)?\s*:', stripped):
                # Check if next non-empty line is just 'pass'
                for j in range(i, min(len(lines), i + 3)):
                    next_stripped = lines[j].strip()
                    if next_stripped == "pass":
                        violations.append(
                            f"{path.relative_to(cwd)}:{i}: except:/pass — "
                            "never catch-and-ignore; log and re-raise"
                        )
                        break
                    elif next_stripped and next_stripped != "#":
                        break

            # errors='coerce' without logging nearby
            if re.search(r'errors\s*=\s*["\']coerce["\']', line):
                start = max(0, i - 4)
                end = min(len(lines), i + 4)
                context_block = "\n".join(lines[start:end])
                if not re.search(r'\bprint\s*\(|logging\.\w+|logger\.\w+', context_block):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: errors='coerce' without logging — "
                        "log count and sample of coerced values"
                    )

            # .dropna() without nearby print logging count
            if re.search(r'\.dropna\s*\(', line):
                start = max(0, i - 4)
                end = min(len(lines), i + 4)
                context_block = "\n".join(lines[start:end])
                if not re.search(r'\bprint\s*\(|logging\.\w+|logger\.\w+', context_block):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: .dropna() without logging — "
                        "log how many rows dropped and why"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
