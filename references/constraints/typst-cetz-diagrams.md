---
name: typst-cetz-diagrams
description: CeTZ canvas conventions — minimum length 2em, visual-verify loop required after creation, cetz-plot FORBIDDEN
applies-to: [workshop, workshop-revise]
---

## Rule

CeTZ canvas diagrams (timelines, conceptual visuals, information matrices) are used for visuals that don't fit table or bullet format. **Diagrams must be grounded in the paper's content** — they should visualize the paper's arguments, model structure, or data relationships. If a diagram synthesizes information not directly in the paper (e.g., a timeline of related regulation), document the decision and verify all facts against the source.

```typst
#cetz.canvas(length: 2em, {
  import cetz.draw: *
  // ... diagram code
})
```

**Minimum `length: 2em`.** Anything smaller produces unreadable diagrams on projected slides. If you encounter `length: 1cm`, `length: 0.8cm`, `length: 1.5em`, or similar — change it to `2em`.

**cetz-plot is FORBIDDEN** (version conflict with secreg theme's cetz 0.3.2). Plain `cetz.canvas` from the theme's bundled import is fine.

**Storytelling comment required:** Every `cetz.canvas(` must be preceded by a `// Storytelling:` comment. See the `typst-cetz-storytelling` constraint.

<EXTREMELY-IMPORTANT>
**Visual-verify loop MANDATORY for every CeTZ diagram.**

After creating or modifying any `cetz.canvas` block:
1. Compile slides.typ to PDF
2. Run visual-verify on the rendered diagram (via look-at with --goal targeting the diagram)
3. Score against the defect checklist: clipped text, overlapping elements, arrow routing, label anchoring, spacing consistency, text size
4. If score < 9.5 → fix and re-render (max 5 iterations)

**A diagram that compiles is NOT a diagram that works.** Compilation verifies syntax; visual-verify verifies that the audience can actually read it. Shipping an unverified diagram means the presenter discovers clipped labels at the podium.
</EXTREMELY-IMPORTANT>

## Red Flags

- **Writing `cetz.canvas` without planning a visual-verify loop** — STOP. Compile, render, score.
- **Declaring a diagram "done" after compilation alone** — STOP. Compilation ≠ visual quality.
- **Using `length: 1cm` or smaller** — STOP. Use `2em` minimum.
- **Importing cetz-plot** — STOP. Forbidden (version conflict).
