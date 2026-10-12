#!/usr/bin/env -S uv run python3
"""Constraint: ds-error-handling — pipeline errors must be loud, not silent."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main, rel
from _ds_logging import declared_helpers, reports_operation, statement_text  # noqa: E402

CONSTRAINT = "ds-error-handling"
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    helpers = declared_helpers(cwd)

    py_files = context["files"]  # the runner hands the files; none is pruned here

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
                            f"{rel(path, cwd)}:{i}: except:/pass — "
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
                # The log must report THIS coercion: a quantity linked by a name from the
                # coercing line. A neighbouring print says nothing about what was coerced.
                if not reports_operation(context_block, statement_text(lines, i - 1), helpers):
                    violations.append(
                        f"{rel(path, cwd)}:{i}: errors='coerce' without logging — "
                        "log count and sample of coerced values"
                    )

            # .dropna() without nearby print logging count
            if re.search(r'\.dropna\s*\(', line):
                start = max(0, i - 4)
                end = min(len(lines), i + 4)
                context_block = "\n".join(lines[start:end])
                # The log must report THIS drop: a row-count quantity linked by a name from
                # the dropping line. "How many rows dropped" is the whole point of the rule.
                if not reports_operation(context_block, statement_text(lines, i - 1), helpers):
                    violations.append(
                        f"{rel(path, cwd)}:{i}: .dropna() without logging — "
                        "log how many rows dropped and why"
                    )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".py"))
