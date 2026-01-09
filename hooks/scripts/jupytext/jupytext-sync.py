#!/usr/bin/env python3
"""
Jupytext PostToolUse Hook: Syncs paired notebooks and runs language-specific linters.

Workflow:
1. Detect if file is jupytext-managed (has # %% or jupyter: metadata)
2. Run `uvx jupytext --sync` to keep .py/.ipynb in sync
3. Detect kernel/language from file
4. Run appropriate linter if available:
   - Python: ruff/black/mypy (from pixi.toml)
   - R: lintr (from tidyverse)
   - SAS: sasjs lint
   - Stata: stata-linter

Non-blocking: Reports sync status and lint issues as warnings.
"""

from __future__ import annotations

import json
import sys
import os
import subprocess
import re
from pathlib import Path
from typing import Optional, Tuple


def is_jupytext_file(file_path: str) -> bool:
    """Check if file is jupytext-managed by looking for markers."""
    if not file_path.endswith(('.py', '.R', '.do', '.sas')):
        return False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read(2000)  # Check first 2000 chars
            # Look for percent format markers or jupyter metadata
            has_percent = '# %%' in content or '#%%' in content
            has_jupyter_meta = 'jupyter:' in content and 'kernelspec:' in content
            return has_percent or has_jupyter_meta
    except Exception:
        return False


def detect_kernel(file_path: str) -> str:
    """Detect kernel/language from file extension and content."""
    ext = Path(file_path).suffix

    # Simple extension-based detection
    if ext == '.py':
        return 'python'
    elif ext == '.R':
        return 'r'
    elif ext == '.do':
        return 'stata'
    elif ext == '.sas':
        return 'sas'

    # Fallback: check YAML header
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read(1000)
            if 'name: ir' in content.lower():
                return 'r'
            elif 'language: python' in content.lower():
                return 'python'
    except Exception:
        pass

    return 'unknown'


def run_jupytext_sync(file_path: str) -> Tuple[bool, str, bool]:
    """Run jupytext --sync. Returns (success, output, files_modified)."""
    try:
        # Get modification times before sync
        py_path = Path(file_path)
        ipynb_path = py_path.with_suffix('.ipynb')

        old_times = {}
        for p in [py_path, ipynb_path]:
            if p.exists():
                old_times[str(p)] = p.stat().st_mtime

        result = subprocess.run(
            ['uvx', 'jupytext', '--sync', file_path],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(file_path) or '.'
        )

        # Check if files were modified
        files_modified = False
        for p in [py_path, ipynb_path]:
            if p.exists():
                new_time = p.stat().st_mtime
                if str(p) in old_times and new_time > old_times[str(p)]:
                    files_modified = True
                    break

        success = result.returncode == 0
        output = result.stdout + result.stderr

        # "Not a paired notebook" is not an error - just means no sync needed
        if 'is not a paired notebook' in output:
            return True, output.strip(), False

        return success, output.strip(), files_modified

    except subprocess.TimeoutExpired:
        return False, "jupytext sync timed out (30s)", False
    except FileNotFoundError:
        return False, "uvx command not found. Is uv installed?", False
    except Exception as e:
        return False, f"Error running jupytext sync: {e}", False


def find_python_linters(file_path: str) -> list[str]:
    """Find available Python linters from pixi.toml."""
    linters = []

    # Search up directory tree for pixi.toml
    current = Path(file_path).parent
    while current != current.parent:
        pixi_toml = current / 'pixi.toml'
        if pixi_toml.exists():
            try:
                content = pixi_toml.read_text()
                # Simple grep for common linters
                if 'ruff' in content:
                    linters.append('ruff')
                if 'black' in content:
                    linters.append('black')
                if 'mypy' in content:
                    linters.append('mypy')
                break
            except Exception:
                pass
        current = current.parent

    return linters


def run_python_linters(file_path: str) -> list[str]:
    """Run available Python linters. Returns list of issues."""
    linters = find_python_linters(file_path)
    issues = []

    for linter in linters:
        try:
            if linter == 'ruff':
                result = subprocess.run(
                    ['ruff', 'check', file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode != 0 and result.stdout.strip():
                    issues.append(f"ruff: {result.stdout.strip()}")

            elif linter == 'black':
                result = subprocess.run(
                    ['black', '--check', file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode != 0:
                    issues.append(f"black: File would be reformatted")

            elif linter == 'mypy':
                result = subprocess.run(
                    ['mypy', file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode != 0 and result.stdout.strip():
                    issues.append(f"mypy: {result.stdout.strip()}")

        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    return issues


def run_r_linter(file_path: str) -> list[str]:
    """Run lintr on R file. Returns list of issues."""
    try:
        # lintr script that checks file
        r_script = f"""
library(lintr)
lints <- lint("{file_path}")
if (length(lints) > 0) {{
    cat(format(lints), sep = "\\n")
    quit(status = 1)
}}
"""
        result = subprocess.run(
            ['R', '--quiet', '--no-save', '-e', r_script],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0 and result.stdout.strip():
            return [f"lintr: {result.stdout.strip()}"]

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return []


def run_stata_linter(file_path: str) -> list[str]:
    """Run stata-linter. Returns list of issues."""
    try:
        result = subprocess.run(
            ['stata-linter', file_path],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0 and result.stdout.strip():
            return [f"stata-linter: {result.stdout.strip()}"]

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return []


def run_sas_linter(file_path: str) -> list[str]:
    """Run sasjs lint. Returns list of issues."""
    try:
        result = subprocess.run(
            ['sasjs', 'lint', file_path],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0 and result.stdout.strip():
            return [f"sasjs lint: {result.stdout.strip()}"]

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return []


def run_linters(file_path: str, kernel: str) -> list[str]:
    """Run appropriate linters based on kernel/language."""
    if kernel == 'python':
        return run_python_linters(file_path)
    elif kernel == 'r':
        return run_r_linter(file_path)
    elif kernel == 'stata':
        return run_stata_linter(file_path)
    elif kernel == 'sas':
        return run_sas_linter(file_path)
    return []


def format_message(file_path: str, synced: bool, modified: bool, lint_issues: list[str]) -> str:
    """Format hook output message."""
    filename = os.path.basename(file_path)
    lines = []

    if synced:
        if modified:
            lines.append(f"✓ Synced {filename} with paired notebook")
        # If sync succeeded but no files modified, stay silent
    else:
        lines.append(f"⚠️ Sync failed for {filename}")

    if lint_issues:
        lines.append(f"\n⚠️ Linting issues found:")
        for issue in lint_issues[:5]:  # Limit to first 5 issues
            lines.append(f"  • {issue}")
        if len(lint_issues) > 5:
            lines.append(f"  ... and {len(lint_issues) - 5} more")

    return '\n'.join(lines) if lines else None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check Edit and Write tools
    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Check if it's a jupytext file
    if not is_jupytext_file(file_path):
        sys.exit(0)

    # Run jupytext sync
    sync_success, sync_output, files_modified = run_jupytext_sync(file_path)

    # Detect kernel and run linters
    kernel = detect_kernel(file_path)
    lint_issues = run_linters(file_path, kernel) if sync_success else []

    # Format and output message
    message = format_message(file_path, sync_success, files_modified, lint_issues)

    if message:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "message": message
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
