---
name: workflow:exit
description: Deactivate the main chat sandbox. Restores full access to Bash and Write/Edit tools from main chat.
---

# Workflow Exit

Deactivates the main chat sandbox for this session.

## Deactivation

Run this command to deactivate the sandbox:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common')
from session import deactivate_dev_mode
deactivate_dev_mode()
print('✓ Sandbox deactivated')
"
```

## Note

This only deactivates the sandbox. Active workflows (dev, ds, writing) remain active.
To fully exit a workflow, the session will clean up on Stop or you can start a new session.
