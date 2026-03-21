#!/usr/bin/env python3
"""Check: ds-error-handling — verify no silent error handling patterns in Python code.

Detects:
- Bare except: pass or except Exception: pass (via AST)
- errors='coerce' without print/logging within 5 lines
- .dropna() without print/logging/len within 3 lines before
"""
import ast
import json
import sys
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages'}
DIAGNOSTIC_MARKERS = ('print(', 'print (', 'logging.', 'logger.', 'log.info', 'log.warning', 'log.debug')

violations = []


def _is_pass_body(body):
    """Check if an AST body is just `pass` (possibly with a comment/docstring)."""
    stmts = [s for s in body if not isinstance(s, ast.Expr) or not isinstance(s.value, (ast.Constant, ast.Str))]
    return len(stmts) == 1 and isinstance(stmts[0], ast.Pass)


def check_ast_silent_except(source: str, filepath: str):
    """Use AST to detect try/except with pass body."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return

    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        # Also handle TryStar in 3.11+ but ast.Try covers standard try/except
        for handler in node.handlers:
            # Bare except (handler.type is None) or except Exception
            is_bare = handler.type is None
            is_exception = (isinstance(handler.type, ast.Name) and handler.type.id == 'Exception')

            if (is_bare or is_exception) and _is_pass_body(handler.body):
                violations.append(
                    f"FAIL: {filepath}:{handler.lineno} — "
                    f"{'bare except: pass' if is_bare else 'except Exception: pass'} "
                    f"silently swallows errors")


def check_line_patterns(source: str, filepath: str):
    """Check for errors='coerce' and .dropna() without nearby diagnostics."""
    lines = source.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Check errors='coerce' without diagnostics within 5 lines
        if "errors='coerce'" in line or 'errors="coerce"' in line:
            window_start = max(0, i - 5)
            window_end = min(len(lines), i + 6)
            window = '\n'.join(lines[window_start:window_end])
            has_diagnostic = any(marker in window for marker in DIAGNOSTIC_MARKERS)
            if not has_diagnostic:
                violations.append(
                    f"FAIL: {filepath}:{i + 1} — errors='coerce' without logging/print within 5 lines")

        # Check .dropna() without diagnostics/len within 3 lines before
        if '.dropna(' in line or '.dropna()' in line:
            window_start = max(0, i - 3)
            window = '\n'.join(lines[window_start:i + 1])
            has_diagnostic = any(marker in window for marker in DIAGNOSTIC_MARKERS)
            has_len = 'len(' in window
            if not has_diagnostic and not has_len:
                violations.append(
                    f"FAIL: {filepath}:{i + 1} — .dropna() without print/logging/len() within 3 lines before")


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
        print("PASS: ds-error-handling — no Python files to check")
        sys.exit(0)

    for filepath, source in files:
        if source.strip():
            check_ast_silent_except(source, str(filepath))
            check_line_patterns(source, str(filepath))

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print(f"PASS: ds-error-handling — {len(files)} files checked, no silent error handling found")
    sys.exit(0)


if __name__ == '__main__':
    main()
