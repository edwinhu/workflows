#!/usr/bin/env python3
"""
Main Chat Sandbox: Block most tools from main chat.
Main chat can only: read files, write .md/.txt, and run safe queries.
All implementation must go through sub-agents.
"""

import json
import sys
import os
import glob

def is_from_agent(hook_input: dict) -> bool:
    """Check if this is from a sub-agent."""
    tool_use_id = hook_input.get('tool_use_id', '')
    if not tool_use_id:
        return False

    transcript_dirs = glob.glob(os.path.expanduser('~/.claude/projects/-home-edwinhu*'))
    for dir_path in transcript_dirs:
        agent_files = glob.glob(os.path.join(dir_path, 'agent-*.jsonl'))
        for agent_file in agent_files:
            try:
                with open(agent_file, 'r') as f:
                    if tool_use_id in f.read():
                        return True
            except:
                pass
    return False

def main():
    try:
        hook_input = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Always allow from sub-agents
    if is_from_agent(hook_input):
        sys.exit(0)

    # Main chat restrictions:

    # Block Bash entirely from main chat
    if tool_name == 'Bash':
        command = tool_input.get('command', '')
        # Allow only safe read-only commands
        safe_prefixes = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'tree', 'pwd', 'echo', 'git status', 'git log', 'git diff', 'git show', 'git branch', 'git add', 'git commit', 'git push', 'git pull', 'git fetch', 'git checkout', 'git stash']
        is_safe = any(command.strip().startswith(prefix) for prefix in safe_prefixes)

        if not is_safe:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": """Main Chat Sandbox: Bash blocked.

Main chat can only run read-only commands (ls, cat, grep, git status, etc.)
For any modifications, use /dev-implement or /dev-debug.

Main chat orchestrates. Sub-agents execute."""
                }
            }))
            return

    # Block Write/Edit except for .md and .txt
    if tool_name in ('Write', 'Edit'):
        file_path = tool_input.get('file_path', '')
        allowed_extensions = ('.md', '.txt')
        allowed_paths = ('.claude/',)

        is_allowed = (
            file_path.endswith(allowed_extensions) or
            any(p in file_path for p in allowed_paths)
        )

        if not is_allowed:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"""Main Chat Sandbox: Cannot write to {file_path}

Main chat can only write .md and .txt files.
For code changes, use /dev-implement or /dev-debug.

Main chat orchestrates. Sub-agents execute."""
                }
            }))
            return

    # Allow everything else (Read, Glob, Grep, Task, Skill, etc.)
    sys.exit(0)

if __name__ == '__main__':
    main()
