#!/usr/bin/env python3
"""
PostToolUse Hook: Inject Matching Rule Files

Automatically injects relevant rule files when Claude reads or edits files.
Rules are matched based on glob patterns in YAML frontmatter.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


# Session cache directory
CACHE_DIR = Path.home() / '.claude' / '.sisyphus' / 'rules-injector'


def load_session_cache(session_id: str) -> set[str]:
    """
    Load injected file hashes for this session.

    Args:
        session_id: Session ID

    Returns:
        Set of rule file hashes already injected
    """
    cache_file = CACHE_DIR / f'session-{session_id}.json'
    if not cache_file.exists():
        return set()

    try:
        data = json.loads(cache_file.read_text())
        return set(data.get('injected_hashes', []))
    except (json.JSONDecodeError, IOError):
        return set()


def save_session_cache(session_id: str, hashes: set[str]) -> None:
    """
    Save injected file hashes for this session.

    Args:
        session_id: Session ID
        hashes: Set of injected rule hashes
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f'session-{session_id}.json'

    data = {'injected_hashes': list(hashes)}
    try:
        cache_file.write_text(json.dumps(data, indent=2))
    except IOError:
        pass  # Non-fatal, cache is just optimization


def main():
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Can't parse input, skip
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})
    session_id = hook_input.get('sessionId', 'unknown')

    # Only trigger on Read or Edit tools
    if tool_name not in ('Read', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Add lib/hooks to path for modules
    sys.path.insert(0, str(Path(__file__).parent.parent / 'lib' / 'hooks'))

    try:
        from rules_parser import parse_frontmatter, validate_rule_metadata, get_priority
        from rules_matcher import (
            find_rule_files,
            find_project_root,
            file_content_hash,
            should_inject_rule,
            sort_rules_by_priority
        )
    except ImportError:
        # Modules not available, skip
        sys.exit(0)

    # Find project root
    project_root = find_project_root(file_path)

    # Find rule files
    rule_files = find_rule_files(project_root)
    if not rule_files:
        sys.exit(0)

    # Load session cache
    injected_hashes = load_session_cache(session_id)

    # Check each rule file
    rules_to_inject: list[tuple[Path, dict, str, int]] = []  # (path, metadata, body, priority)

    for rule_file in rule_files:
        file_hash = file_content_hash(rule_file)
        if not file_hash:
            continue

        try:
            content = rule_file.read_text(encoding='utf-8')
        except (IOError, UnicodeDecodeError):
            continue

        metadata, body = parse_frontmatter(content)

        # Validate metadata
        if not validate_rule_metadata(metadata):
            continue

        # Check if should inject
        should_inject, reason = should_inject_rule(
            file_path,
            metadata,
            injected_hashes,
            file_hash,
            str(project_root)
        )

        if should_inject:
            priority = get_priority(metadata)
            rules_to_inject.append((rule_file, metadata, body, priority))
            injected_hashes.add(file_hash)

    if not rules_to_inject:
        sys.exit(0)

    # Sort by priority (highest first)
    rules_to_inject_sorted = sorted(rules_to_inject, key=lambda x: x[3], reverse=True)

    # Build injection message
    sections = []
    for rule_file, metadata, body, priority in rules_to_inject_sorted:
        sections.append(f"""# Rule from {rule_file.name}

{body.strip()}""")

    # Save updated cache
    save_session_cache(session_id, injected_hashes)

    # Inject message
    combined = "\n\n---\n\n".join(sections)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "message": f"""
<system-reminder>
The following rules apply to this file:

{combined}
</system-reminder>
"""
        }
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
