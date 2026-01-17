#!/usr/bin/env python3
"""
Rules Parser: YAML Frontmatter Parsing

Parses YAML frontmatter from markdown files for rules injection.
Simple parser to avoid external dependencies like pyyaml.
"""

from __future__ import annotations

import re
from typing import Any


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """
    Parse YAML frontmatter from markdown content.

    Expected format:
    ---
    key: value
    list_key:
      - item1
      - item2
    ---

    Body content here...

    Args:
        content: Full markdown content

    Returns:
        Tuple of (metadata_dict, body_content)
        Returns ({}, content) if no frontmatter found
    """
    # Match: ---\n...yaml...\n---\n
    pattern = r'^---\s*\n(.*?)\n---\s*\n(.*)$'
    match = re.match(pattern, content, re.DOTALL)

    if not match:
        # No frontmatter found
        return {}, content

    yaml_content = match.group(1)
    body = match.group(2)

    # Parse YAML content (simple parser)
    metadata = _parse_yaml_simple(yaml_content)

    return metadata, body


def _parse_yaml_simple(yaml_content: str) -> dict[str, Any]:
    """
    Simple YAML parser for frontmatter.

    Handles:
    - key: value
    - key: "quoted value"
    - key:
        - list item
        - list item
    - priority: 10 (numbers)

    Does NOT handle:
    - Nested dicts
    - Complex YAML features
    - Multiline strings

    Args:
        yaml_content: YAML content to parse

    Returns:
        Dictionary of parsed values
    """
    metadata: dict[str, Any] = {}
    current_list_key: str | None = None
    lines = yaml_content.split('\n')

    for line in lines:
        # Skip empty lines and comments
        if not line.strip() or line.strip().startswith('#'):
            continue

        # Check if this is a list item
        if line.strip().startswith('-'):
            if current_list_key:
                item = line.strip()[1:].strip()
                # Remove quotes
                item = _unquote(item)
                metadata[current_list_key].append(item)
            continue

        # Check if this is a key-value line
        if ':' not in line:
            current_list_key = None
            continue

        key, _, value = line.partition(':')
        key = key.strip()
        value = value.strip()

        # If value is empty, this might be a list key
        if not value:
            current_list_key = key
            metadata[key] = []
            continue

        # Reset list key when we see a regular key
        current_list_key = None

        # Parse value
        metadata[key] = _parse_yaml_value(value)

    return metadata


def _parse_yaml_value(value: str) -> Any:
    """
    Parse a YAML value string.

    Handles:
    - "quoted strings"
    - 'quoted strings'
    - numbers
    - booleans (true/false)
    - plain strings

    Args:
        value: Value string to parse

    Returns:
        Parsed value (str, int, bool, etc.)
    """
    value = value.strip()

    # Handle quoted strings
    if (value.startswith('"') and value.endswith('"')) or \
       (value.startswith("'") and value.endswith("'")):
        return value[1:-1]

    # Handle numbers
    if value.isdigit():
        return int(value)

    # Try float
    try:
        if '.' in value:
            return float(value)
    except ValueError:
        pass

    # Handle booleans
    if value.lower() in ('true', 'yes'):
        return True
    if value.lower() in ('false', 'no'):
        return False

    # Plain string
    return value


def _unquote(s: str) -> str:
    """Remove surrounding quotes from string."""
    s = s.strip()
    if (s.startswith('"') and s.endswith('"')) or \
       (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def validate_rule_metadata(metadata: dict[str, Any]) -> bool:
    """
    Validate rule file metadata.

    Valid metadata should have:
    - applies_to: list of glob patterns (optional for copilot-instructions.md)
    - priority: number (optional, default 10)
    - tags: list of strings (optional)

    Args:
        metadata: Parsed metadata dictionary

    Returns:
        True if valid or empty, False if malformed
    """
    # Empty metadata is valid (e.g., copilot-instructions.md)
    if not metadata:
        return True

    # If applies_to exists, must be a list
    if 'applies_to' in metadata:
        applies_to = metadata['applies_to']
        if not isinstance(applies_to, list):
            return False

    # If priority exists, must be a number
    if 'priority' in metadata:
        priority = metadata['priority']
        if not isinstance(priority, (int, float)):
            return False

    # If tags exists, must be a list
    if 'tags' in metadata:
        tags = metadata['tags']
        if not isinstance(tags, list):
            return False

    return True


def get_priority(metadata: dict[str, Any]) -> int:
    """
    Get priority from metadata, with default.

    Args:
        metadata: Parsed metadata

    Returns:
        Priority (default: 10)
    """
    priority = metadata.get('priority', 10)
    if isinstance(priority, (int, float)):
        return int(priority)
    return 10
