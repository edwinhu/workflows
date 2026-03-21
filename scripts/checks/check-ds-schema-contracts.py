#!/usr/bin/env python3
"""Check: ds-schema-contracts — verify data loading calls have nearby schema assertions.

Detects:
- pd.read_csv(, pd.read_parquet(, pd.read_sql( calls
- Missing assert statements referencing .columns or column name sets within 10 lines

Note: This is a heuristic check — it catches the most common pattern but not all cases.
"""
import json
import re
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

READ_PATTERNS = [
    re.compile(r'pd\.read_csv\('),
    re.compile(r'pd\.read_parquet\('),
    re.compile(r'pd\.read_sql\('),
]

SCHEMA_PATTERNS = [
    re.compile(r'assert\b.*\.columns'),
    re.compile(r'assert\b.*\{.*\}.*\.(issubset|issuperset)'),
    re.compile(r'assert\b.*set\(.*columns'),
    re.compile(r'\.columns\.tolist\(\)\s*=='),
    re.compile(r'assert\b.*\bcolumns\b'),
]

violations = []


def check_source(source: str, filepath: str):
    """Check a Python source string for data loading without schema validation."""
    lines = source.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check if this line has a data loading call
        has_read = any(pat.search(line) for pat in READ_PATTERNS)
        if not has_read:
            continue

        # Look ahead up to 10 lines for schema assertion
        window = lines[i:min(i + 11, len(lines))]
        has_schema_check = any(
            pat.search(w) for w in window for pat in SCHEMA_PATTERNS
        )

        if not has_schema_check:
            lineno = i + 1
            call = line.strip()[:80]
            violations.append(
                f"FAIL: {filepath}:{lineno} — data loading without schema assertion within 10 lines: {call}"
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
        print("PASS: ds-schema-contracts — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-schema-contracts — {len(files)} files checked, all data loading calls have schema assertions")
    sys.exit(0)


if __name__ == '__main__':
    main()
