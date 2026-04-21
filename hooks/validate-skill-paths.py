#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: Validate path references in skill files after edits.

Checks that ${CLAUDE_SKILL_DIR} and ${CLAUDE_PLUGIN_ROOT} references
in the edited file point to files that actually exist on disk.

Skips:
- User-project paths (.planning/, .claude/, outlines/, drafts/)
- Template/placeholder paths ({VAR}, other-skill, scripts/script.py)
- Files outside a plugin directory

Non-blocking: reports broken paths as messages.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Paths that exist in user projects, not the plugin
USER_PROJECT_PREFIXES = (
    ".planning/", ".claude/", "outlines/", "drafts/", "data/",
    "tests/", "src/", "logs/",
)

# Template/placeholder substrings — skip these
TEMPLATE_MARKERS = (
    "{SECTION", "{DRAFT", "{PLUGIN_ROOT}", "{STYLE}", "{OUTLINE",
    "SKILL-NAME", "SKILL/scripts", "other-skill", "TARGET/",
    "my-hook.py", "[Section]", "[phase_name]", "constraints.md",
    "scripts/script.py", "references/file.md",
)


def find_plugin_root(file_path: Path) -> Path | None:
    current = file_path.parent if file_path.is_file() else file_path
    for _ in range(15):
        if (current / ".claude-plugin" / "plugin.json").exists():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def get_skill_dir(filepath: Path, plugin_root: Path) -> Path:
    if filepath.name == "SKILL.md":
        return filepath.parent
    for parent in filepath.parents:
        if (parent / "SKILL.md").exists():
            return parent
        if parent == plugin_root:
            break
    return filepath.parent


def is_skippable(path_str: str) -> bool:
    clean = path_str.strip().strip('"').strip("'").strip('`')
    for p in USER_PROJECT_PREFIXES:
        if clean.startswith(p) or ("/" + p) in clean:
            return True
    for m in TEMPLATE_MARKERS:
        if m in clean:
            return True
    return False


def resolve_ref(raw: str, filepath: Path, plugin_root: Path) -> str | None:
    """Resolve a path reference. Returns resolved path string or None if skip."""
    clean = raw.strip().strip('"').strip("'").strip('`')
    if is_skippable(clean):
        return None

    if "${CLAUDE_SKILL_DIR}" in clean:
        skill_dir = get_skill_dir(filepath, plugin_root)
        resolved = clean.replace("${CLAUDE_SKILL_DIR}", str(skill_dir))
    elif "${CLAUDE_PLUGIN_ROOT}" in clean:
        resolved = clean.replace("${CLAUDE_PLUGIN_ROOT}", str(plugin_root))
    else:
        return None  # No env var reference to validate

    if "${" in resolved or "{" in resolved:
        return None

    return resolved


def extract_and_check(filepath: Path, content: str, plugin_root: Path) -> list[tuple[int, str, str]]:
    """Return list of (line_num, raw_ref, resolved_path) for broken refs."""
    broken = []
    lines = content.split("\n")
    in_fence = False

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence

        refs_to_check = []

        # ! injection: !`cat ${...}/path`
        for m in re.finditer(r'!\`cat\s+([^`]+)\`', line):
            refs_to_check.append(m.group(1).strip())

        # Any ${CLAUDE_SKILL_DIR} or ${CLAUDE_PLUGIN_ROOT} path
        for m in re.finditer(r'(\$\{CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)\}/[^\s"`\'\)>]+)', line):
            path_str = m.group(1).rstrip(")")
            if path_str not in [r for r in refs_to_check]:
                refs_to_check.append(path_str)

        for raw in refs_to_check:
            resolved = resolve_ref(raw, filepath, plugin_root)
            if resolved and not Path(resolved).exists():
                broken.append((i, raw, resolved))

    # Check for bang-backtick inside fenced code blocks (parser ignores fences)
    fenced_bangs = find_fenced_bang_backticks(lines)
    for line_num, raw in fenced_bangs:
        broken.append((line_num, raw, "FENCED_BANG_BACKTICK"))

    return broken


def find_fenced_bang_backticks(lines: list[str]) -> list[tuple[int, str]]:
    """Find !`cat ...` patterns inside fenced code blocks.

    Claude Code's ! injection parser does NOT respect markdown fences —
    it executes any !`...` it finds. Examples inside ``` blocks will be
    executed, causing errors if the path doesn't exist or unintended
    file injection if it does.
    """
    results = []
    in_fence = False
    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            for m in re.finditer(r'!\`cat\s+([^`]+)\`', line):
                results.append((i, m.group(0)))
    return results


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

    path = Path(file_path)

    # Only check markdown files in plugin directories
    if not path.suffix.lower() == ".md":
        sys.exit(0)

    plugin_root = find_plugin_root(path)
    if not plugin_root:
        sys.exit(0)

    try:
        content = path.read_text()
    except Exception:
        sys.exit(0)

    broken = extract_and_check(path, content, plugin_root)
    if not broken:
        sys.exit(0)

    # Format report
    rel = path.relative_to(plugin_root)
    lines = [f"Broken path references in {rel}:"]
    for line_num, raw, resolved in broken:
        if resolved == "FENCED_BANG_BACKTICK":
            lines.append(f"  L{line_num}: {raw}")
            lines.append(f"    -> DANGER: !`cat` inside fenced code block — Claude Code ignores fences and WILL execute this. Rewrite the example to avoid the literal !` pattern.")
        else:
            lines.append(f"  L{line_num}: {raw}")
            lines.append(f"    -> {resolved} (NOT FOUND)")

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n".join(lines),
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
