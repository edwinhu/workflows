#!/usr/bin/env python3
"""Check: ds-standard-error-spec — verify regression fits specify standard error type.

Detects:
- sm.OLS(...).fit() without cov_type= parameter
- smf.ols(...).fit() without cov_type= parameter
- sm.WLS(...).fit() without cov_type= parameter
- PanelOLS(...).fit() without cov_type= parameter
- PooledOLS(...).fit() without cov_type= parameter
- LinearRegression().fit() from sklearn (no SE correction available)
"""
import json
import re
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

# Patterns that create statsmodels regression objects
MODEL_PATTERNS = [
    re.compile(r'sm\.OLS\('),
    re.compile(r'smf\.ols\('),
    re.compile(r'sm\.WLS\('),
    re.compile(r'PanelOLS\('),
    re.compile(r'PooledOLS\('),
]

# sklearn pattern — separate because the fix is different
SKLEARN_PATTERN = re.compile(r'LinearRegression\(\)\.fit\(')

violations = []


def check_source(source: str, filepath: str):
    """Check a Python source string for regression fits without SE specification."""
    lines = source.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check for sklearn LinearRegression().fit() — always flag
        if SKLEARN_PATTERN.search(line):
            lineno = i + 1
            violations.append(
                f"FAIL: {filepath}:{lineno} — LinearRegression().fit() has no SE correction — use statsmodels with cov_type="
            )
            continue

        # Check for statsmodels model creation patterns
        has_model = any(pat.search(line) for pat in MODEL_PATTERNS)
        if not has_model:
            continue

        # Look for .fit() on the same line or within 5 lines below
        window = lines[i:min(i + 6, len(lines))]
        window_text = '\n'.join(window)

        # Check if .fit( appears in the window
        if '.fit(' not in window_text:
            continue

        # Check if cov_type= appears in the .fit() call context
        # Look at each line in the window that contains .fit(
        fit_found_without_cov = False
        fit_lineno = None
        for j, w in enumerate(window):
            if '.fit(' in w:
                # Check this line and a few lines after for cov_type in the same call
                fit_context = '\n'.join(window[j:min(j + 4, len(window))])
                if 'cov_type' not in fit_context:
                    fit_found_without_cov = True
                    fit_lineno = i + j + 1
                break

        if fit_found_without_cov:
            model_call = stripped[:80]
            violations.append(
                f"FAIL: {filepath}:{fit_lineno} — .fit() without cov_type= parameter (model at line {i + 1}: {model_call})"
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
        print("PASS: ds-standard-error-spec — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-standard-error-spec — {len(files)} files checked, all regression fits specify cov_type")
    sys.exit(0)


if __name__ == '__main__':
    main()
