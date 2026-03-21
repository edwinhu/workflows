#!/usr/bin/env python3
"""Check: ds-robustness-checks — verify regression code has robustness indicators.

Scans Python files for regression model fits (OLS, WLS, Logit, Probit, PanelOLS).
If found, checks within 50 lines for robustness indicators:
- specr / specification_curve imports
- placebo in variable names or comments
- bootstrap in code
- leave.*out pattern
- robust / sensitivity in function/variable names
- Multiple .fit() calls (suggesting multiple specifications)
- subsample / winsor patterns
"""
import json
import re
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

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

violations = []


def check_source(source: str, filepath: str):
    """Check a Python source string for regressions without robustness indicators."""
    lines = source.splitlines()

    # Find lines with regression model fits
    regression_lines = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue
        for pattern in REGRESSION_PATTERNS:
            if re.search(pattern, line):
                regression_lines.append(i)
                break

    if not regression_lines:
        return  # No regression code — nothing to check

    # Check within 50 lines of each regression for robustness indicators
    for reg_line in regression_lines:
        start = max(0, reg_line - 50)
        end = min(len(lines), reg_line + 51)
        context = '\n'.join(lines[start:end])

        for indicator in ROBUSTNESS_INDICATORS:
            if re.search(indicator, context, re.IGNORECASE):
                return  # Found at least one robustness indicator near this regression

    # Also check the full file for robustness indicators and multiple .fit() calls
    full_text = '\n'.join(lines)

    for indicator in ROBUSTNESS_INDICATORS:
        if re.search(indicator, full_text, re.IGNORECASE):
            return  # Found a robustness indicator somewhere in the file

    # Check for multiple .fit() calls (suggesting multiple specifications)
    fit_calls = re.findall(r'\.fit\(', full_text)
    if len(fit_calls) >= 2:
        return  # Multiple .fit() calls suggest multiple specifications

    # Regression code found without any robustness indicators
    first_reg = regression_lines[0] + 1  # 1-indexed
    violations.append(
        f"FAIL: {filepath}:{first_reg} — regression code found without robustness indicators "
        f"(no placebo tests, bootstrap, specification curves, sensitivity checks, or multiple specifications)"
    )


def extract_notebook_cells(path: Path) -> str:
    """Extract code cells from a .ipynb file."""
    try:
        nb = json.loads(path.read_text(encoding='utf-8'))
        cells = nb.get('cells', [])
        sources = []
        for cell in cells:
            if cell.get('cell_type') == 'code':
                sources.append(''.join(cell.get('source', [])))
        return '\n'.join(sources)
    except (json.JSONDecodeError, KeyError):
        return ''


def find_python_files(root: Path):
    """Find .py and .ipynb files, skipping excluded directories."""
    for path in sorted(root.rglob('*')):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix == '.py':
            yield path, path.read_text(encoding='utf-8', errors='replace')
        elif path.suffix == '.ipynb':
            yield path, extract_notebook_cells(path)


def main():
    project_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    project_dir = project_dir.resolve()

    files = list(find_python_files(project_dir))
    if not files:
        print("PASS: ds-robustness-checks — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-robustness-checks — {len(files)} files checked, robustness indicators present where needed")
    sys.exit(0)


if __name__ == '__main__':
    main()
