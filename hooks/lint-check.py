#!/usr/bin/env python3
"""
PostToolUse hook: Run appropriate linter after file edits.

Supports:
- Python (marimo): marimo check
- Python (regular): ruff check
- R: lintr
- Stata: stata-linter
- SAS: sasjs lint
- Markdown: smartquotes --check

Non-blocking: reports linter output as messages.
Silently skips if linter not installed.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Callable

PLUGIN_ROOT = Path(__file__).parent.parent


def run_command(cmd: list[str], timeout: int = 30) -> tuple[int, str, str]:
    """Run command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        return -1, "", "command not found"
    except subprocess.TimeoutExpired:
        return -2, "", "timeout"
    except Exception as e:
        return -3, "", str(e)


def is_marimo_notebook(file_path: str) -> bool:
    """Check if Python file is a marimo notebook."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read(2000)  # Check first 2000 chars
            return 'import marimo' in content or '@app.cell' in content
    except Exception:
        return False


def check_python(file_path: str) -> str | None:
    """Run marimo check or ruff on Python file."""
    if is_marimo_notebook(file_path):
        # marimo check
        code, stdout, stderr = run_command(['marimo', 'check', file_path])
        if code == -1:
            return None  # marimo not installed
        if code != 0:
            output = (stdout + stderr).strip()
            return f"marimo check:\n{output}" if output else None
    else:
        # ruff check
        code, stdout, stderr = run_command(['ruff', 'check', '--no-fix', file_path])
        if code == -1:
            return None  # ruff not installed
        if code != 0:
            output = stdout.strip()
            return f"ruff:\n{output}" if output else None
    return None


def check_r(file_path: str) -> str | None:
    """Run lintr on R file."""
    cmd = ['Rscript', '-e', f"cat(lintr::lint('{file_path}'))"]
    code, stdout, stderr = run_command(cmd)
    if code == -1:
        return None  # R/lintr not installed
    output = stdout.strip()
    if output and 'Error' not in stderr:
        return f"lintr:\n{output}"
    return None


def check_stata(file_path: str) -> str | None:
    """Run stata-linter on Stata file."""
    code, stdout, stderr = run_command(['stata-linter', file_path])
    if code == -1:
        return None  # stata-linter not installed
    if code != 0 or stdout.strip():
        output = stdout.strip()
        return f"stata-linter:\n{output}" if output else None
    return None


def check_sas(file_path: str) -> str | None:
    """Run sasjs lint on SAS file."""
    code, stdout, stderr = run_command(['sasjs', 'lint', file_path])
    if code == -1:
        return None  # sasjs not installed
    if code != 0 or stdout.strip():
        output = stdout.strip()
        return f"sasjs lint:\n{output}" if output else None
    return None


def check_markdown(file_path: str) -> str | None:
    """Run smartquotes --check on markdown file."""
    script = PLUGIN_ROOT / 'scripts' / 'smartquotes.py'
    if not script.exists():
        return None
    code, stdout, stderr = run_command(['python3', str(script), file_path, '--check'])
    if code == -1:
        return None  # python3 not available
    # smartquotes exits 0 even when changes needed, check output
    output = stdout.strip()
    if output and 'No changes needed' not in output:
        return f"smartquotes:\n{output}\n\nRun: python3 scripts/smartquotes.py {file_path}"
    return None


def get_linter_for_file(file_path: str) -> Callable | None:
    """Get appropriate linter function for file type."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    linters = {
        '.py': check_python,
        '.r': check_r,
        '.R': check_r,
        '.do': check_stata,
        '.ado': check_stata,
        '.sas': check_sas,
        '.md': check_markdown,
        '.markdown': check_markdown,
    }

    return linters.get(suffix)


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Get appropriate linter
    linter = get_linter_for_file(file_path)
    if not linter:
        sys.exit(0)

    # Run linter
    output = linter(file_path)
    if not output:
        sys.exit(0)

    # Report issues (non-blocking, adds context for Claude)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": f"Linter output:\n{output}"
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
