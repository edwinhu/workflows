---
name: exit
description: Deactivate the sandbox and restore full access to Bash and Write/Edit tools.
---
# Exit Workflow

Deactivates the sandbox for this session.

## Deactivation

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common')
from session import deactivate_dev_mode
deactivate_dev_mode()
print('✓ Sandbox deactivated')
"
```

Active workflows (dev, ds) remain tracked until session ends.