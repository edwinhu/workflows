---
description: Deactivate the sandbox and restore full tool access
allowed-tools: ["Bash"]
---

Deactivate the sandbox by removing the dev mode marker:

```bash
rm -f /tmp/claude-workflow-*/dev_mode 2>/dev/null && echo "✓ Sandbox deactivated" || echo "✓ Sandbox was not active"
```

Run this command immediately. No confirmation needed.
