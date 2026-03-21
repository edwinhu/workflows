#!/usr/bin/env python3
"""Check: ds-visualization-integrity — detect potentially misleading visualization patterns.

Detects (as warnings — potential issues, not definitive violations):
- set_ylim / set_xlim with non-zero lower bound (potential truncated axis)
- twinx() calls (dual axis — potential misleading)
- projection='3d' or Axes3D usage (3D chart distortion)
"""
import json
import re
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

# Patterns
YLIM_PATTERN = re.compile(r'\.set_ylim\s*\(\s*(-?[\d.]+)')
XLIM_PATTERN = re.compile(r'\.set_xlim\s*\(\s*(-?[\d.]+)')
TWINX_PATTERN = re.compile(r'\.twinx\s*\(')
PROJECTION_3D = re.compile(r"projection\s*=\s*['\"]3d['\"]")
AXES3D_PATTERN = re.compile(r'\bAxes3D\b')

violations = []


def check_source(source: str, filepath: str):
    """Check a Python source string for misleading visualization patterns."""
    lines = source.splitlines()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check set_ylim with non-zero lower bound
        match = YLIM_PATTERN.search(line)
        if match:
            lower = float(match.group(1))
            if lower > 0:
                violations.append(
                    f"WARNING: {filepath}:{i} — potential truncated y-axis: set_ylim lower bound is {lower}, not 0"
                )

        # Check set_xlim with non-zero lower bound
        match = XLIM_PATTERN.search(line)
        if match:
            lower = float(match.group(1))
            if lower > 0:
                violations.append(
                    f"WARNING: {filepath}:{i} — potential truncated x-axis: set_xlim lower bound is {lower}, not 0"
                )

        # Check twinx() — dual axis
        if TWINX_PATTERN.search(line):
            violations.append(
                f"WARNING: {filepath}:{i} — potential misleading dual axis: twinx() suggests correlation between different scales"
            )

        # Check 3D projection
        if PROJECTION_3D.search(line):
            violations.append(
                f"WARNING: {filepath}:{i} — potential 3D distortion: projection='3d' distorts proportions"
            )

        # Check Axes3D import/usage
        if AXES3D_PATTERN.search(line):
            violations.append(
                f"WARNING: {filepath}:{i} — potential 3D distortion: Axes3D distorts proportions"
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
        print("PASS: ds-visualization-integrity — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        print(f"\nNote: These are potential issues, not definitive violations. Review each in context.")
        sys.exit(1)

    print(f"PASS: ds-visualization-integrity — {len(files)} files checked, no potentially misleading patterns found")
    sys.exit(0)


if __name__ == '__main__':
    main()
