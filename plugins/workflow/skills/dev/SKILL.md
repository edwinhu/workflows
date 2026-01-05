---
name: dev
description: Start the development workflow with TDD enforcement and sandbox mode.
---

# Start Dev Workflow

Activates the dev workflow and sandbox for this session.

## Activation

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common')
from session import activate_workflow, activate_dev_mode
activate_workflow('dev')
activate_dev_mode()
print('✓ Dev workflow activated')
"
```

Now invoke the `dev:dev` skill to begin the full development workflow.
