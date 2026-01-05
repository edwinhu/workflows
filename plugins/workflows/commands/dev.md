---
description: Start the development workflow with TDD enforcement and sandbox mode
allowed-tools: ["Bash"]
---

# Dev Workflow

Enable sandbox mode and start the development workflow:

```bash
touch /tmp/claude-workflow-$PPID/dev_mode && echo "✓ Dev workflow activated (TDD + sandbox)"
```

After running, ask: "What would you like to implement?"

Load the `workflows:dev` skill for full TDD methodology when needed.
