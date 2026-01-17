#!/usr/bin/env python3
"""Stop hook: Clean up session-specific files when Claude session ends."""
import sys
import json
from pathlib import Path

# Add lib/hooks to path for session module
sys.path.insert(0, str(Path(__file__).parent.parent / 'lib' / 'hooks'))
from session import cleanup_session

try:
    # Read and discard stdin (hook best practice)
    sys.stdin.read()

    cleanup_session()

    # Stop hooks don't need hookSpecificOutput, just signal success
    print(json.dumps({}))
except Exception as e:
    print(f"Error cleaning up session: {e}", file=sys.stderr)
    sys.exit(1)
