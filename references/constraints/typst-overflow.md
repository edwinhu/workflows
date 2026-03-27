---
name: typst-overflow
description: Overflow detection and handling — cut content, split slides, use columns, run mechanical checks
applies-to: [workshop, workshop-revise]
---

## Rule

### Overflow Fix Strategies (in order)

1. **Cut content** or reduce bullets
2. **Split** into multiple slides
3. **Use columns** (`#grid`)
4. **Never `#set text()`**. If truly last resort, 20pt minimum.

### Mechanical Overflow Detection

After compiling slides, run overflow detection using the validation query approach:

```bash
# Handout mode (each slide = 1 page, gap > 1 = overflow)
typst compile slides.typ --input handout=true && \
typst query slides.typ '<val>' --field value --root . | \
python3 [overflow-check-script]
```

If the project has a `validation.typ` imported in the slides, overflow detection uses Typst's introspection to count physical pages per slide and flag any slide that spills beyond its boundary.

**Without validation.typ:** Compile to PDF and visually check page count against expected slide count. If a slide takes 2+ pages in handout mode, it overflows.

### Heuristic Source-Level Checks

Before compiling, flag high-risk slides:
- `#callout[]` + 3 or more `#pause` markers on the same slide
- 8+ top-level bullets on a single slide
- Table + 4+ bullets on the same slide
- CeTZ diagram + 3+ bullets on the same slide

These are heuristics — the compiled PDF is ground truth.
