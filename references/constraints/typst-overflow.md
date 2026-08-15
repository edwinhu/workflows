---
name: typst-overflow
description: Overflow detection and handling — cut content, split slides, use columns, run mechanical checks after every compile
type: convention
graduated: false
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule — Overflow Handling

### Overflow Fix Strategies (in order)

1. **Cut content** or reduce bullets
2. **Split** into multiple slides
3. **Use columns** (`#grid`)
4. **Never `#set text()`**. If truly last resort, 20pt minimum.

### Mechanical Overflow Detection

After compiling slides, run the overflow check script:

```bash
OVERFLOW_CHECK=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/scripts/checks/check-overflow.sh 2>/dev/null | sort -V | tail -1) && bash "$OVERFLOW_CHECK" slides.typ
```

This script:
1. Creates a temporary wrapper importing `validation.typ` with handout mode
2. Compiles (each slide = 1 page in handout mode)
3. Queries Typst metadata for heading positions and page counts
4. Detects any slide that spills beyond 1 page

Exit code 1 = overflow found. **Gate does NOT pass until 0 overflows.**

A PostToolUse hook also fires automatically after every `typst compile` on slides files.

In lecture material, run the full slide check suite after a batch of edits (not after every individual edit):

```bash
SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts" && "$SCRIPTS_DIR/check-all-slides.sh" slides/XX-topic.typ
```

### Heuristic Source-Level Checks

Before compiling, flag high-risk slides:
- `#callout[]` + 3 or more `#pause` markers on the same slide
- 8+ top-level bullets on a single slide
- Table + 4+ bullets on the same slide
- CeTZ diagram + 3+ bullets on the same slide

These are heuristics — the compiled PDF is ground truth.
