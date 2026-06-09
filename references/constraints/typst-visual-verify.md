---
name: typst-visual-verify
description: Every diagram must pass a visual-verify render-score-fix loop — compilation alone does not verify visual quality
applies-to: [workshop, workshop-revise]
---

<EXTREMELY-IMPORTANT>
## The Iron Law of Visual Verification

**NO DIAGRAM IS COMPLETE WITHOUT RENDERING, SCORING, AND MEETING THE THRESHOLD (>= 9.5). This is not negotiable.**

A diagram that compiles is NOT a diagram that works. Compilation verifies syntax; visual-verify verifies that the audience can actually read it from the back of the room.

### Required Loop

After creating or modifying ANY visual element (`cetz.canvas`, `fletcher-diagram`, complex `#table`, `#grid` layout):

1. **Compile** slides.typ to PDF
2. **Render** the relevant page to PNG (or use look-at on the PDF page)
3. **Score** against the defect checklist (0-10)
4. **Fix** if score < 9.5 → recompile → re-render → re-score
5. **Max 5 iterations** before escalating to user

### Defect Checklist

| Category | What to Check |
|----------|--------------|
| Clipped text | Labels or node text cut off by boundaries |
| Overlapping elements | Nodes, edges, or labels overlapping each other |
| Arrow routing | Arrows crossing nodes or taking illogical paths |
| Label anchoring | Labels floating away from their associated elements |
| Spacing consistency | Uneven gaps between parallel elements |
| Text size | Text too small to read when projected |
| Color contrast | Text/background combinations that are hard to read |
| Alignment | Elements that should be aligned but aren't |
| Completeness | Missing elements compared to the intended design |
</EXTREMELY-IMPORTANT>
