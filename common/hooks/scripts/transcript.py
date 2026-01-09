#!/usr/bin/env python3
"""
Transcript Parsing Utilities

Functions for reading and parsing Claude Code session transcripts.
Used by ralph-loop enforcement to detect completion promises.
"""

from __future__ import annotations

import re
from pathlib import Path


def find_transcript_file(session_id: str) -> Path | None:
    """
    Find transcript file for session ID.

    Claude Code stores transcripts in various locations:
    - ~/.claude/sessions/{session_id}/transcript.md
    - ~/.claude/sessions/{session_id}/messages.json
    - ~/.claude/transcripts/{session_id}.md

    Args:
        session_id: Session ID to find transcript for

    Returns:
        Path to transcript file if found, None otherwise
    """
    claude_dir = Path.home() / '.claude'
    possible_paths = [
        claude_dir / 'sessions' / session_id / 'transcript.md',
        claude_dir / 'sessions' / session_id / 'messages.json',
        claude_dir / 'transcripts' / f'{session_id}.md',
    ]

    for path in possible_paths:
        if path.exists():
            return path

    return None


def read_transcript(session_id: str) -> str:
    """
    Read transcript content for session.

    Args:
        session_id: Session ID to read

    Returns:
        Transcript content as string, empty if not found
    """
    path = find_transcript_file(session_id)
    if not path:
        return ""

    try:
        return path.read_text(encoding='utf-8')
    except (IOError, UnicodeDecodeError):
        return ""


def find_last_skill_invocation(
    transcript: str,
    skill_pattern: str
) -> str | None:
    """
    Find last /skill invocation in transcript.

    Matches patterns like:
    - /skill-name:sub-skill "prompt" --arg value
    - /ralph-loop "Task 1" --max-iterations 5 --completion-promise "TASK1_DONE"

    Args:
        transcript: Transcript content
        skill_pattern: Regex pattern for skill name (e.g., r'ralph-loop')

    Returns:
        Last matching skill invocation line, None if not found
    """
    # Match: /skill-name... until newline
    # Pattern allows for alphanumeric, hyphens, colons, underscores
    pattern = rf'/{skill_pattern}[^\n]*'
    matches = list(re.finditer(pattern, transcript))

    if matches:
        return matches[-1].group(0)

    return None


def extract_arg_value(command: str, arg_name: str) -> str | None:
    """
    Extract --arg-name value from command string.

    Handles both:
    - --arg-name "value with spaces"
    - --arg-name value

    Args:
        command: Command string (e.g., '/skill --arg1 val1 --arg2 "val 2"')
        arg_name: Argument name without dashes (e.g., 'arg1')

    Returns:
        Argument value if found, None otherwise
    """
    # Match: --arg-name "value" or --arg-name value
    # Quoted value: captures everything between quotes
    # Unquoted value: captures until next space or end of line
    pattern = rf'--{re.escape(arg_name)}\s+(?:"([^"]*)"|(\S+))'
    match = re.search(pattern, command)

    if match:
        # Return either quoted (group 1) or unquoted (group 2) value
        return match.group(1) or match.group(2)

    return None


def search_promise_tag(transcript: str, promise_token: str) -> bool:
    """
    Search for <promise>TOKEN</promise> in transcript.

    Ignores promises in code blocks to prevent false positives.

    Args:
        transcript: Transcript content
        promise_token: Token to search for (will be escaped for regex)

    Returns:
        True if promise tag found, False otherwise
    """
    # Remove code blocks first to avoid false positives
    # Match: ```...``` or `...`
    transcript_no_code = re.sub(r'```[\s\S]*?```', '', transcript)
    transcript_no_code = re.sub(r'`[^`]*`', '', transcript_no_code)

    # Escape special regex chars in token
    escaped_token = re.escape(promise_token)

    # Match: <promise>TOKEN</promise> (allow whitespace around token)
    pattern = rf'<promise>\s*{escaped_token}\s*</promise>'

    return bool(re.search(pattern, transcript_no_code, re.IGNORECASE | re.MULTILINE))


def is_in_code_block(text: str, position: int) -> bool:
    """
    Check if position in text is inside a code block.

    Args:
        text: Full text content
        position: Character position to check

    Returns:
        True if position is inside ```...``` code block
    """
    # Count backtick pairs before position
    text_before = text[:position]
    triple_ticks = text_before.count('```')

    # If odd number of ```, we're inside a code block
    return triple_ticks % 2 == 1


def extract_task_from_ralph_invocation(invocation: str) -> str:
    """
    Extract task description from ralph-loop invocation.

    Args:
        invocation: Ralph loop command line

    Returns:
        Task description (first quoted argument), or empty string
    """
    # Match first quoted string after command
    # Pattern: "anything inside quotes"
    match = re.search(r'"([^"]*)"', invocation)

    if match:
        return match.group(1)

    return ""
