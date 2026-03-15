# Moved

This file has moved to the shared reference location:

Discover and read the enforcement checklist:
```bash
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/lib/references/enforcement-checklist.md 2>/dev/null | sort -V | tail -1
```
Use the output path with `Read()`.

The enforcement checklist is a shared resource used by multiple skills (skill-creator, workflow-creator, dev-debug, etc.) and belongs in `lib/references/`, not under any single skill.
