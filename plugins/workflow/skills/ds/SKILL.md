---
name: ds
description: Start the data science workflow with output-first verification and sandbox mode.
---

# Start DS Workflow

Activates the ds workflow and sandbox for this session.

## Activation

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common')
from session import activate_workflow, activate_dev_mode
activate_workflow('ds')
activate_dev_mode()
print('✓ DS workflow activated')
"
```

Now invoke the `ds:ds` skill to begin the full data science workflow.
