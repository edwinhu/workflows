---
description: Start the data science workflow with output-first verification
allowed-tools: ["Bash"]
---

Activate the data science workflow:

```bash
mkdir -p /tmp/claude-workflow-$PPID && touch /tmp/claude-workflow-$PPID/workflow_ds && echo "✓ Data science workflow activated (output-first verification)"
```

Run immediately, then ask: "What data would you like to analyze?"
