---
name: sandbox:start
description: Activate the main chat sandbox. When active, main chat can only run read-only commands and write .md/.txt files. All code changes must go through Task agents.
---

# Sandbox Start

Activates the main chat sandbox for this session.

## What the Sandbox Does

When active:
- **Bash**: Only read-only commands allowed (ls, cat, grep, git status, etc.)
- **Write/Edit**: Only .md and .txt files allowed
- **Task agents**: Full access (they do the real work)

This enforces the pattern: **Main chat orchestrates. Sub-agents execute.**

## Activation

Run this command to activate the sandbox:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts')
from session import activate_dev_mode
activate_dev_mode()
print('✓ Sandbox activated')
"
```

## Deactivation

Use `/sandbox:exit` to deactivate the sandbox.
