#!/usr/bin/env python3
"""
SessionStart hook: Session initialization + boulder state detection

Checks for active boulder state in the current project and provides
continuation messages for ongoing work.
"""

import sys
import json
from pathlib import Path

# Add common utilities
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'common' / 'hooks' / 'scripts'))
from boulder import (
    read_boulder_state,
    append_session_id,
    update_boulder_progress,
    is_plan_complete,
    clear_boulder_state
)


def find_project_root() -> Path:
    """Find project root by looking for .git or .claude directory"""
    current = Path.cwd()

    while current != current.parent:
        if (current / '.git').exists() or (current / '.claude').exists():
            return current
        current = current.parent

    # Default to current directory if no markers found
    return Path.cwd()


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    session_id = hook_input.get('sessionId', 'unknown')

    # Detect project root
    project_root = find_project_root()

    # Check for active boulder in this project
    boulder = read_boulder_state(project_root)
    if not boulder:
        sys.exit(0)  # No active plan

    active_plan = boulder.get('active_plan')
    if not active_plan or not Path(active_plan).exists():
        # Plan file deleted
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "message": f"""
[BOULDER STATE WARNING]

Boulder state references missing plan: {active_plan}

Clear boulder state with: rm {project_root / '.claude' / '.boulder.json'}
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Update session ID
    append_session_id(project_root, session_id)

    # Update progress
    update_boulder_progress(project_root, active_plan)

    # Check if complete
    if is_plan_complete(active_plan):
        clear_boulder_state(project_root)
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "message": f"""
[BOULDER COMPLETE]

Plan '{boulder['plan_name']}' is complete! All tasks checked off.
Boulder state has been cleared.
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Inject continuation message
    progress = boulder.get('progress', {})
    total = progress.get('total', 0)
    completed = progress.get('completed', 0)

    try:
        plan_path_relative = Path(active_plan).relative_to(project_root)
    except ValueError:
        # If can't make relative, use absolute
        plan_path_relative = active_plan

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "message": f"""
[BOULDER STATE DETECTED]

Active plan: {boulder['plan_name']}
Progress: {completed}/{total} tasks complete
Plan location: {plan_path_relative}

Continuing from where you left off.
"""
        }
    }

    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
