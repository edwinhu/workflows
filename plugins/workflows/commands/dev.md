---
description: Start the development workflow with TDD enforcement and sandbox mode
allowed-tools: ["Bash"]
---

Activate the dev workflow:

```bash
mkdir -p /tmp/claude-workflow-$PPID && touch /tmp/claude-workflow-$PPID/dev_mode /tmp/claude-workflow-$PPID/workflow_dev && echo "✓ Dev workflow activated (TDD + sandbox)"
```

Run immediately, then ask: "What would you like to implement?"
