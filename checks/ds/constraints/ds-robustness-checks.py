#!/usr/bin/env -S uv run python3
"""Constraint: ds-robustness-checks — regression code must have robustness indicators."""
import json
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main

CONSTRAINT = "ds-robustness-checks"
SEVERITY = "hard"

REGRESSION_PATTERNS = [
    r'sm\.OLS\(',
    r'smf\.ols\(',
    r'PanelOLS\(',
    r'sm\.WLS\(',
    r'sm\.Logit\(',
    r'sm\.Probit\(',
]

ROBUSTNESS_INDICATORS = [
    r'(?:from|import)\s+(?:specr|specification_curve)',
    r'placebo',
    r'bootstrap',
    r'leave.*out',
    r'robust',
    r'sensitivity',
    r'subsample',
    r'winsor',
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []

    # the runner hands the files; none is pruned here
    for path in sorted(context["files"]):
        if path.suffix == '.py':
            source = path.read_text(encoding='utf-8', errors='replace')
        elif path.suffix == '.ipynb':
            try:
                nb = json.loads(path.read_text(encoding='utf-8'))
                cells = nb.get('cells', [])
                source = '\n'.join(
                    ''.join(c.get('source', []))
                    for c in cells if c.get('cell_type') == 'code'
                )
            except (json.JSONDecodeError, KeyError):
                continue
        else:
            continue

        if not source.strip():
            continue

        lines = source.splitlines()
        regression_lines = []
        for i, line in enumerate(lines):
            if line.strip().startswith('#'):
                continue
            for pattern in REGRESSION_PATTERNS:
                if re.search(pattern, line):
                    regression_lines.append(i)
                    break

        if not regression_lines:
            continue

        # Check for robustness indicators anywhere in the file
        has_robustness = False
        for indicator in ROBUSTNESS_INDICATORS:
            if re.search(indicator, source, re.IGNORECASE):
                has_robustness = True
                break

        if not has_robustness:
            fit_calls = re.findall(r'\.fit\(', source)
            if len(fit_calls) >= 2:
                has_robustness = True

        if not has_robustness:
            first_reg = regression_lines[0] + 1
            violations.append(
                f"{path}:{first_reg} — regression code without robustness indicators "
                f"(no placebo tests, bootstrap, specification curves, sensitivity checks, "
                f"or multiple specifications)"
            )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix in (".py", ".ipynb"), kind=".py or .ipynb file"))
