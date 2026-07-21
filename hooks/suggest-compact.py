#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Suggest manual compaction at strategic intervals.

Tracks Edit/Write tool calls and suggests /compact at logical checkpoints.
Manual compaction at strategic points (after exploration, before execution)
preserves more context than auto-compact which happens at arbitrary points.

Configuration via environment:
- COMPACT_THRESHOLD: Tool calls before first suggestion (default: 50)
- COMPACT_INTERVAL: Tool calls between subsequent suggestions (default: 25)
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def get_counter_file() -> Path:
    """Get session-specific counter file path."""
    session_id = os.environ.get('CLAUDE_SESSION_ID', str(os.getppid()))
    return Path(tempfile.gettempdir()) / f'claude-tool-count-{session_id}'


def read_counter() -> int:
    """Read current tool call count."""
    counter_file = get_counter_file()
    if counter_file.exists():
        try:
            return int(counter_file.read_text().strip())
        except (ValueError, IOError):
            pass
    return 0


def write_counter(count: int) -> None:
    """Write updated tool call count."""
    counter_file = get_counter_file()
    try:
        counter_file.write_text(str(count))
    except IOError:
        pass


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, KeyError):
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')

    # Only count Edit and Write operations
    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    # Increment counter
    count = read_counter() + 1
    write_counter(count)

    # Get thresholds from environment
    threshold = int(os.environ.get('COMPACT_THRESHOLD', '50'))
    interval = int(os.environ.get('COMPACT_INTERVAL', '25'))

    # Suggest compaction at strategic points
    message = None

    if count == threshold:
        message = f"[StrategicCompact] {threshold} edits reached - consider /compact if transitioning phases"
    elif count > threshold and (count - threshold) % interval == 0:
        message = f"[StrategicCompact] {count} edits - good checkpoint for /compact if context is stale"

    if message:
        # hookEventName MUST match the event this hook was actually invoked on, or the
        # harness rejects the payload and the suggestion is dropped. This hook is wired
        # to PreToolUse (hooks/hooks.json) AND to PostToolUse (skills/workshop,
        # skills/workshop-revise), so hardcoding "PreToolUse" silently broke it under
        # the workshop wiring. Read the event from the payload instead.
        event = hook_input.get('hook_event_name') or 'PreToolUse'
        result = {
            "hookSpecificOutput": {
                "hookEventName": event,
                "additionalContext": message
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
