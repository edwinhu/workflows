#!/usr/bin/env python3
"""Check: ds-idempotency — verify no non-idempotent patterns in Python code.

Detects:
- if_exists='append' or if_exists="append"
- File open with mode='a' or open(... 'a')
"""
import ast
import json
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

violations = []


def check_source(source: str, filepath: str):
    """Check for non-idempotent patterns."""
    lines = source.splitlines()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check for if_exists='append' or if_exists="append"
        if "if_exists='append'" in line or 'if_exists="append"' in line:
            violations.append(f"FAIL: {filepath}:{i} — if_exists='append' is non-idempotent, use 'replace' or deduplicate")

    # AST check for open() with append mode
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        # Check open(..., 'a') or open(..., mode='a')
        func_name = None
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr

        if func_name != 'open':
            continue

        # Check positional arg (2nd arg is mode)
        if len(node.args) >= 2:
            mode_arg = node.args[1]
            if isinstance(mode_arg, ast.Constant) and isinstance(mode_arg.value, str) and 'a' in mode_arg.value:
                violations.append(
                    f"FAIL: {filepath}:{node.lineno} — open() with append mode is non-idempotent, use write mode")

        # Check keyword arg mode='a'
        for kw in node.keywords:
            if kw.arg == 'mode' and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str) and 'a' in kw.value.value:
                violations.append(
                    f"FAIL: {filepath}:{node.lineno} — open() with mode='a' is non-idempotent, use write mode")


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
        print("PASS: ds-idempotency — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-idempotency — {len(files)} files checked, no non-idempotent patterns found")
    sys.exit(0)


if __name__ == '__main__':
    main()
