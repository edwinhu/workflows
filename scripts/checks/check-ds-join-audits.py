#!/usr/bin/env python3
"""Check: ds-join-audits — verify every .merge() call has diagnostic output nearby.

Detects .merge( calls without print(, logging., or similar diagnostics
within 5 lines before or after the merge.
"""
import json
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}
DIAGNOSTIC_MARKERS = ('print(', 'print (', 'logging.', 'logger.', 'log.info', 'log.warning', 'log.debug')

violations = []


def check_source(source: str, filepath: str):
    """Check that every .merge( has diagnostics within 5 lines."""
    lines = source.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue
        if '.merge(' not in line:
            continue

        # Look for diagnostics within 5 lines before and after
        window_start = max(0, i - 5)
        window_end = min(len(lines), i + 6)
        window = '\n'.join(lines[window_start:window_end])

        has_diagnostic = any(marker in window for marker in DIAGNOSTIC_MARKERS)
        if not has_diagnostic:
            violations.append(f"FAIL: {filepath}:{i + 1} — .merge() without diagnostic output within 5 lines")


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
        print("PASS: ds-join-audits — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-join-audits — {len(files)} files checked, all merges have diagnostic output")
    sys.exit(0)


if __name__ == '__main__':
    main()
