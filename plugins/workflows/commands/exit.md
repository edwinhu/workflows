---
description: Deactivate the sandbox and restore full tool access
allowed-tools: ["Bash"]
---

# Exit Workflow Mode

Deactivate sandbox and clean up session markers:

```bash
rm -f /tmp/claude-workflow-$PPID/dev_mode /tmp/claude-workflow-$PPID/workflow_* && echo "✓ Workflows deactivated"
```

After running, tell the user: "Full tool access restored."
