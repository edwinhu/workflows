#!/usr/bin/env python3
"""Check: ds-determinism — verify no non-deterministic patterns in Python code.

Detects:
- .sample( without random_state= parameter
- np.random. calls without a preceding np.random.seed(
- random. stdlib calls without random.seed(
"""
import ast
import json
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}

violations = []


def check_source(source: str, filepath: str):
    """Check a Python source string for non-deterministic patterns."""
    lines = source.splitlines()

    # --- Regex-style line checks for .sample( without random_state ---
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check .sample( without random_state=
        if '.sample(' in line and 'random_state' not in line:
            # Could be a multi-line call — check next few lines too
            context = '\n'.join(lines[i - 1:min(i + 3, len(lines))])
            if 'random_state' not in context:
                violations.append(f"FAIL: {filepath}:{i} — .sample() without random_state=")

    # --- AST checks for random module usage ---
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return

    # Collect lines that have np.random.seed or random.seed
    seed_lines = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            func_str = _attr_str(node.func)
            if func_str and ('np.random.seed' in func_str or 'numpy.random.seed' in func_str
                             or func_str == 'random.seed'):
                seed_lines.add(node.lineno)

    # Check np.random.* calls (excluding seed itself)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            func_str = _attr_str(node.func)
            if not func_str:
                continue

            if ('np.random.' in func_str or 'numpy.random.' in func_str) and 'seed' not in func_str:
                # Check if there's a seed call before this line
                has_seed = any(sl <= node.lineno for sl in seed_lines)
                if not has_seed:
                    violations.append(
                        f"FAIL: {filepath}:{node.lineno} — {func_str}() without preceding np.random.seed()")

            if func_str == 'random.randint' or func_str == 'random.choice' or func_str == 'random.random' \
                    or func_str == 'random.uniform' or func_str == 'random.shuffle' or func_str == 'random.sample' \
                    or func_str == 'random.randrange' or func_str == 'random.gauss':
                has_seed = any(sl <= node.lineno for sl in seed_lines)
                if not has_seed:
                    violations.append(
                        f"FAIL: {filepath}:{node.lineno} — {func_str}() without preceding random.seed()")


def _attr_str(node):
    """Reconstruct a dotted attribute string from an AST node."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return '.'.join(reversed(parts))
    return None


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
        print("PASS: ds-determinism — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_source(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-determinism — {len(files)} files checked, no non-deterministic patterns found")
    sys.exit(0)


if __name__ == '__main__':
    main()
