#!/usr/bin/env -S uv run python3
"""Constraint: ds-table-figure-pairing — every main result table needs a companion figure."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-table-figure-pairing"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"

TABLE_PATTERNS = [
    (r'GT\s*\(', "great_tables GT() table"),
    (r'from\s+great_tables\s+import', "great_tables import"),
    (r'summary_col\s*\(', "summary_col() regression table"),
    (r'Stargazer\s*\(', "Stargazer() regression table"),
    (r'\.as_latex\s*\(', ".as_latex() table export"),
    (r'\.to_latex\s*\(', ".to_latex() table export"),
    (r'esttab|estout|outreg', "Stata-style table export"),
]

FIGURE_PATTERNS = [
    r'Plot\s*\(',
    r'Plot\.plot\s*\(',
    r'from\s+pyobsplot\s+import',
    r'\.savefig\s*\(',
    r'plt\.savefig\s*\(',
    r'fig\.write_image\s*\(',
    r'fig\.write_html\s*\(',
    r'\.to_html\s*\(.*?fig',
    r'alt\.Chart\s*\(',
    r'px\.\w+\s*\(',
    r'sns\.\w+plot\s*\(',
    r'plt\.show\s*\(',
    r'\.plot\s*\(',
    r'errorbar\s*\(',
    r'coefplot',
]


def _has_figure(source: str) -> bool:
    for pat in FIGURE_PATTERNS:
        if re.search(pat, source):
            return True
    return False


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

        for pat, desc in TABLE_PATTERNS:
            matches = list(re.finditer(pat, source))
            if matches and not _has_figure(source):
                line_no = source[:matches[0].start()].count("\n") + 1
                violations.append(
                    f"{path.relative_to(cwd)}:{line_no}: {desc} without companion "
                    "figure in same file — every main result table needs a figure "
                    "(Hendershott rule, A4)"
                )
                break

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
