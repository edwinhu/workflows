---
name: ds-exit
description: Exit data science mode and disable the main chat sandbox for this session.
---

# DS Exit

Deactivates the ds workflow and sandbox for this session.

## Deactivation

Run this command:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/shared')
from session import deactivate_workflow, deactivate_dev_mode
deactivate_workflow('ds')
deactivate_dev_mode()
print('✓ DS workflow and sandbox deactivated')
"
```

You now have full access to Bash and Write/Edit from main chat.
