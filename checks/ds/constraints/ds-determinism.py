#!/usr/bin/env -S uv run python3
"""Constraint: ds-determinism — every pipeline step must be deterministic."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main, rel

CONSTRAINT = "ds-determinism"
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = context["files"]  # the runner hands the files; none is pruned here

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = source.splitlines()
        for i, line in enumerate(lines, start=1):
            # A sample must be SEEDED; the rule is about reproducibility, not about one
            # library's spelling. Three spellings satisfy it and all three were findings here
            # until 2026-09-16:
            #   random_state=   pandas
            #   seed=           polars
            #   random.seed(N)  the stdlib, which seeds the module rather than the call, so it
            #                   is looked for ABOVE the sample as well as beside it
            # Recognising them is not a loosening: all four flagged calls WERE deterministic,
            # and a rule that reports a seeded sample as unseeded is simply wrong.
            if re.search(r'\.sample\s*\(', line):
                # the call may span lines; a module-level seed sits above it
                context_lines = "\n".join(lines[max(0, i - 4):min(len(lines), i + 3)])
                if not re.search(r'\brandom_state\s*=|\bseed\s*=|\brandom\.seed\s*\(',
                                 context_lines):
                    violations.append(
                        f"{rel(path, cwd)}:{i}: .sample() without random_state — non-deterministic"
                    )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".py"))
