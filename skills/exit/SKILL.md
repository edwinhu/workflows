---
name: exit
description: This skill should be used when the user asks to "exit sandbox", "deactivate sandbox", "restore full access", or mentions they are done with workflow constraints. Deactivates the sandbox and restores access to Bash and Write/Edit tools.
version: 0.1.0
---

# Exit Workflow

Deactivates sandbox constraints for the current session, restoring full access to Bash and Write/Edit tools.

## Purpose

The exit workflow removes temporary session constraints imposed by workflow skills (dev, ds, or other sandboxed modes). This allows unrestricted tool access when workflow constraints are no longer needed.

## Deactivation Process

Execute the deactivation script to disable sandbox mode. The script calls the session module to clear workflow state and restore all tools:

```bash
# Deactivate sandbox and restore full tool access
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common')
from session import deactivate_dev_mode
deactivate_dev_mode()
print('✓ Sandbox deactivated')
"
```

## Session State

Note that active workflows (dev, ds) remain tracked in the session history until the session ends. The deactivation only removes the runtime constraints, not the historical record of workflow activity.
