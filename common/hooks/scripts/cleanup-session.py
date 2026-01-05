#!/usr/bin/env python3
"""Stop hook: Clean up session-specific files when Claude session ends."""
import sys
import os
import json

# Add scripts dir to path for session module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import cleanup_session

try:
    # Read and discard stdin (hook best practice)
    sys.stdin.read()

    cleanup_session()

    # Output success confirmation with required event name
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "status": "cleaned"}}))
except Exception as e:
    print(f"Error cleaning up session: {e}", file=sys.stderr)
    sys.exit(1)
