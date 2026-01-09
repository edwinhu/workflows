#!/usr/bin/env python3
"""
Stop Hook: Enforce ralph-loop completion promise

This hook runs on Stop events and checks if we're in an active ralph loop.
If so, it verifies that the completion promise was output before allowing stop.

This prevents Claude from exiting a ralph loop without completing the task.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main():
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Can't parse input, allow stop
        sys.exit(0)

    session_id = hook_input.get('sessionId', '')
    if not session_id:
        # No session ID, allow stop
        sys.exit(0)

    # Add transcript module to path
    script_dir = Path(__file__).parent.parent.parent.parent
    transcript_path = script_dir / 'common' / 'hooks' / 'scripts'
    sys.path.insert(0, str(transcript_path))

    try:
        from transcript import (
            read_transcript,
            find_last_skill_invocation,
            extract_arg_value,
            search_promise_tag
        )
    except ImportError:
        # Transcript module not available, allow stop
        sys.exit(0)

    # Read transcript
    transcript = read_transcript(session_id)
    if not transcript:
        # No transcript, allow stop
        sys.exit(0)

    # Check if we're in a ralph loop
    ralph_invocation = find_last_skill_invocation(
        transcript,
        r'ralph-loop'
    )

    if not ralph_invocation:
        # Not in ralph loop, allow stop
        sys.exit(0)

    # Extract completion promise from invocation
    promise_token = extract_arg_value(ralph_invocation, 'completion-promise')
    if not promise_token:
        # No promise specified in invocation (malformed), allow stop
        sys.exit(0)

    # Search for promise in transcript
    promise_found = search_promise_tag(transcript, promise_token)

    if promise_found:
        # Promise found! Allow stop, inject completion message
        result = {
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "message": f"""
[RALPH LOOP COMPLETE]

Completion promise detected: <promise>{promise_token}</promise>
Ralph loop has ended.
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Promise NOT found - block stop
    # Extract task description for context
    task_match = None
    try:
        import re
        task_match = re.search(r'"([^"]*)"', ralph_invocation)
    except ImportError:
        pass

    task_desc = task_match.group(1) if task_match else "the task"

    result = {
        "continue": False,
        "reason": f"""
[RALPH LOOP ENFORCEMENT]

The completion promise was not output. The loop must continue.

Task: {task_desc}
Expected promise: <promise>{promise_token}</promise>

Continue working on the task. Output the promise only when the task is TRULY complete.

REMINDER: The promise is a claim that the task is done. Only output it when:
- For implementation: Tests pass and implementation is complete
- For debugging: Bug is fixed and regression test passes
- For any task: The work is verifiably complete

Do not output the promise to "move on" or "try something else".
"""
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
