#!/usr/bin/env python3
"""
Rules Matcher: Glob Pattern Matching and File Discovery

Functions for finding rule files and matching them to file paths.
"""

from __future__ import annotations

import fnmatch
import hashlib
from pathlib import Path
from typing import Any


def find_rule_files(project_root: Path) -> list[Path]:
    """
    Find all rule files in priority order.

    Search locations (in order):
    1. .github/copilot-instructions.md (always applied)
    2. .claude/rules/*.md (project-level)
    3. ~/.claude/rules/*.md (user-level)

    Args:
        project_root: Project root directory

    Returns:
        List of rule file paths
    """
    rules: list[Path] = []

    # 1. .github/copilot-instructions.md (always applied)
    github_instructions = project_root / '.github' / 'copilot-instructions.md'
    if github_instructions.exists():
        rules.append(github_instructions)

    # 2. .claude/rules/*.md (project-level)
    claude_rules = project_root / '.claude' / 'rules'
    if claude_rules.exists() and claude_rules.is_dir():
        rules.extend(sorted(claude_rules.glob('*.md')))

    # 3. ~/.claude/rules/*.md (user-level)
    user_rules = Path.home() / '.claude' / 'rules'
    if user_rules.exists() and user_rules.is_dir():
        rules.extend(sorted(user_rules.glob('*.md')))

    return rules


def matches_glob_pattern(file_path: str, pattern: str, project_root: str = "") -> bool:
    """
    Check if file path matches glob pattern.

    Supports patterns like:
    - **/*.py (all Python files)
    - src/**/*.ts (TypeScript files in src/)
    - **/tests/*.py (test files)

    Args:
        file_path: Absolute or relative file path
        pattern: Glob pattern to match
        project_root: Project root for relative matching (optional)

    Returns:
        True if file matches pattern
    """
    # Convert to Path for easier manipulation
    path = Path(file_path)

    # If project_root provided, make path relative to it
    if project_root:
        try:
            proj_root = Path(project_root)
            path = path.relative_to(proj_root)
        except ValueError:
            # Path not relative to project root, use as-is
            pass

    # Convert to string for fnmatch
    path_str = str(path)

    # Use fnmatch for glob matching
    return fnmatch.fnmatch(path_str, pattern)


def file_content_hash(file_path: Path) -> str:
    """
    Generate hash of file content for deduplication.

    Uses SHA256 hash, truncated to 16 chars for storage efficiency.

    Args:
        file_path: Path to file

    Returns:
        Hash string (16 chars), empty string on error
    """
    try:
        content = file_path.read_bytes()
        return hashlib.sha256(content).hexdigest()[:16]
    except (IOError, OSError):
        return ""


def should_inject_rule(
    file_path: str,
    metadata: dict[str, Any],
    injected_hashes: set[str],
    file_hash: str,
    project_root: str = ""
) -> tuple[bool, str]:
    """
    Check if rule should be injected for this file.

    Rules for injection:
    1. Not already injected this session (check hash)
    2. Either:
       a. No applies_to metadata (always applies, e.g., copilot-instructions.md)
       b. File path matches one of the applies_to patterns

    Args:
        file_path: File path being accessed
        metadata: Rule file metadata
        injected_hashes: Set of already-injected rule hashes
        file_hash: Hash of the rule file
        project_root: Project root for relative matching

    Returns:
        Tuple of (should_inject, reason)
    """
    # Check if already injected this session
    if file_hash in injected_hashes:
        return False, "already_injected"

    # If no applies_to, always inject (e.g., copilot-instructions.md)
    if 'applies_to' not in metadata:
        return True, "always_applies"

    # Check glob patterns
    applies_to = metadata.get('applies_to', [])
    if not isinstance(applies_to, list):
        applies_to = [applies_to]

    for pattern in applies_to:
        if matches_glob_pattern(file_path, pattern, project_root):
            return True, f"matches_{pattern}"

    return False, "no_match"


def find_project_root(file_path: str) -> Path:
    """
    Find project root directory by walking up from file.

    Looks for:
    - .git directory
    - .claude directory

    Args:
        file_path: File path to start from

    Returns:
        Project root Path (defaults to file's directory if not found)
    """
    path = Path(file_path)

    # Start from file's directory
    if path.is_file():
        current = path.parent
    else:
        current = path

    # Walk up looking for project markers
    while current != current.parent:
        if (current / '.git').exists() or (current / '.claude').exists():
            return current
        current = current.parent

    # Default to file's directory
    return path.parent if path.is_file() else path


def sort_rules_by_priority(
    rules: list[tuple[Path, dict[str, Any]]]
) -> list[tuple[Path, dict[str, Any]]]:
    """
    Sort rules by priority (higher priority first).

    Args:
        rules: List of (rule_path, metadata) tuples

    Returns:
        Sorted list (highest priority first)
    """
    def get_priority(rule: tuple[Path, dict[str, Any]]) -> int:
        _, metadata = rule
        priority = metadata.get('priority', 10)
        if isinstance(priority, (int, float)):
            return int(priority)
        return 10

    # Sort descending (highest priority first)
    return sorted(rules, key=get_priority, reverse=True)
