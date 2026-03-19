#!/usr/bin/env python3
"""
PostToolUse hook: Validate plugin manifests and component frontmatter after edits.

Triggers on:
- plugin.json / marketplace.json — runs `claude plugin validate <file>`
- SKILL.md, agent .md, command .md — runs `claude plugin validate <plugin-dir>`
- hooks.json inside a plugin — runs `claude plugin validate <plugin-dir>`

Non-blocking: reports validation output as messages.
Silently skips if not inside a plugin directory or if claude CLI not found.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def find_plugin_root(file_path: Path) -> Path | None:
    """Walk up from file to find nearest directory containing .claude-plugin/plugin.json."""
    current = file_path.parent if file_path.is_file() else file_path
    for _ in range(15):  # max 15 levels up
        candidate = current / ".claude-plugin" / "plugin.json"
        if candidate.exists():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def run_validate(target: str, timeout: int = 15) -> tuple[int, str, str]:
    """Run claude plugin validate and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["claude", "plugin", "validate", target],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        return -1, "", "claude CLI not found"
    except subprocess.TimeoutExpired:
        return -2, "", "validation timed out"
    except Exception as e:
        return -3, "", str(e)


def should_validate(file_path: str) -> tuple[str | None, str]:
    """Determine what to validate based on the edited file.

    Returns (target_path, description) or (None, "") if not a plugin file.
    """
    path = Path(file_path)
    name = path.name.lower()

    # Direct manifest files — validate the specific file
    if name == "plugin.json" and path.parent.name == ".claude-plugin":
        return str(path), "plugin.json"
    if name == "marketplace.json" and path.parent.name == ".claude-plugin":
        return str(path), "marketplace.json"

    # Plugin component files — validate the whole plugin directory
    plugin_root = find_plugin_root(path)
    if not plugin_root:
        return None, ""

    # SKILL.md, agent .md, command .md, hooks.json
    if name == "skill.md":
        plugin_json = plugin_root / ".claude-plugin" / "plugin.json"
        return str(plugin_json), "plugin (skill changed)"
    if name == "hooks.json" and "hooks" in str(path.parent):
        plugin_json = plugin_root / ".claude-plugin" / "plugin.json"
        return str(plugin_json), "plugin (hooks changed)"
    # Agent or command markdown files
    rel = path.relative_to(plugin_root) if path.is_relative_to(plugin_root) else None
    if rel and name.endswith(".md"):
        parts = rel.parts
        if len(parts) >= 2 and parts[0] in ("agents", "commands"):
            plugin_json = plugin_root / ".claude-plugin" / "plugin.json"
            return str(plugin_json), f"plugin ({parts[0]} changed)"

    return None, ""


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    target, description = should_validate(file_path)
    if not target:
        sys.exit(0)

    code, stdout, stderr = run_validate(target)

    if code == -1:
        sys.exit(0)  # claude CLI not found, skip silently

    # Combine output
    output = (stdout + stderr).strip()

    if code != 0 and output:
        # Validation failed — report errors
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Plugin validation ({description}) FAILED:\n{output}",
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Check for warnings in passing output (validate exits 0 but may warn)
    if "warning" in output.lower() or "⚠" in output:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Plugin validation ({description}) warnings:\n{output}",
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == "__main__":
    main()
