---
description: Save session state to LEARNINGS.md
allowed-tools: Read, Write, Bash
---

# /checkpoint - Save Session State

Save current session state for continuity tracking.

## What It Does

1. **Update LEARNINGS.md** with timestamp and current context
2. **Log session context** for resumption

## When to Use

- Before context compaction (to preserve state)
- Before taking a break
- At logical milestones during long sessions
- When switching between tasks

## Process

1. **Check for LEARNINGS.md**
   - If exists: Append checkpoint entry
   - If not exists: Create with initial structure

2. **Append Checkpoint Entry**

```markdown
---
## Checkpoint: [timestamp]

### Current State
[Brief description of where you are in the task]

### Completed
- [x] Task 1
- [x] Task 2

### In Progress
- [ ] Current task

### Next Steps
- What to do next

### Files Modified
- file1.py
- file2.md
```

3. **Report**
```
CHECKPOINT SAVED
================
LEARNINGS.md updated: .claude/LEARNINGS.md
Session: [session-id]
```

## Arguments

$ARGUMENTS can be:
- (no args) - Create checkpoint with auto-generated context
- `note “...”` - Add specific note to checkpoint
- `status` - Show current checkpoint status without creating new one
